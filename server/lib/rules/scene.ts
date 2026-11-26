/**
 * A combat scene: initiative, turns and rounds over plain-JSON state, resumable from storage. Heroes act by
 * their players' votes (the vote's d20 is the roll); monsters act by simple rules. See docs/rules-design.md.
 */
import type { Combatant, Status } from './combatant.ts';
import { parseDice, rollDice } from './dice.ts';
import { type AttackResult, type Cover, attackRoll, deathSave, heal, rollD20 } from './resolve.ts';
import { type Rng, seededRng } from './rng.ts';
import { type Caster, resolveSpell, type SpellOutcome } from './spellEffects.ts';
import type { Cast } from './spells.ts';
import { lookup, require } from './violation.ts';

export type Action =
  | { kind: 'attack'; attack: string; target: string; natural?: number; cover?: Cover; advantage?: boolean; disadvantage?: boolean }
  | { kind: 'dodge' }
  /** A cast from castSpell (the slot is already spent on the sheet), at these targets (one per beam). */
  | { kind: 'spell'; caster: Omit<Caster, 'combatant'>; cast: Cast; targets: string[]; natural?: number };
export type CombatEvent =
  | { kind: 'attack'; round: number; actor: string; result: AttackResult; reaction?: true }
  | { kind: 'spell'; round: number; actor: string; spellId: string; outcomes: SpellOutcome[] }
  | { kind: 'dodge'; round: number; actor: string }
  | { kind: 'deathSave'; round: number; actor: string; status: Status }
  | { kind: 'skip'; round: number; actor: string }
  /** A healing potion drunk as a Bonus Action before the turn's action. */
  | { kind: 'potion'; round: number; actor: string; item: string; healed: number };
export interface Choice { label: string; action: Action }

export interface CombatState {
  version: 1;
  round: number;
  /** Index into `order` of whoever acts now. */
  turn: number;
  order: string[];
  initiative: Record<string, number>;
  combatants: Record<string, Combatant>;
  /** Who took the Dodge action; it lasts until their next turn. */
  dodging: string[];
  /** The seeded rng's state; seededRng(rng) continues the dice. */
  rng: number;
  outcome: 'ongoing' | 'victory' | 'defeat';
  /** What happened, oldest first, for the DM to narrate. */
  log: CombatEvent[];
}

/** Highest roll first; ties to the higher initiative bonus, then to the order given. */
export function orderByInitiative(rolls: readonly { id: string; roll: number; bonus: number }[]): string[] {
  return [...rolls].sort((a, b) => b.roll - a.roll || b.bonus - a.bonus).map((r) => r.id);
}

const CANNOT_ACT = ['incapacitated', 'paralyzed', 'petrified', 'stunned', 'unconscious'];
const canAct = (c: Combatant) => c.status === 'up' && !c.conditions.some((x) => CANNOT_ACT.includes(x));

export const currentActor = (state: CombatState): string => state.order[state.turn];

function outcomeOf(combatants: Record<string, Combatant>): CombatState['outcome'] {
  const all = Object.values(combatants);
  if (all.every((c) => c.side === 'party' || c.status === 'dead')) return 'victory';
  return all.some((c) => c.side === 'party' && c.status === 'up') ? 'ongoing' : 'defeat';
}

/** Moves to the next combatant who can act, rolling death saves and skipping the fallen on the way. */
function advance(state: CombatState, rng: Rng): CombatState {
  let s = state;
  for (let steps = 0; steps < s.order.length * 3 && s.outcome === 'ongoing'; steps++) {
    const turn = (s.turn + 1) % s.order.length;
    s = { ...s, turn, round: turn === 0 ? s.round + 1 : s.round };
    const id = currentActor(s);
    s = { ...s, dodging: s.dodging.filter((d) => d !== id) };
    const c = s.combatants[id];
    if (canAct(c)) return s;
    s = c.status === 'dying' ? afterDeathSave(s, id, rng) : withEvent(s, { kind: 'skip', round: s.round, actor: id }, c);
  }
  return s;
}

function withEvent(state: CombatState, event: CombatEvent, ...changed: Combatant[]): CombatState {
  const combatants = { ...state.combatants, ...Object.fromEntries(changed.map((c) => [c.id, c])) };
  return { ...state, combatants, log: [...state.log, event], outcome: outcomeOf(combatants) };
}

function afterDeathSave(state: CombatState, id: string, rng: Rng): CombatState {
  const c = deathSave(rng, state.combatants[id]);
  return withEvent(state, { kind: 'deathSave', round: state.round, actor: id, status: c.status }, c);
}

export function startCombat(seed: number, combatants: readonly Combatant[]): CombatState {
  const rng = seededRng(seed);
  const rolls = combatants.map((c) => ({ id: c.id, roll: rollD20(rng, c.initiative, 'normal').total, bonus: c.initiative }));
  const order = orderByInitiative(rolls);
  const state: CombatState = {
    // Round 0, last turn: advancing once opens round 1 with the highest roll.
    version: 1, round: 0, turn: order.length - 1, order,
    initiative: Object.fromEntries(rolls.map((r) => [r.id, r.roll])),
    combatants: Object.fromEntries(combatants.map((c) => [c.id, c])),
    dodging: [], rng: rng.state(), outcome: outcomeOf(Object.fromEntries(combatants.map((c) => [c.id, c]))), log: [],
  };
  const begun = advance(state, rng);
  return { ...begun, rng: rng.state() };
}

/** What combatant `id` can do now: each attack against each living foe, and Dodge. */
export function choicesFor(state: CombatState, id: string): Choice[] {
  const me = lookup(new Map(Object.entries(state.combatants)), id, 'combatant');
  const foes = Object.values(state.combatants).filter((c) => c.side !== me.side && c.status !== 'dead');
  const attacks = me.attacks.flatMap((a) => foes.map((f): Choice => ({ label: `${a.name}: ${f.name}`, action: { kind: 'attack', attack: a.name, target: f.id } })));
  return [...attacks, { label: 'Dodge', action: { kind: 'dodge' } }];
}

function resolveAttack(state: CombatState, actor: Combatant, action: Extract<Action, { kind: 'attack' }>, rng: Rng): CombatState {
  const target = lookup(new Map(Object.entries(state.combatants)), action.target, 'combatant');
  require(target.side !== actor.side, `${actor.name} will not attack an ally`);
  const disadvantage = action.disadvantage || state.dodging.includes(target.id);
  const { result, target: hurt } = attackRoll(rng, actor, action.attack, target, { ...action, disadvantage });
  return withEvent(state, { kind: 'attack', round: state.round, actor: actor.id, result }, hurt);
}

function resolveCast(state: CombatState, actor: Combatant, action: Extract<Action, { kind: 'spell' }>, rng: Rng): CombatState {
  const byId = new Map(Object.entries(state.combatants));
  const targets = action.targets.map((id) => lookup(byId, id, 'combatant'));
  const resolved = resolveSpell(rng, { ...action.caster, combatant: actor }, action.cast, targets, { attack: { natural: action.natural } });
  return withEvent(state, { kind: 'spell', round: state.round, actor: actor.id, spellId: action.cast.spellId, outcomes: resolved.outcomes }, ...resolved.targets);
}

const dodge = (state: CombatState, actor: Combatant) =>
  withEvent({ ...state, dodging: [...state.dodging, actor.id] }, { kind: 'dodge', round: state.round, actor: actor.id }, actor);

const ACTIONS: { [K in Action['kind']]: (state: CombatState, actor: Combatant, action: Extract<Action, { kind: K }>, rng: Rng) => CombatState } = {
  attack: resolveAttack,
  spell: resolveCast,
  dodge: (state, actor) => dodge(state, actor),
};

/** The current combatant takes `action`; then the turn passes on. */
export function act(state: CombatState, action: Action): CombatState {
  require(state.outcome === 'ongoing', 'the combat is over');
  const rng = seededRng(state.rng);
  const actor = state.combatants[currentActor(state)];
  const done = (ACTIONS[action.kind] as (s: CombatState, a: Combatant, x: Action, r: Rng) => CombatState)(state, actor, action, rng);
  const next = advance(done, rng);
  return { ...next, rng: rng.state() };
}

/** A reaction attack outside the turn order (an Opportunity Attack on a fleeing foe): nobody's turn is spent. */
export function reactionAttack(state: CombatState, actor: string, attack: string, target: string): CombatState {
  const rng = seededRng(state.rng);
  const done = resolveAttack(state, state.combatants[actor], { kind: 'attack', attack, target }, rng);
  const event = { ...done.log[done.log.length - 1], reaction: true as const };
  return { ...done, log: [...done.log.slice(0, -1), event], rng: rng.state() };
}

/** The current combatant drinks a healing potion (`dice`) as a Bonus Action; its action is still to come. */
export function drinkPotion(state: CombatState, item: string, dice: string): CombatState {
  const rng = seededRng(state.rng);
  const me = state.combatants[currentActor(state)];
  const healed = heal(me, rollDice(rng, parseDice(dice)).total);
  const event: CombatEvent = { kind: 'potion', round: state.round, actor: me.id, item, healed: healed.hp - me.hp };
  return { ...withEvent(state, event, healed), rng: rng.state() };
}

/** A monster's turn: its first melee attack (or first attack) on the up hero with the fewest HP. Null on a hero's turn. */
export function monsterAction(state: CombatState): Action | null {
  const me = state.combatants[currentActor(state)];
  if (me.side === 'party') return null;
  const targets = Object.values(state.combatants).filter((c) => c.side === 'party' && c.status === 'up');
  const target = targets.reduce((low, c) => (c.hp < low.hp ? c : low));
  const attack = me.attacks.find((a) => !a.ranged) ?? me.attacks[0];
  return { kind: 'attack', attack: attack.name, target: target.id };
}

/** Plays turns until the round ends or the combat does: heroes by `votes` (Dodge without one), monsters by rule. */
export function playRound(state: CombatState, votes: Readonly<Record<string, Action>>): CombatState {
  let s = state;
  const round = s.round;
  while (s.outcome === 'ongoing' && s.round === round) s = act(s, monsterAction(s) ?? votes[currentActor(s)] ?? { kind: 'dodge' });
  return s;
}

/** XP for the foes defeated so far. */
export const xpEarned = (state: CombatState): number =>
  Object.values(state.combatants).filter((c) => c.side === 'foes' && c.status === 'dead').reduce((sum, c) => sum + c.xp, 0);
