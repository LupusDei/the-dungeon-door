/**
 * Combat in the voting flow: a fight is a run of scenes, one per round. Each player's vote is their own
 * hero's action: (a) Attack, (b) Cast, (c) Dodge, or Break Free or Help when that is called for (actions.ts); the vote's d20 is the attack roll. Monsters act by the
 * engine's rules. Shaken foes check morale (morale.ts). When it ends the living heroes split the XP and level
 * up: all of it on a victory or surrender, the slain foes' when the rest flee. See docs/api.md.
 */
import { type Ability, ABILITIES } from '../rules/abilities.ts';
import { averageDice, parseDice } from '../rules/dice.ts';
import { type Combatant, extraAttacks, heroCombatant, monsterCombatant } from '../rules/combatant.ts';
import { conditionsOf, withCondition } from '../rules/conditions.ts';
import type { Lasting } from '../rules/powers.ts';
import { type LightLevel, monsterSight, sightOf } from '../rules/light.ts';
import { awardXp, canLevelUp, levelUp, splitXp } from '../rules/leveling.ts';
import { monster } from '../rules/monsters.ts';
import { scriptedRng, seededRng } from '../rules/rng.ts';
import { HEALING_POTIONS, item } from '../rules/items.ts';
import { held, removeItem } from '../rules/inventory.ts';
import { resourcesOf, useResource } from '../rules/resources.ts';
import { type Action, act, type CombatEvent, type CombatState, currentActor, drinkPotion, monsterAction, secondWind, type RiderOutcome, startCombat, xpEarned } from '../rules/scene.ts';
import type { CharacterSheet } from '../rules/sheet.ts';
import { beamsAt, castSpell, endConcentration, slotsLeft, spellDamageDice } from '../rules/spells.ts';
import { areaCatch } from '../rules/spellEffects.ts';
import { type SrdSpell, srd } from '../rules/srd.ts';
import type { ChoiceId } from '../types.ts';
import { takeThird } from './actions.ts';
import { keepConcentration } from './concentration.ts';
import { shakeOff } from './conditions.ts';
import { afterFight } from './dying.ts';
import { type Break, morale } from './morale.ts';
import { newlyDead, revivify } from './revive.ts';
import type { PartyState } from './state.ts';

export const MAX_ROUNDS = 10;
export const COMBAT_CHOICES = [
  { label: 'Attack', detail: 'Strike the most wounded foe with your best weapon.' },
  { label: 'Cast', detail: 'Hurl your best attack spell at the most wounded foe; an area spell catches several (or strike, if you have none). With a friend dying, a healer heals them instead.' },
  { label: 'Dodge', detail: 'Keep your guard up: attacks against you have disadvantage until your next turn. (Held fast, you try to break free instead; beside a dying friend, you help them.)' },
];

export type FightEnd = 'victory' | 'defeat' | 'fled';
export type CombatVotes = Readonly<Record<string, { choiceId: ChoiceId; roll: number }>>;
export interface Round { party: PartyState; combat: CombatState; lines: string[]; ended: FightEnd | null }

/** Duplicate monsters are numbered: "Goblin Warrior 1", "Goblin Warrior 2". */
/** Who cannot see in this light fights Blinded (5.2: darkness makes a creature effectively Blinded). */
const blindedIf = (c: Combatant, blind: boolean): Combatant => (blind ? { ...c, conditions: [...c.conditions, 'blinded'] } : c);

function foes(ids: readonly string[], light: LightLevel): Combatant[] {
  return ids.map((id, i) => {
    const m = monster(id);
    const twins = ids.filter((x) => x === id).length;
    const nth = ids.slice(0, i + 1).filter((x) => x === id).length;
    return blindedIf({ ...monsterCombatant(`foe-${i + 1}`, m), name: twins > 1 ? `${m.name} ${nth}` : m.name }, monsterSight(m, light) === 'none');
  });
}

/** The hero as a combatant, with the conditions it carries (rules/conditions.ts). */
function heroOf(playerId: string, sheet: CharacterSheet, light: LightLevel): Combatant {
  const carried = conditionsOf(sheet).map((c) => c.condition);
  const c = { ...heroCombatant(playerId, sheet), status: sheet.hp === 0 ? 'stable' as const : 'up' as const, conditions: carried, ...(carried.length ? { carried } : {}) };
  return blindedIf(c, !carried.includes('blinded') && sightOf(sheet, light) === 'none');
}

const blindLine = (all: Combatant[]) => {
  const blind = all.filter((c) => c.conditions.includes('blinded')).map((c) => c.name);
  return blind.length ? [`In the dark, ${blind.join(', ')} cannot see (Blinded).`] : [];
};

export function startFight(party: PartyState, monsterIds: readonly string[], light: LightLevel = 'bright'): { party: PartyState; combat: CombatState; lines: string[] } {
  const rng = seededRng(party.rng);
  const seed = rng.die(1_000_000_000);
  const heroes = Object.entries(party.sheets).filter(([, sheet]) => !sheet.dead).map(([id, sheet]) => heroOf(id, sheet, light));
  const others = foes(monsterIds, light);
  const combat = startCombat(seed, [...heroes, ...others]);
  const order = combat.order.map((id) => `${combat.combatants[id].name} ${combat.initiative[id]}`).join(', ');
  return { party: { ...party, rng: rng.state() }, combat, lines: [`A fight begins: ${others.map((f) => f.name).join(', ')}. Initiative: ${order}.`, ...blindLine([...heroes, ...others])] };
}

const living = (c: Combatant) => c.status !== 'dead';

/** The living combatant on the other side with the fewest hit points, preferring one not immune to `type` (damage). */
export const mostWounded = (combat: CombatState, side: Combatant['side'], type?: string): Combatant =>
  combat.combatants[caught(combat, side, 1, type)[0]];

/** The damage type the hero's chosen attack deals (its first damage roll's). */
export const weaponType = (me: Combatant): string => bestWeapon(me).damage[0].type;

/** Average damage of a cast at the spell's own level, every beam hitting. */
export function spellScore(spell: SrdSpell, sheet: CharacterSheet): number {
  return averageDice(parseDice(spellDamageDice(spell, spell.level, sheet.level)!)) * beamsAt(spell, sheet.level);
}

/** The damaging spell (attack or save) with the most average damage that the hero can cast now. */
export function bestSpell(sheet: CharacterSheet): SrdSpell | null {
  if (!sheet.spellcasting) return null;
  const left = slotsLeft(sheet);
  const castable = (s: SrdSpell) => s.level === 0 || left.slice(s.level - 1).some((n) => n > 0);
  const known = [...sheet.spellcasting.cantrips, ...sheet.spellcasting.prepared].map((id) => srd().spells.get(id)!);
  const damaging = known.filter((s) => s.damage && (s.attack || s.save) && castable(s));
  return damaging.reduce<SrdSpell | null>((best, s) => (best === null || spellScore(s, sheet) > spellScore(best, sheet) ? s : best), null);
}

/** The attack with the best bonus to hit. */
export const bestWeapon = (me: Combatant) => me.attacks.reduce((best, a) => (a.bonus > best.bonus ? a : best));

function attackAction(combat: CombatState, me: Combatant, sheet: CharacterSheet, natural: number): Action {
  const attack = bestWeapon(me).name;
  const extra = extraAttacks(sheet);
  return { kind: 'attack', attack, target: mostWounded(combat, me.side, weaponType(me)).id, natural, ...(extra ? { then: Array<string>(extra).fill(attack) } : {}) };
}

/** The first healing spell the hero has prepared and a slot to cast. */
export function healingSpell(sheet: CharacterSheet): SrdSpell | null {
  if (!sheet.spellcasting) return null;
  const left = slotsLeft(sheet);
  const healing = sheet.spellcasting.prepared.map((id) => srd().spells.get(id)!).filter((s) => s.healing);
  return healing.find((s) => left.slice(s.level - 1).some((n) => n > 0)) ?? null;
}

function casterOf(sheet: CharacterSheet) {
  const { saveDc, attackBonus } = sheet.spellcasting!;
  return { saveDc, attackBonus, modifier: attackBonus - sheet.proficiencyBonus };
}

/** Cast with a friend dying: the healer's healing spell on them; null if no one is dying or it has none to cast. */
function healAction(combat: CombatState, sheet: CharacterSheet, me: Combatant, natural: number): { action: Action; sheet: CharacterSheet } | null {
  const dying = Object.values(combat.combatants).find((c) => c.side === me.side && c.status === 'dying');
  const spell = dying ? healingSpell(sheet) : null;
  if (!spell) return null;
  const { sheet: spent, cast } = castSpell(sheet, spell.id);
  return { action: { kind: 'spell', caster: casterOf(sheet), cast, targets: [dying!.id], natural }, sheet: spent };
}

/** What a hero does on its turn for its vote. A spell spends its slot on the returned sheet. Cast heals a dying friend first. */
export function heroAction(combat: CombatState, sheet: CharacterSheet, playerId: string, choiceId: ChoiceId, natural: number): { action: Action; sheet: CharacterSheet } {
  const me = combat.combatants[playerId];
  if (choiceId === 'c') return { action: { kind: 'dodge' }, sheet };
  const healed = choiceId === 'b' ? healAction(combat, sheet, me, natural) : null;
  if (healed) return healed;
  const spell = choiceId === 'b' ? bestSpell(sheet) : null;
  if (!spell) return { action: attackAction(combat, me, sheet, natural), sheet };
  const { sheet: spent, cast } = castSpell(sheet, spell.id);
  const caster = casterOf(sheet);
  const type = spell.damage!.type;
  const targets = spell.area ? caught(combat, me.side, areaCatch(spell.area), type) : Array<string>(cast.beams).fill(mostWounded(combat, me.side, type).id);
  return { action: { kind: 'spell', caster, cast, targets, natural }, sheet: spent };
}

/** The `n` most wounded living foes (fewer if fewer are left), those not immune to `type` (damage) first. */
export function caught(combat: CombatState, side: Combatant['side'], n: number, type?: string): string[] {
  const immune = (c: Combatant) => Number(type !== undefined && c.immunities.includes(type));
  const foes = Object.values(combat.combatants).filter((c) => c.side !== side && living(c));
  return foes.sort((a, b) => immune(a) - immune(b) || a.hp - b.hp).slice(0, n).map((c) => c.id);
}

// ---- telling the round ----

type Names = (id: string) => string;
const titled = (s: string) => s[0].toUpperCase() + s.slice(1);

/** What a hit's rider did: "Bryn fails the DC 10 CON save: Paralyzed.", "Bryn is Grappled.", "Bryn makes the DC 10 CON save." */
function riderLine(r: RiderOutcome, who: string): string {
  const save = `the DC ${r.dc} ${r.ability.toUpperCase()} save`;
  if (r.success) return `${who} makes ${save}.`;
  const what = r.condition ? titled(r.condition) : 'unaffected';
  return r.roll ? `${who} fails ${save}: ${what}.` : `${who} is ${what}.`;
}

const LINES: { [K in CombatEvent['kind']]: (e: Extract<CombatEvent, { kind: K }>, name: Names) => string } = {
  attack: ({ actor, result: r, reaction, rider }, name) =>
    `${reaction ? 'Opportunity Attack: ' : ''}${name(actor)} attacks ${name(r.target)} with ${r.attack}: ${r.roll.natural} (total ${r.roll.total}) vs AC ${r.ac}, ` +
    (r.hit ? `${r.critical ? 'critical hit' : 'hit'} for ${r.damage}.` : 'miss.') + (rider ? ` ${riderLine(rider, name(r.target))}` : ''),
  spell: ({ actor, spellId, outcomes }, name) =>
    `${name(actor)} casts ${srd().spells.get(spellId)!.name}: ` + outcomes.map((o) =>
      (o.healed > 0 ? `${name(o.target)} regains ${o.healed} HP` : `${name(o.target)} ${o.attack ? (o.attack.hit ? 'is hit' : 'is missed') : o.save!.success ? 'saves' : 'fails the save'}`) +
      (o.damage > 0 ? `, ${o.damage} damage` : '')).join('; ') + '.',
  dodge: ({ actor }, name) => `${name(actor)} dodges.`,
  other: ({ text }) => text,
  power: ({ actor, power, dc, ability, outcomes }, name) =>
    `${name(actor)} uses ${power} (DC ${dc} ${ability.toUpperCase()} save): ` + outcomes.map((o) =>
      `${name(o.target)} ${o.success ? 'saves' : 'fails'}${o.damage > 0 ? `, ${o.damage} damage` : ''}${o.condition ? `, ${titled(o.condition)}` : ''}`).join('; ') + '.',
  recharge: ({ actor, power, roll }, name) => `${name(actor)}: ${power} is ready again (d6: ${roll}).`,
  deathSave: ({ actor, status }, name) => `${name(actor)} makes a death save: ${status}.`,
  skip: ({ actor }, name) => `${name(actor)} cannot act.`,
  potion: ({ actor, item: id, healed }, name) => `${name(actor)} drinks a ${item(id).name} as a Bonus Action: ${healed} HP back.`,
  secondWind: ({ actor, healed }, name) => `${name(actor)} uses Second Wind as a Bonus Action: ${healed} HP back.`,
};

function tell(before: CombatState, after: CombatState): string[] {
  const name: Names = (id) => after.combatants[id].name;
  const events = after.log.slice(before.log.length).map((e) => (LINES[e.kind] as (x: CombatEvent, n: Names) => string)(e, name));
  const fallen = Object.values(after.combatants).filter((c) => c.status === 'dead' && before.combatants[c.id].status !== 'dead');
  return [...events, ...fallen.map((c) => `${c.name} falls.`)];
}

// ---- after the fight ----

const ASI_MAX = 20;
const IMPROVEMENT = ['-ability-score-improvement', '-epic-boon'];

/** +2 to the highest score below 20, or +1 to the two highest when the first is at 19. */
export function improvement(sheet: CharacterSheet) {
  const [first, second] = [...ABILITIES].filter((a) => sheet.abilityScores[a] < ASI_MAX).sort((a, b) => sheet.abilityScores[b] - sheet.abilityScores[a]);
  const increases: Partial<Record<Ability, number>> = sheet.abilityScores[first] < ASI_MAX - 1 ? { [first]: 2 } : { [first]: 1, [second]: 1 };
  return { kind: 'abilityScores' as const, increases };
}

function choicesAt(sheet: CharacterSheet) {
  const cls = srd().classes.get(sheet.classId)!;
  const level = sheet.level + 1;
  const due = cls.levels[level - 1].features.some((f) => IMPROVEMENT.some((s) => f.id.endsWith(s)));
  return {
    hp: 'average' as const,
    ...(level === cls.subclassLevel ? { subclassId: cls.subclasses[0] } : {}),
    ...(due ? { improvement: improvement(sheet) } : {}),
  };
}

/** Levels the hero up as far as its XP reaches: average hit points, the SRD subclass, +2 to its best score. */
export function autoLevelUp(sheet: CharacterSheet): { sheet: CharacterSheet; lines: string[] } {
  let s = sheet;
  const lines: string[] = [];
  while (canLevelUp(s)) {
    const next = levelUp(s, choicesAt(s), scriptedRng([])); // average hit points: no dice
    lines.push(`${s.name} reaches level ${next.level} (+${next.maxHp - s.maxHp} max HP).`);
    s = next;
  }
  return { sheet: s, lines };
}

/** The XP split among the living heroes; they level up with it at the quest's end (play/table.ts endQuest). */
function award(party: PartyState, combat: CombatState, xp: number, headline: string): { party: PartyState; lines: string[] } {
  const alive = Object.keys(party.sheets).filter((id) => Object.hasOwn(combat.combatants, id) && living(combat.combatants[id]));
  const share = splitXp(xp, alive.length); // the hero who struck the last blow is alive
  const sheets = { ...party.sheets, ...Object.fromEntries(alive.map((id) => [id, awardXp(party.sheets[id], share)])) };
  return { party: { ...party, sheets }, lines: [xp === 0 ? headline : `${headline} ${xp} XP, ${share} each.`] };
}

function endOf(combat: CombatState, broke: Break | null): FightEnd | null {
  if (combat.outcome !== 'ongoing') return combat.outcome;
  if (broke !== null) return broke === 'flee' ? 'fled' : 'victory';
  return combat.round > MAX_ROUNDS ? 'fled' : null;
}

/** Every foe's XP: they were all defeated, slain or surrendered. */
const allFoes = (combat: CombatState) => Object.values(combat.combatants).filter((c) => c.side === 'foes').reduce((n, c) => n + c.xp, 0);

/** The fighters' HP back onto their sheets (the dead sat the fight out). */
const synced = (party: PartyState, combat: CombatState): PartyState => ({
  ...party,
  sheets: Object.fromEntries(Object.entries(party.sheets).map(([id, s]) => [id, Object.hasOwn(combat.combatants, id) ? { ...s, hp: combat.combatants[id].hp } : s])),
});

interface Turn { action: Action; state: CombatState; sheets: Record<string, CharacterSheet> }

const SECOND_WIND = 'second-wind';
const windLeft = (sheet: CharacterSheet) => resourcesOf(sheet).some((r) => r.id === SECOND_WIND && r.left > 0);

export type BonusHeal = { kind: 'second-wind' } | { kind: 'potion'; id: string };

/**
 * The one Bonus Action a hero at half HP or less takes to heal (5.2): a fighter's Second Wind while it has
 * a use, else the least of its healing potions; null when it needs or has neither.
 */
export function bonusHeal(me: Combatant, sheet: CharacterSheet): BonusHeal | null {
  if (me.hp * 2 > me.maxHp) return null;
  if (windLeft(sheet)) return { kind: 'second-wind' };
  const potion = Object.keys(HEALING_POTIONS).find((p) => held(sheet, p) > 0);
  return potion === undefined ? null : { kind: 'potion', id: potion };
}

function bonusAction(state: CombatState, sheets: Record<string, CharacterSheet>, id: string): { state: CombatState; sheets: Record<string, CharacterSheet> } {
  const sheet = sheets[id];
  const bonus = bonusHeal(state.combatants[id], sheet);
  if (bonus === null) return { state, sheets };
  if (bonus.kind === 'second-wind') return { state: secondWind(state, sheet.level), sheets: { ...sheets, [id]: useResource(sheet, SECOND_WIND) } };
  return { state: drinkPotion(state, bonus.id, HEALING_POTIONS[bonus.id]), sheets: { ...sheets, [id]: removeItem(sheet, bonus.id) } };
}

/** The current combatant's turn: a monster's action by rule; a hero's potion if it needs one, then its vote (Dodge without one). */
function turnAction(state: CombatState, sheets: Record<string, CharacterSheet>, votes: CombatVotes): Turn {
  const ruled = monsterAction(state);
  if (ruled) return { action: ruled, state, sheets };
  const id = currentActor(state);
  const drunk = bonusAction(state, sheets, id);
  const vote = votes[id];
  if (!vote) return { action: { kind: 'dodge' }, ...drunk };
  if (vote.choiceId === 'c') {
    const third = takeThird(drunk.state, drunk.sheets[id], id);
    return { action: third.action, state: third.combat, sheets: { ...drunk.sheets, [id]: third.sheet } };
  }
  const { action, sheet } = heroAction(drunk.state, drunk.sheets[id], id, vote.choiceId, vote.roll);
  return { action, state: drunk.state, sheets: { ...drunk.sheets, [id]: sheet } };
}

/** However it ends, the fallen are settled (stabilized by a friend, or left to their death saves) and the slain stay dead, unless a party caster Revivifies them. */
function settleFight(party: PartyState, combat: CombatState, lines: string[], broke: Break | null): Round {
  const ended = endOf(combat, broke);
  if (ended === null) return { party, combat, lines, ended };
  const won = {
    victory: () => award(party, combat, broke === 'surrender' ? allFoes(combat) : xpEarned(combat), 'Victory!'),
    fled: () => award(party, combat, xpEarned(combat), 'The foes flee.'),
    defeat: () => ({ party, lines: [] }),
  }[ended]();
  const calm = { ...won.party, sheets: Object.fromEntries(Object.entries(won.party.sheets).map(([id, sh]) => [id, endConcentration(sh)])) };
  const settled = afterFight(calm, combat);
  const back = revivify(settled.party, newlyDead(won.party, settled.party));
  return { party: back.party, combat, lines: [...lines, ...won.lines, ...settled.lines, ...back.lines], ended };
}

/** The carried conditions a hero's sheet no longer has (it broke free, or shook one off) leave its combatant too. */
function freedFrom(combat: CombatState, sheets: Record<string, CharacterSheet>): CombatState {
  const combatants = Object.fromEntries(Object.entries(combat.combatants).map(([id, c]) => {
    const gone = (c.carried ?? []).filter((x) => !conditionsOf(sheets[id]).some((t) => t.condition === x));
    return [id, gone.length ? { ...c, conditions: c.conditions.filter((x) => !gone.includes(x)), carried: c.carried!.filter((x) => !gone.includes(x)) } : c];
  }));
  return { ...combat, combatants };
}

/** The conditions monsters brought on heroes in these events (powers and hits' riders), with how each ends. */
function laid(events: readonly CombatEvent[], combat: CombatState): { target: string; lasting: Lasting }[] {
  return events.flatMap((e) => {
    const me = combat.combatants[e.actor];
    if (e.kind === 'attack' && e.rider?.condition) return [{ target: e.result.target, lasting: me.attacks.find((a) => a.name === e.result.attack)!.rider!.lasting }];
    if (e.kind !== 'power') return [];
    const lasting = me.powers!.find((p) => p.name === e.power)!.lasting!;
    return e.outcomes.filter((o) => o.condition).map((o) => ({ target: o.target, lasting }));
  });
}

/** Each condition a monster brought a hero goes on its sheet, with how it ends; its combatant carries it. */
function lastingOnSheets(before: CombatState, after: CombatState, sheets: Record<string, CharacterSheet>): { combat: CombatState; sheets: Record<string, CharacterSheet> } {
  const out = { ...sheets };
  const combatants = { ...after.combatants };
  for (const { target, lasting } of laid(after.log.slice(before.log.length), after).filter((l) => Object.hasOwn(out, l.target))) {
    out[target] = withCondition(out[target], lasting);
    combatants[target] = { ...combatants[target], carried: [...new Set([...(combatants[target].carried ?? []), lasting.condition])] };
  }
  return { combat: { ...after, combatants }, sheets: out };
}

/**
 * Plays one round: first each hero saves against what a save ends (play/conditions.ts), then each
 * acts by its vote and the monsters by rule; the hurt keep concentrating or not; then the fight is settled if it ended.
 */
export function fightRound(party: PartyState, combat: CombatState, votes: CombatVotes): Round {
  const freed = shakeOff(party, ['save']); // breaking free takes an action in a fight (play/actions.ts)
  const start = freedFrom(combat, freed.party.sheets);
  let state = start;
  let sheets = freed.party.sheets;
  while (state.outcome === 'ongoing' && state.round === start.round) {
    const turn = turnAction(state, sheets, votes);
    sheets = turn.sheets;
    state = act(turn.state, turn.action);
  }
  const shaken = morale(start, state);
  const marked = lastingOnSheets(start, shaken.combat, sheets);
  const kept = keepConcentration(start, marked.combat, marked.sheets);
  const lines = [...freed.lines, ...tell(start, state), ...shaken.lines, ...tell(state, shaken.combat), ...kept.lines];
  return settleFight(synced({ ...freed.party, sheets: kept.sheets }, kept.combat), kept.combat, lines, shaken.broke);
}
