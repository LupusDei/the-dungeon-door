/**
 * Combat in the voting flow: a fight is a run of scenes, one per round. Each player's vote is their own
 * hero's action: (a) Attack, (b) Cast, (c) Dodge; the vote's d20 is the attack roll. Monsters act by the
 * engine's rules. When it ends the living heroes split the XP and level up. See docs/api.md.
 */
import { type Ability, ABILITIES } from '../rules/abilities.ts';
import { averageDice, parseDice } from '../rules/dice.ts';
import { type Combatant, heroCombatant, monsterCombatant } from '../rules/combatant.ts';
import { awardXp, canLevelUp, levelUp, splitXp } from '../rules/leveling.ts';
import { monster } from '../rules/monsters.ts';
import { scriptedRng, seededRng } from '../rules/rng.ts';
import { type Action, act, type CombatEvent, type CombatState, currentActor, monsterAction, startCombat, xpEarned } from '../rules/scene.ts';
import type { CharacterSheet } from '../rules/sheet.ts';
import { beamsAt, castSpell, slotsLeft, spellDamageDice } from '../rules/spells.ts';
import { type SrdSpell, srd } from '../rules/srd.ts';
import type { ChoiceId } from '../types.ts';
import { afterFight } from './dying.ts';
import type { PartyState } from './state.ts';

export const MAX_ROUNDS = 10;
export const COMBAT_CHOICES = [
  { label: 'Attack', detail: 'Strike the most wounded foe with your best weapon.' },
  { label: 'Cast', detail: 'Hurl your best attack spell at the most wounded foe (or strike, if you have none).' },
  { label: 'Dodge', detail: 'Keep your guard up: attacks against you have disadvantage until your next turn.' },
];

export type FightEnd = 'victory' | 'defeat' | 'fled';
export type CombatVotes = Readonly<Record<string, { choiceId: ChoiceId; roll: number }>>;
export interface Round { party: PartyState; combat: CombatState; lines: string[]; ended: FightEnd | null }

/** Duplicate monsters are numbered: "Goblin Warrior 1", "Goblin Warrior 2". */
function foes(ids: readonly string[]): Combatant[] {
  return ids.map((id, i) => {
    const m = monster(id);
    const twins = ids.filter((x) => x === id).length;
    const nth = ids.slice(0, i + 1).filter((x) => x === id).length;
    return { ...monsterCombatant(`foe-${i + 1}`, m), name: twins > 1 ? `${m.name} ${nth}` : m.name };
  });
}

const heroOf = (playerId: string, sheet: CharacterSheet): Combatant =>
  ({ ...heroCombatant(playerId, sheet), status: sheet.hp === 0 ? 'stable' : 'up' });

export function startFight(party: PartyState, monsterIds: readonly string[]): { party: PartyState; combat: CombatState; lines: string[] } {
  const rng = seededRng(party.rng);
  const seed = rng.die(1_000_000_000);
  const heroes = Object.entries(party.sheets).filter(([, sheet]) => !sheet.dead).map(([id, sheet]) => heroOf(id, sheet));
  const others = foes(monsterIds);
  const combat = startCombat(seed, [...heroes, ...others]);
  const order = combat.order.map((id) => `${combat.combatants[id].name} ${combat.initiative[id]}`).join(', ');
  return { party: { ...party, rng: rng.state() }, combat, lines: [`A fight begins: ${others.map((f) => f.name).join(', ')}. Initiative: ${order}.`] };
}

const living = (c: Combatant) => c.status !== 'dead';

function mostWounded(combat: CombatState, side: Combatant['side']): Combatant {
  return Object.values(combat.combatants).filter((c) => c.side !== side && living(c)).reduce((low, c) => (c.hp < low.hp ? c : low));
}

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

function attackAction(combat: CombatState, me: Combatant, natural: number): Action {
  const weapon = me.attacks.reduce((best, a) => (a.bonus > best.bonus ? a : best));
  return { kind: 'attack', attack: weapon.name, target: mostWounded(combat, me.side).id, natural };
}

/** What a hero does on its turn for its vote. A spell spends its slot on the returned sheet. */
export function heroAction(combat: CombatState, sheet: CharacterSheet, playerId: string, choiceId: ChoiceId, natural: number): { action: Action; sheet: CharacterSheet } {
  const me = combat.combatants[playerId];
  if (choiceId === 'c') return { action: { kind: 'dodge' }, sheet };
  const spell = choiceId === 'b' ? bestSpell(sheet) : null;
  if (!spell) return { action: attackAction(combat, me, natural), sheet };
  const { sheet: spent, cast } = castSpell(sheet, spell.id);
  const { saveDc, attackBonus } = sheet.spellcasting!;
  const target = mostWounded(combat, me.side).id;
  const caster = { saveDc, attackBonus, modifier: attackBonus - sheet.proficiencyBonus };
  return { action: { kind: 'spell', caster, cast, targets: Array(cast.beams).fill(target), natural }, sheet: spent };
}

// ---- telling the round ----

type Names = (id: string) => string;

const LINES: { [K in CombatEvent['kind']]: (e: Extract<CombatEvent, { kind: K }>, name: Names) => string } = {
  attack: ({ actor, result: r }, name) =>
    `${name(actor)} attacks ${name(r.target)} with ${r.attack}: ${r.roll.natural} (total ${r.roll.total}) vs AC ${r.ac}, ` +
    (r.hit ? `${r.critical ? 'critical hit' : 'hit'} for ${r.damage}.` : 'miss.'),
  spell: ({ actor, spellId, outcomes }, name) =>
    `${name(actor)} casts ${srd().spells.get(spellId)!.name}: ` + outcomes.map((o) =>
      `${name(o.target)} ${o.attack ? (o.attack.hit ? 'is hit' : 'is missed') : o.save!.success ? 'saves' : 'fails the save'}` +
      (o.damage > 0 ? `, ${o.damage} damage` : '')).join('; ') + '.',
  dodge: ({ actor }, name) => `${name(actor)} dodges.`,
  deathSave: ({ actor, status }, name) => `${name(actor)} makes a death save: ${status}.`,
  skip: ({ actor }, name) => `${name(actor)} cannot act.`,
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

function victory(party: PartyState, combat: CombatState): { party: PartyState; lines: string[] } {
  const xp = xpEarned(combat);
  const alive = Object.keys(party.sheets).filter((id) => living(combat.combatants[id]));
  const share = splitXp(xp, alive.length); // the hero who struck the last blow is alive
  const lines = [`Victory! ${xp} XP, ${share} each.`];
  const sheets = { ...party.sheets };
  for (const id of alive) {
    const up = autoLevelUp(awardXp(sheets[id], share));
    sheets[id] = up.sheet;
    lines.push(...up.lines);
  }
  return { party: { ...party, sheets }, lines };
}

function endOf(combat: CombatState): FightEnd | null {
  if (combat.outcome !== 'ongoing') return combat.outcome;
  return combat.round > MAX_ROUNDS ? 'fled' : null;
}

/** The fighters' HP back onto their sheets (the dead sat the fight out). */
const synced = (party: PartyState, combat: CombatState): PartyState => ({
  ...party,
  sheets: Object.fromEntries(Object.entries(party.sheets).map(([id, s]) => [id, Object.hasOwn(combat.combatants, id) ? { ...s, hp: combat.combatants[id].hp } : s])),
});

interface Turn { action: Action; sheets: Record<string, CharacterSheet> }

/** The current combatant's action: a monster's by rule, a hero's by its vote (Dodge without one). */
function turnAction(state: CombatState, sheets: Record<string, CharacterSheet>, votes: CombatVotes): Turn {
  const ruled = monsterAction(state);
  if (ruled) return { action: ruled, sheets };
  const id = currentActor(state);
  const vote = votes[id];
  if (!vote) return { action: { kind: 'dodge' }, sheets };
  const { action, sheet } = heroAction(state, sheets[id], id, vote.choiceId, vote.roll);
  return { action, sheets: { ...sheets, [id]: sheet } };
}

/** However it ends, the slain stay dead and the fallen are settled: stabilized by a friend, or left to their death saves. */
function settleFight(party: PartyState, combat: CombatState, lines: string[]): Round {
  const ended = endOf(combat);
  if (ended === null) return { party, combat, lines, ended };
  const won = { victory: () => victory(party, combat), fled: () => ({ party, lines: ['The foes flee.'] }), defeat: () => ({ party, lines: [] }) }[ended]();
  const settled = afterFight(won.party, combat);
  return { party: settled.party, combat, lines: [...lines, ...won.lines, ...settled.lines], ended };
}

/** Plays one round: each hero by their vote, monsters by rule; then settles the fight if it ended. */
export function fightRound(party: PartyState, combat: CombatState, votes: CombatVotes): Round {
  let state = combat;
  let sheets = party.sheets;
  while (state.outcome === 'ongoing' && state.round === combat.round) {
    const turn = turnAction(state, sheets, votes);
    sheets = turn.sheets;
    state = act(state, turn.action);
  }
  return settleFight(synced({ ...party, sheets }, state), state, tell(combat, state));
}
