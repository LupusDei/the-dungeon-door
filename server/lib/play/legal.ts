/**
 * What one hero can do on this turn, and what a vote that names one of those actions does.
 * The list is the sheet's: each weapon, each spell they know or have prepared, each usable item,
 * each class feature with uses, each skill, the common actions, and, in a fight, each legal move. One they
 * cannot take stays on the list with the reason. Nothing here assumes the set of kinds is closed.
 *
 * A letter vote (choice a, b or c) is untouched. A vote that names an action is checked against
 * this list, then played as that action. The vote's d20 is still the die, when the action rolls one.
 */
import { abilityModifier } from '../rules/abilities.ts';
import { abilityCheck } from '../rules/checks.ts';
import { type Attack, type Combatant, extraAttacks, heroCombatant } from '../rules/combatant.ts';
import { areaFromSelf, rangedShot, spellHits } from '../rules/bands.ts';
import { feetBetween, occupancy, reachableSquares, type Square } from '../rules/grid.ts';
import { conditionsOf } from '../rules/conditions.ts';
import { canBeHeld, holdRule } from '../rules/holds.ts';
import { held, paceOf, removeItem } from '../rules/inventory.ts';
import { HEALING_POTIONS, item as itemInfo, items } from '../rules/items.ts';
import { heal } from '../rules/resolve.ts';
import { resourcesOf, useResource } from '../rules/resources.ts';
import { type Rng, seededRng } from '../rules/rng.ts';
import { type Action, type CombatState, drinkPotion, secondWind } from '../rules/scene.ts';
import type { CharacterSheet } from '../rules/sheet.ts';
import { type Cast, castSpell, slotsLeft, spellHealingDice, strikesAt } from '../rules/spells.ts';
import { areaCatch } from '../rules/spellEffects.ts';
import { type SrdSpell, srd } from '../rules/srd.ts';
import type { ChoiceId, LegalAction } from '../types.ts';
import { STABILIZE_DC, takeThird } from './actions.ts';
import { moveActions, moveKey, parseMoveKey } from './moves.ts';
import { validateMove } from '../rules/bands.ts';
import { RuleViolation } from '../rules/violation.ts';

export interface LegalInput {
  combat: CombatState | null;
  sheet: CharacterSheet | null;
  playerId: string;
  /** The scene's choices, already written for this hero (the three combat lines, or the ways on). */
  choices: readonly { id: string; label: string; detail: string }[];
  canAct: boolean;
}

const ABILITY: Record<string, string> = {
  str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma',
};
const REST_ONLY = new Set(['arcane-recovery', 'magical-cunning']);
const KIT = 'healers-kit';

const signed = (n: number) => (n < 0 ? `${n}` : `+${n}`);
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

interface Offer {
  id: string; label: string; kind: string; detail: string;
  targets: { id: string; name: string }[];
  picks: LegalAction['picks'];
  limit?: number;
  squares?: Square[];
  rangeFeet?: { normal: number; long: number | null } | null;
  reachFeet?: number | null;
  reason: string | null;
}

const offer = ({ reason, limit, ...part }: Offer): LegalAction => ({
  ...part, ...(limit !== undefined ? { limit } : {}), available: reason === null, reason,
});

/** Squares `me` can end on with `speed` feet of movement. */
function squaresFrom(combat: CombatState, me: Combatant, speed: number): Square[] {
  if (!combat.battlefield || !me.square || speed < 5) return [];
  const { blocked, through } = occupancy(me, combat.combatants);
  return reachableSquares({ battlefield: combat.battlefield, from: me.square, speedFeet: speed, blocked, through });
}

/** True when `ok` holds where they stand, or on a square they can reach without Dashing. No grid: the list is not narrowed. */
function canReach(combat: CombatState, me: Combatant, targetId: string, speed: number, ok: (from: Combatant) => boolean): boolean {
  const target = combat.combatants[targetId];
  if (!combat.battlefield || !me.square || !target?.square) return true;
  if (ok(me)) return true;
  return squaresFrom(combat, me, speed).some((sq) => ok({ ...me, square: sq }));
}

function weaponReach(attack: Attack): { rangeFeet: { normal: number; long: number | null } | null; reachFeet: number | null } {
  if (!attack.ranged) return { rangeFeet: null, reachFeet: attack.reach ?? 5 };
  if (attack.normal === undefined && (attack.long === undefined || attack.long === null)) return { rangeFeet: null, reachFeet: null };
  return { rangeFeet: { normal: attack.normal ?? attack.long ?? 0, long: attack.long ?? null }, reachFeet: null };
}

function spellReach(spell: SrdSpell): { rangeFeet: { normal: number; long: number | null } | null; reachFeet: number | null } {
  if (spell.attack === 'melee' || (spell.range > 0 && spell.range <= 5 && spell.attack !== 'ranged' && !spell.area)) {
    return { rangeFeet: null, reachFeet: spell.range || 5 };
  }
  if (areaFromSelf(spell)) return { rangeFeet: { normal: spell.area!.feet, long: null }, reachFeet: null };
  return { rangeFeet: { normal: spell.range, long: null }, reachFeet: null };
}

/** Every foe still standing, and — on a grid — only those this attack can reach now or after a move. */
function foesOf(combat: CombatState | null, side: string): { id: string; name: string }[] {
  if (!combat) return [];
  return Object.values(combat.combatants).filter((c) => c.side !== side && c.status === 'up').map((c) => ({ id: c.id, name: c.name }));
}

function alliesOf(combat: CombatState | null, playerId: string, dyingOnly: boolean): { id: string; name: string }[] {
  if (!combat) return [];
  return Object.values(combat.combatants)
    .filter((c) => c.side === 'party' && c.id !== playerId && c.status !== 'dead' && (!dyingOnly || c.status === 'dying'))
    .map((c) => ({ id: c.id, name: c.name }));
}

/** Allies a healing spell can reach, the caster included, so long as they are not dead. */
function healTargets(combat: CombatState | null, playerId: string): { id: string; name: string }[] {
  if (!combat) return [];
  return Object.values(combat.combatants)
    .filter((c) => c.side === 'party' && c.status !== 'dead')
    .map((c) => ({ id: c.id, name: c.id === playerId ? `${c.name} (you)` : c.name }));
}

function hurtAllies(combat: CombatState | null, playerId: string): { id: string; name: string }[] {
  if (!combat) return [];
  return Object.values(combat.combatants)
    .filter((c) => c.side === 'party' && c.status !== 'dead' && c.hp < c.maxHp)
    .map((c) => ({ id: c.id, name: c.id === playerId ? `${c.name} (you)` : c.name }));
}

function attackIds(attacks: readonly Attack[]): string[] {
  const seen = new Map<string, number>();
  return attacks.map((a) => {
    const base = `attack:${slug(a.name)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  });
}

function weaponById(attacks: readonly Attack[], id: string): Attack | undefined {
  return attacks[attackIds(attacks).indexOf(id)];
}

const hasSlot = (sheet: CharacterSheet, level: number) =>
  level === 0 || slotsLeft(sheet).slice(level - 1).some((n) => n > 0);

function slotNote(spell: SrdSpell, sheet: CharacterSheet): string {
  if (spell.level === 0) return '';
  const left = slotsLeft(sheet);
  const index = left.findIndex((n, i) => i >= spell.level - 1 && n > 0);
  if (index < 0) return '';
  return ` Uses a level ${index + 1} slot (${left[index]} left).`;
}

function spellDetail(spell: SrdSpell, sheet: CharacterSheet): string {
  const casting = sheet.spellcasting;
  if (spell.healing && casting) {
    const mod = casting.attackBonus - sheet.proficiencyBonus;
    return `Heals ${spellHealingDice(spell, spell.level)}${signed(mod)} hit points.${slotNote(spell, sheet)}`;
  }
  if (spell.damage && casting) {
    const dice = spell.damage.dice;
    const how = spell.darts
      ? `${strikesAt(spell, spell.level, sheet.level)} darts of ${dice} ${spell.damage.type} that never miss`
      : spell.attack
        ? `${signed(casting.attackBonus)} to hit, ${dice} ${spell.damage.type}`
        : `${dice} ${spell.damage.type}, ${ABILITY[spell.save ?? 'dex']} save DC ${casting.saveDc}${spell.halfOnSave ? ' for half' : ''}`;
    return `${how}.${slotNote(spell, sheet)}`;
  }
  const holding = holdRule(spell.id);
  if (holding && spell.save && casting) {
    const what = holding.conditions.map((c) => c[0].toUpperCase() + c.slice(1)).join(' and ');
    return `${ABILITY[spell.save]} save DC ${casting.saveDc} or ${what}.${slotNote(spell, sheet)}`;
  }
  return spell.level === 0 ? 'A cantrip.' : `A level ${spell.level} spell.${slotNote(spell, sheet)}`;
}

function spellOffer(spell: SrdSpell, sheet: CharacterSheet, inFight: boolean, combat: CombatState | null, playerId: string): LegalAction {
  const healing = spell.healing !== null;
  const holding = spell.save !== null && !healing ? holdRule(spell.id) : undefined;
  const harmful = (spell.damage !== null && !healing) || holding !== undefined;
  const me = combat?.combatants[playerId];
  const speed = paceOf(sheet);
  const foes = holding ? foesOf(combat, 'party').filter((t) => canBeHeld(combat!.combatants[t.id], holding)) : foesOf(combat, 'party');
  const listed = !inFight ? [] : healing ? healTargets(combat, playerId) : harmful ? foes : [];
  const targets = !me || !combat ? listed : listed.filter((t) => canReach(combat, me, t.id, speed, (from) => {
    const who = combat.combatants[t.id];
    return !who || spellHits(from, who, spell);
  }));
  const many = harmful && (spell.area !== null || strikesAt(spell, spell.level, sheet.level) > 1);
  const limit = spell.area ? areaCatch(spell.area) : strikesAt(spell, spell.level, sheet.level);
  const needsTarget = healing || harmful;
  const reason = !hasSlot(sheet, spell.level)
    ? `No level ${spell.level} spell slot or higher left`
    : !inFight
      ? 'Not in a fight'
      : needsTarget && targets.length === 0
        ? (healing ? 'No one to heal' : combat?.battlefield ? 'No one in range' : 'No one to cast at')
        : null;
  const picks = targets.length === 0 ? 'none' : many ? 'many' : 'one';
  return offer({
    id: `spell:${spell.id}`, label: `Cast ${spell.name}`, kind: 'spell', detail: spellDetail(spell, sheet),
    targets, picks, ...(picks === 'many' ? { limit } : {}), ...spellReach(spell), reason,
  });
}

function spellsOf(sheet: CharacterSheet, inFight: boolean, combat: CombatState | null, playerId: string): LegalAction[] {
  const casting = sheet.spellcasting;
  if (!casting) return [];
  const ids = [...casting.cantrips, ...casting.prepared.filter((id) => !casting.cantrips.includes(id))];
  return ids.flatMap((id) => {
    const spell = srd().spells.get(id);
    return spell ? [spellOffer(spell, sheet, inFight, combat, playerId)] : [];
  });
}

interface Gear { id: string; name: string; count: number; potion: boolean; kit: boolean }

function gearOf(sheet: CharacterSheet): Gear[] {
  return sheet.equipment.flatMap((e) => {
    const potion = Object.hasOwn(HEALING_POTIONS, e.id);
    const kit = e.id === KIT;
    const consumable = items().get(e.id)?.consumable === true;
    return potion || kit || consumable ? [{ id: e.id, name: e.name, count: e.count, potion, kit }] : [];
  });
}

function itemsOf(sheet: CharacterSheet, inFight: boolean, dying: { id: string; name: string }[]): LegalAction[] {
  return gearOf(sheet).map((g) => {
    const kitTargets = g.kit ? dying : [];
    const reason = !inFight ? 'Not in a fight' : g.kit && dying.length === 0 ? 'No one is dying' : null;
    const picks = g.kit && dying.length > 0 ? 'one' : 'none';
    const how = g.potion ? 'Drink it.' : g.kit ? 'Stabilize a dying ally.' : 'Use it.';
    return offer({
      id: `item:${g.id}`, label: g.potion ? `Drink ${g.name}` : `Use ${g.name}`, kind: 'item',
      detail: `${how} ${g.count} left.`, targets: kitTargets, picks, reason,
    });
  });
}

function featuresOf(sheet: CharacterSheet, inFight: boolean, hurt: { id: string; name: string }[]): LegalAction[] {
  return resourcesOf(sheet).map((r) => {
    const none = r.left <= 0;
    const rest = REST_ONLY.has(r.id);
    const hands = r.id === 'lay-on-hands';
    const reason = none
      ? 'No uses left'
      : rest
        ? 'Only on a short rest'
        : !inFight
          ? 'Not in a fight'
          : hands && hurt.length === 0
            ? 'No one is hurt'
            : null;
    return offer({
      id: `feature:${r.id}`, label: r.name, kind: 'feature', detail: `${Math.max(0, r.left)} of ${r.max} left.`,
      targets: hands && inFight ? hurt : [], picks: hands && hurt.length > 0 && inFight ? 'one' : 'none', reason,
    });
  });
}

const COMMON: readonly { id: string; label: string; detail: string }[] = [
  { id: 'common:attack', label: 'Attack', detail: 'Strike one foe with your best weapon.' },
  { id: 'common:dash', label: 'Dash', detail: 'Move farther this turn.' },
  { id: 'common:disengage', label: 'Disengage', detail: 'Leave a foe\'s reach without an opportunity attack.' },
  { id: 'common:dodge', label: 'Dodge', detail: 'Attacks against you have disadvantage until your next turn.' },
  { id: 'common:help', label: 'Help', detail: 'Aid an ally, or stabilize one who is dying.' },
  { id: 'common:hide', label: 'Hide', detail: 'Try to go unseen.' },
  { id: 'common:ready', label: 'Ready', detail: 'Prepare to act when something happens.' },
  { id: 'common:use-object', label: 'Use an Object', detail: 'Use something you are carrying.' },
  { id: 'common:break-free', label: 'Break Free', detail: 'Spend your action to escape being held.' },
];

function commonOf(inFight: boolean, foes: { id: string; name: string }[], allies: { id: string; name: string }[], gear: Gear[], held: boolean): LegalAction[] {
  return COMMON.map((c) => {
    if (c.id === 'common:attack') {
      return offer({ ...c, kind: 'common', targets: inFight ? foes : [], picks: foes.length && inFight ? 'one' : 'none', reason: !inFight ? 'Not in a fight' : foes.length === 0 ? 'No one to attack' : null });
    }
    if (c.id === 'common:help') {
      return offer({ ...c, kind: 'common', targets: inFight ? allies : [], picks: allies.length && inFight ? 'one' : 'none', reason: !inFight ? 'Not in a fight' : allies.length === 0 ? 'No one to help' : null });
    }
    if (c.id === 'common:use-object') {
      const targets = gear.map((g) => ({ id: g.id, name: g.name }));
      return offer({ ...c, kind: 'common', targets: inFight ? targets : [], picks: targets.length && inFight ? 'one' : 'none', reason: !inFight ? 'Not in a fight' : targets.length === 0 ? 'Nothing to use' : null });
    }
    if (c.id === 'common:break-free') {
      const reason = !held ? 'You are not restrained or grappled' : !inFight ? 'Not in a fight' : null;
      return offer({ ...c, kind: 'common', targets: [], picks: 'none', reason });
    }
    return offer({ ...c, kind: 'common', targets: [], picks: 'none', reason: inFight ? null : 'Not in a fight' });
  });
}

const ABILITY_IDS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;

/** The six abilities, as a check the player can choose. */
function abilitiesOf(sheet: CharacterSheet): LegalAction[] {
  return ABILITY_IDS.map((id) => offer({
    id: `ability:${id}`, label: ABILITY[id], kind: 'ability',
    detail: `${ABILITY[id]} ${signed(abilityModifier(sheet.abilityScores[id]))}. A medium check.`,
    targets: [], picks: 'none', reason: null,
  }));
}

const skillName = (id: string) => id.split('-').map((word) => word[0].toUpperCase() + word.slice(1)).join(' ');

/** Every skill on the sheet. A tap is a medium check; it does not pick the party's plot choice. */
function skillsOf(sheet: CharacterSheet): LegalAction[] {
  const known = srd().skills;
  return [...known.keys()]
    .filter((id) => sheet.skills.includes(id) || Object.hasOwn(sheet.skillBonuses, id))
    .map((id) => {
      const ability = known.get(id)!;
      const name = skillName(id);
      const bonus = sheet.skillBonuses[id] ?? 0;
      return offer({
        id: `skill:${id}`, label: name, kind: 'skill',
        detail: `${ABILITY[ability] ?? ability} (${name}) ${signed(bonus)}. A medium check.`,
        targets: [], picks: 'none', reason: null,
      });
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

function choicesOf(choices: LegalInput['choices']): LegalAction[] {
  return choices.map((c) => offer({
    id: `choice:${c.id}`, label: c.label, kind: 'choice', detail: c.detail, targets: [], picks: 'none', reason: null,
  }));
}

const gated = (actions: LegalAction[], canAct: boolean): LegalAction[] =>
  (canAct ? actions : actions.map((a) => (a.available ? { ...a, available: false, reason: 'You cannot act' } : a)));

/** Squares only a Dash can reach, as their own move, so the map can offer them when no band move is a Dash. */
function dashMove(combat: CombatState, playerId: string): LegalAction[] {
  const who = combat.combatants[playerId];
  if (!who?.square || !combat.battlefield) return [];
  const speed = who.speed ?? 30;
  const walk = squaresFrom(combat, who, speed);
  const doubled = squaresFrom(combat, who, speed * 2);
  if (doubled.length <= walk.length) return [];
  return [offer({
    id: 'move:dash', label: 'Dash', kind: 'move', detail: 'Up to twice your speed. This spends your action.',
    targets: [], picks: 'none', squares: doubled, reason: null,
  })];
}

/** Legal moves for this hero, appended so the dashboard can show them beside the other actions. */
function movesOf(combat: CombatState | null, playerId: string): LegalAction[] {
  if (!combat?.combatants[playerId]) return [];
  const listed = moveActions(combat, playerId).flatMap(({ label, action }) => {
    if (action.kind !== 'move' || !('to' in action)) return [];
    const { kind: _kind, ...move } = action;
    return [offer({
      id: moveKey(move),
      label,
      kind: 'move',
      detail: move.dash ? 'Up to twice your speed. This spends your action.' : move.disengage ? 'Leave reach with no opportunity attack.' : 'Up to your speed.',
      targets: (move.engage ?? []).map((id) => ({ id, name: combat.combatants[id]?.name ?? id })),
      picks: 'none',
      ...(() => {
        const who = combat.combatants[playerId];
        if (!who || !combat.battlefield) return {};
        return { squares: squaresFrom(combat, who, (who.speed ?? 30) * (move.dash ? 2 : 1)) };
      })(),
      reason: null,
    })];
  });
  return [...listed, ...dashMove(combat, playerId)];
}

/** The hero's legal actions this turn. Unavailable ones are in the list, with the reason. */
export function legalActions({ combat, sheet, playerId, choices, canAct }: LegalInput): LegalAction[] {
  if (!sheet) return gated(choicesOf(choices), canAct);
  const inFight = combat !== null;
  const me = combat?.combatants[playerId];
  const attacks = me?.attacks ?? heroCombatant(playerId, sheet).attacks;
  const foes = foesOf(combat, me?.side ?? 'party');
  const allies = [...alliesOf(combat, playerId, false)];
  const dying = alliesOf(combat, playerId, true);
  const gear = gearOf(sheet);
  const heldFast = conditionsOf(sheet).some((c) => c.until.kind === 'escape');
  const speed = paceOf(sheet);
  const standing = me ? { ...me, speed } : undefined;
  const fight = combat && standing ? { ...combat, combatants: { ...combat.combatants, [playerId]: standing } } : combat;
  const reachable = (attack: Attack, list: { id: string; name: string }[]) =>
    !standing || !fight ? list : list.filter((f) => canReach(fight, standing, f.id, speed, (from) => {
      const foe = fight.combatants[f.id];
      if (!from.square || !foe?.square) return true;
      return attack.ranged ? rangedShot(from, foe, attack).ok : feetBetween(from.square, foe.square) <= (attack.reach ?? 5);
    }));
  const weapons = attacks.map((a, i) => {
    const targets = inFight ? reachable(a, foes) : [];
    return offer({
      id: attackIds(attacks)[i], label: `Attack with ${a.name}`, kind: 'attack',
      detail: `${signed(a.bonus)} to hit, ${a.damage.map((d) => `${d.dice} ${d.type}`).join(' + ')}.`,
      targets, picks: targets.length && inFight ? 'one' : 'none', ...weaponReach(a),
      reason: !inFight ? 'Not in a fight' : foes.length === 0 ? 'No one to attack' : targets.length === 0 ? (a.ranged ? 'No one in range' : 'No one in reach') : null,
    });
  });
  const best = attacks.reduce<Attack | undefined>((a, b) => (!a || b.bonus > a.bonus ? b : a), undefined);
  const commonFoes = best && standing && fight ? reachable(best, foes) : foes;
  const list = [
    ...weapons,
    ...spellsOf(sheet, inFight, fight, playerId),
    ...itemsOf(sheet, inFight, dying),
    ...featuresOf(sheet, inFight, hurtAllies(combat, playerId)),
    ...abilitiesOf(sheet),
    ...skillsOf(sheet),
    ...commonOf(inFight, commonFoes, allies, gear, heldFast),
    ...movesOf(fight, playerId),
    ...choicesOf(choices),
  ];
  return gated(list, canAct);
}

export type CheckedVote =
  | { ok: true; action: LegalAction; choiceId: ChoiceId; targets: string[] }
  | { ok: false; error: string };

const letterFor = (action: LegalAction): ChoiceId => {
  if (action.kind === 'choice') return action.id.slice('choice:'.length) as ChoiceId;
  if (action.kind === 'attack' || action.id === 'common:attack') return 'a';
  if (action.kind === 'spell') return 'b';
  return 'c';
};

/** Whether this vote may be stored. A choice letter is not checked here; the caller keeps that path. */
export function checkVote(actions: readonly LegalAction[], actionId: string, targets: readonly string[]): CheckedVote {
  const action = actions.find((a) => a.id === actionId);
  if (!action) return { ok: false, error: 'unknown action' };
  if (!action.available) return { ok: false, error: action.reason ?? `${action.label} cannot be taken` };
  const allowed = new Set(action.targets.map((t) => t.id));
  if (action.picks === 'none') {
    if (targets.length > 0) return { ok: false, error: 'that action takes no target' };
    return { ok: true, action, choiceId: letterFor(action), targets: [] };
  }
  if (targets.length === 0) return { ok: false, error: 'name a target' };
  if (targets.some((t) => !allowed.has(t))) return { ok: false, error: 'that is not a valid target' };
  if (action.picks === 'one' && targets.length !== 1) return { ok: false, error: 'name one target' };
  const limit = action.limit ?? action.targets.length;
  if (action.picks === 'many' && targets.length > limit) return { ok: false, error: `name at most ${limit} targets` };
  return { ok: true, action, choiceId: letterFor(action), targets: [...targets] };
}

/** A potion or Second Wind chosen as the action is the heal, so the automatic bonus heal does not also fire. */
export function skipsBonusHeal(actionId: string | undefined, targets: readonly string[] = []): boolean {
  if (actionId === 'feature:second-wind') return true;
  const id = actionId?.startsWith('item:') ? actionId.slice('item:'.length) : actionId === 'common:use-object' ? targets[0] : undefined;
  return id !== undefined && Object.hasOwn(HEALING_POTIONS, id);
}

interface Taken { action: Action; combat: CombatState; sheet: CharacterSheet }

const dodge = (combat: CombatState, sheet: CharacterSheet): Taken => ({ action: { kind: 'dodge' }, combat, sheet });

const told = (combat: CombatState, sheet: CharacterSheet, text: string): Taken => ({ action: { kind: 'other', text }, combat, sheet });

function strike(attacks: readonly Attack[], id: string, target: string, sheet: CharacterSheet, natural: number, combat: CombatState): Taken {
  const weapon = id === 'common:attack' ? attacks.reduce((a, b) => (b.bonus > a.bonus ? b : a)) : weaponById(attacks, id);
  if (!weapon || !target) return dodge(combat, sheet);
  const extra = extraAttacks(sheet);
  return {
    action: { kind: 'attack', attack: weapon.name, target, natural, ...(extra ? { then: Array<string>(extra).fill(weapon.name) } : {}) },
    combat, sheet,
  };
}

function fillBeams(targets: readonly string[], beams: number): string[] {
  return Array.from({ length: beams }, (_, i) => targets[i % targets.length]);
}

function cast(sheet: CharacterSheet, spellId: string, targets: readonly string[], natural: number, combat: CombatState): Taken {
  const spell = srd().spells.get(spellId);
  if (!spell) return told(combat, sheet, `${sheet.name} cannot cast that.`);
  let spent: CharacterSheet;
  let casted: Cast;
  try {
    ({ sheet: spent, cast: casted } = castSpell(sheet, spellId));
  } catch (error) {
    if (error instanceof RuleViolation) return told(combat, sheet, `${sheet.name} cannot cast ${spell.name}: ${error.message}.`);
    throw error;
  }
  if (!spell.damage && !spell.healing && !(spell.save && holdRule(spellId))) return told(combat, spent, `${sheet.name} casts ${spell.name}.`);
  const casting = sheet.spellcasting!;
  const aimed = casted.beams > 1 ? fillBeams(targets, casted.beams) : [...targets];
  return {
    action: {
      kind: 'spell',
      caster: { saveDc: casting.saveDc, attackBonus: casting.attackBonus, modifier: casting.attackBonus - sheet.proficiencyBonus },
      cast: casted, targets: aimed, ...(spell.attack ? { natural } : {}),
    },
    combat, sheet: spent,
  };
}

const withState = (combat: CombatState, rng: Rng, ...changed: CombatState['combatants'][string][]): CombatState =>
  ({ ...combat, rng: rng.state(), combatants: { ...combat.combatants, ...Object.fromEntries(changed.map((c) => [c.id, c])) } });

function stabilize(combat: CombatState, sheet: CharacterSheet, targetId: string): Taken {
  const friend = combat.combatants[targetId];
  if (!friend) return dodge(combat, sheet);
  const rng = seededRng(combat.rng);
  const kit = sheet.equipment.some((e) => e.id === KIT);
  const total = kit ? null : abilityCheck(rng, sheet, { ability: 'wis', skill: 'medicine' }).total;
  const how = total === null ? 'with a Healer\'s Kit' : `(Medicine ${total} vs DC ${STABILIZE_DC})`;
  const next = withState(combat, rng);
  if (total !== null && total < STABILIZE_DC) return told(next, sheet, `${sheet.name} tries to stabilize ${friend.name} ${how}, but cannot.`);
  const stable = { ...friend, status: 'stable' as const, deathSaves: { successes: 0, failures: 0 } };
  return told(withState(combat, rng, stable), sheet, `${sheet.name} stabilizes ${friend.name} ${how}.`);
}

function drink(combat: CombatState, sheet: CharacterSheet, id: string): Taken {
  if (held(sheet, id) < 1 || !Object.hasOwn(HEALING_POTIONS, id)) return told(combat, sheet, `${sheet.name} has no ${itemInfo(id).name} left.`);
  const drunk = drinkPotion(combat, id, HEALING_POTIONS[id]);
  const event = drunk.log.at(-1);
  const healed = event && event.kind === 'potion' ? event.healed : 0;
  return told({ ...drunk, log: drunk.log.slice(0, -1) }, removeItem(sheet, id), `${sheet.name} drinks a ${itemInfo(id).name}: ${healed} HP back.`);
}

function useItem(combat: CombatState, sheet: CharacterSheet, id: string, target: string | undefined): Taken {
  if (Object.hasOwn(HEALING_POTIONS, id)) return drink(combat, sheet, id);
  if (id === KIT) {
    const dying = target ?? Object.values(combat.combatants).find((c) => c.side === 'party' && c.status === 'dying')?.id;
    return dying ? stabilize(combat, sheet, dying) : told(combat, sheet, `${sheet.name} has no one to stabilize.`);
  }
  if (held(sheet, id) < 1) return told(combat, sheet, `${sheet.name} has nothing to use.`);
  const info = items().get(id);
  const name = info?.name ?? id;
  return told(combat, info?.consumable ? removeItem(sheet, id) : sheet, `${sheet.name} uses a ${name}.`);
}

function feature(combat: CombatState, sheet: CharacterSheet, id: string, target: string | undefined): Taken {
  const resource = resourcesOf(sheet).find((r) => r.id === id);
  if (!resource || resource.left <= 0) return told(combat, sheet, `${sheet.name} has no ${resource?.name ?? id} left.`);
  if (id === 'second-wind') {
    const healed = secondWind(combat, sheet.level);
    const event = healed.log.at(-1);
    const hp = event && event.kind === 'secondWind' ? event.healed : 0;
    return told({ ...healed, log: healed.log.slice(0, -1) }, useResource(sheet, id), `${sheet.name} uses Second Wind: ${hp} HP back.`);
  }
  if (id === 'lay-on-hands') {
    const who = target ? combat.combatants[target] : undefined;
    if (!who) return dodge(combat, sheet);
    const amount = Math.min(resource.left, who.maxHp - who.hp);
    if (amount < 1) return told(combat, sheet, `${who.name} is not hurt.`);
    const after = heal(who, amount);
    const next = { ...combat, combatants: { ...combat.combatants, [who.id]: after } };
    return told(next, useResource(sheet, id, amount), `${sheet.name} lays on hands: ${who.name} regains ${after.hp - who.hp} HP.`);
  }
  return told(combat, useResource(sheet, id), `${sheet.name} uses ${resource.name}.`);
}

const ASIDE: Record<string, string> = {
  'common:dash': 'dashes',
  'common:disengage': 'disengages',
  'common:hide': 'hides',
  'common:ready': 'readies an action',
};

/**
 * The named action, as the engine plays it on this hero's turn. A letter choice is not passed here.
 * If the action can no longer be taken (the slot went, the foe fell), the hero dodges rather than
 * the table stopping.
 */
export function resolveNamedAction(combat: CombatState, sheet: CharacterSheet, playerId: string, actionId: string, targets: readonly string[], natural: number): Taken {
  try {
    const me = combat.combatants[playerId];
    const attacks = me?.attacks ?? [];
    if (actionId.startsWith('attack:') || actionId === 'common:attack') return strike(attacks, actionId, targets[0] ?? '', sheet, natural, combat);
    if (actionId.startsWith('spell:')) return cast(sheet, actionId.slice('spell:'.length), targets, natural, combat);
    if (actionId.startsWith('item:')) return useItem(combat, sheet, actionId.slice('item:'.length), targets[0]);
    if (actionId.startsWith('feature:')) return feature(combat, sheet, actionId.slice('feature:'.length), targets[0]);
    if (actionId === 'common:dodge') return dodge(combat, sheet);
    if (actionId === 'common:help') {
      const friend = combat.combatants[targets[0] ?? ''];
      if (friend?.status === 'dying') return stabilize(combat, sheet, friend.id);
      return told(combat, sheet, `${sheet.name} helps ${friend?.name ?? 'an ally'}.`);
    }
    if (actionId === 'common:use-object') return useItem(combat, sheet, targets[0] ?? '', undefined);
    if (actionId === 'common:break-free') {
      const third = takeThird(combat, sheet, playerId);
      return { action: third.action, combat: third.combat, sheet: third.sheet };
    }
    if (actionId.startsWith('move:')) {
      const move = parseMoveKey(actionId);
      if (!move) return dodge(combat, sheet);
      try {
        validateMove(combat, playerId, move);
      } catch (error) {
        if (error instanceof RuleViolation) return told(combat, sheet, error.message);
        throw error;
      }
      return { action: { kind: 'move', ...move }, combat, sheet };
    }
    const verb = ASIDE[actionId];
    if (verb) return told(combat, sheet, `${sheet.name} ${verb}.`);
    return dodge(combat, sheet);
  } catch (error) {
    if (error instanceof RuleViolation) return dodge(combat, sheet);
    throw error;
  }
}
