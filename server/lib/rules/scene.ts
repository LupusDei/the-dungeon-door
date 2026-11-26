/**
 * A combat scene: initiative, turns and rounds over plain-JSON state, resumable from storage. Heroes act by
 * their players' votes (the vote's d20 is the roll); monsters act by simple rules. See docs/rules-design.md.
 */
import type { Combatant, Condition, Status } from './combatant.ts';
import type { Power, Rider } from './powers.ts';
import { parseDice, rollDice } from './dice.ts';
import { addCondition, type AttackResult, type Cover, type D20, damageAfterDefenses, attackRoll, deathSave, heal, rollD20, savingThrow, takeDamage } from './resolve.ts';
import { type Rng, seededRng } from './rng.ts';
import { areaCatch, type Caster, resolveSpell, type SpellOutcome } from './spellEffects.ts';
import type { Cast } from './spells.ts';
import { lookup, require } from './violation.ts';

export type Action =
  /** `then`: the turn's further attacks (Multiattack, Extra Attack), each at the most wounded foe still up. */
  | { kind: 'attack'; attack: string; target: string; natural?: number; cover?: Cover; advantage?: boolean; disadvantage?: boolean; then?: string[] }
  /** `as`: the monster's own action it Dodges with (it has no attack: Shriek, Bubble Dash). */
  | { kind: 'dodge'; as?: string }
  /** Any other action, already resolved by the caller (play/actions.ts): it is told and spends the turn. */
  | { kind: 'other'; text: string }
  /** A monster's save ability (powers.ts) at these targets. */
  | { kind: 'power'; power: string; targets: string[] }
  /** A cast from castSpell (the slot is already spent on the sheet), at these targets (one per beam). */
  | { kind: 'spell'; caster: Omit<Caster, 'combatant'>; cast: Cast; targets: string[]; natural?: number };
export type CombatEvent =
  /** `rider`: the condition the hit brought, or its save made. */
  | { kind: 'attack'; round: number; actor: string; result: AttackResult; reaction?: true; rider?: RiderOutcome }
  | { kind: 'spell'; round: number; actor: string; spellId: string; outcomes: SpellOutcome[] }
  | { kind: 'dodge'; round: number; actor: string; as?: string }
  | { kind: 'other'; round: number; actor: string; text: string }
  | { kind: 'power'; round: number; actor: string; power: string; dc: number; ability: string; outcomes: PowerOutcome[] }
  /** A spent power comes back on its d6 at the start of the monster's turn. */
  | { kind: 'recharge'; round: number; actor: string; power: string; roll: number }
  | { kind: 'deathSave'; round: number; actor: string; status: Status }
  | { kind: 'skip'; round: number; actor: string }
  /** A healing potion drunk as a Bonus Action before the turn's action. */
  | { kind: 'potion'; round: number; actor: string; item: string; healed: number }
  /** A fighter's Second Wind, a Bonus Action before the turn's action. */
  | { kind: 'secondWind'; round: number; actor: string; healed: number };
export interface Choice { label: string; action: Action }
export interface RiderOutcome { dc: number; ability: string; roll: D20 | null; success: boolean; condition: Condition | null }
/** `condition`: what the failed save brought (none if it is immune). */
export interface PowerOutcome { target: string; roll: D20 | null; success: boolean; damage: number; condition: Condition | null }

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
    if (canAct(c)) return recharged(s, c, rng);
    s = c.status === 'dying' ? afterDeathSave(s, id, rng) : withEvent(s, { kind: 'skip', round: s.round, actor: id }, c);
  }
  return s;
}

const rechargeOf = (p: Power) => (p.uses?.kind === 'recharge' ? p.uses.min : null);

/** At the start of its turn a monster rolls a d6 for each spent power that recharges; on its number it is back. */
function recharged(state: CombatState, c: Combatant, rng: Rng): CombatState {
  return (c.powers ?? []).filter((p) => rechargeOf(p) !== null && (c.spent?.[p.name] ?? 0) > 0).reduce((s, p) => {
    const roll = rng.die(6);
    if (roll < rechargeOf(p)!) return s;
    const me = s.combatants[c.id];
    return withEvent(s, { kind: 'recharge', round: s.round, actor: c.id, power: p.name, roll }, { ...me, spent: { ...me.spent, [p.name]: 0 } });
  }, state);
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

function strike(state: CombatState, actor: Combatant, target: Combatant, action: Extract<Action, { kind: 'attack' }>, rng: Rng): CombatState {
  const disadvantage = action.disadvantage || state.dodging.includes(target.id);
  const { result, target: hurt } = attackRoll(rng, actor, action.attack, target, { ...action, disadvantage });
  const rider = actor.attacks.find((a) => a.name === action.attack)!.rider;
  if (!rider || !result.hit || hurt.status === 'dead') return withEvent(state, { kind: 'attack', round: state.round, actor: actor.id, result }, hurt);
  const ridden = ride(rng, hurt, rider);
  return withEvent(state, { kind: 'attack', round: state.round, actor: actor.id, result, rider: ridden.outcome }, ridden.target);
}

/** A hit's rider: the target saves if it may; a failure (or no save) brings the condition, unless it is immune. */
function ride(rng: Rng, target: Combatant, rider: Rider): { outcome: RiderOutcome; target: Combatant } {
  const { roll, success } = rider.save ? savingThrow(rng, target, rider.ability, rider.dc, {}) : { roll: null, success: false };
  const after = success ? target : addCondition(target, rider.lasting.condition);
  const condition = !success && after.conditions.includes(rider.lasting.condition) ? rider.lasting.condition : null;
  return { outcome: { dc: rider.dc, ability: rider.ability, roll, success, condition }, target: after };
}

/** The living, up combatants against `side`. */
const upAgainst = (state: CombatState, side: Combatant['side']) => Object.values(state.combatants).filter((c) => c.side !== side && c.status === 'up');
const fewestHp = (cs: Combatant[]) => cs.reduce((low, c) => (c.hp < low.hp ? c : low));

/** One more attack this turn, at the most wounded foe still up; none left, no attack. */
function followUp(state: CombatState, actorId: string, attack: string, rng: Rng): CombatState {
  const targets = upAgainst(state, state.combatants[actorId].side);
  return targets.length ? strike(state, state.combatants[actorId], fewestHp(targets), { kind: 'attack', attack, target: '' }, rng) : state;
}

function resolveAttack(state: CombatState, actor: Combatant, action: Extract<Action, { kind: 'attack' }>, rng: Rng): CombatState {
  const target = lookup(new Map(Object.entries(state.combatants)), action.target, 'combatant');
  require(target.side !== actor.side, `${actor.name} will not attack an ally`);
  return (action.then ?? []).reduce((s, attack) => followUp(s, actor.id, attack, rng), strike(state, actor, target, action, rng));
}

function resolveCast(state: CombatState, actor: Combatant, action: Extract<Action, { kind: 'spell' }>, rng: Rng): CombatState {
  const byId = new Map(Object.entries(state.combatants));
  const targets = action.targets.map((id) => lookup(byId, id, 'combatant'));
  const resolved = resolveSpell(rng, { ...action.caster, combatant: actor }, action.cast, targets, { attack: { natural: action.natural } });
  return withEvent(state, { kind: 'spell', round: state.round, actor: actor.id, spellId: action.cast.spellId, outcomes: resolved.outcomes }, ...resolved.targets);
}

/** One target's save against a power: all the rolled damage, half or none, after its defenses; a failure may bring the condition. */
function saveAgainst(rng: Rng, target: Combatant, power: Power, rolled: { type: string; amount: number }[]): { outcome: PowerOutcome; target: Combatant } {
  const { roll, success } = savingThrow(rng, target, power.ability, power.dc, {});
  const share = (amount: number) => (success ? (power.half ? Math.floor(amount / 2) : 0) : amount);
  const taken = rolled.reduce((sum, d) => sum + damageAfterDefenses(target, share(d.amount), d.type), 0);
  const hurt = takeDamage(target, taken, false);
  const lasting = success || hurt.status === 'dead' ? null : power.lasting;
  const after = lasting ? addCondition(hurt, lasting.condition) : hurt;
  const condition = lasting && after.conditions.includes(lasting.condition) ? lasting.condition : null;
  return { outcome: { target: target.id, roll, success, damage: taken, condition }, target: after };
}

/** The damage is rolled once for everyone; each target saves (saveAgainst); the use is spent. */
function resolvePower(state: CombatState, actor: Combatant, action: Extract<Action, { kind: 'power' }>, rng: Rng): CombatState {
  const power = actor.powers!.find((p) => p.name === action.power)!;
  const rolled = power.damage.map((d) => ({ type: d.type, amount: rollDice(rng, parseDice(d.dice)).total }));
  const hit = action.targets.map((id) => saveAgainst(rng, state.combatants[id], power, rolled));
  const spent = { ...actor, spent: { ...actor.spent, [power.name]: (actor.spent?.[power.name] ?? 0) + 1 } };
  const event: CombatEvent = { kind: 'power', round: state.round, actor: actor.id, power: power.name, dc: power.dc, ability: power.ability, outcomes: hit.map((h) => h.outcome) };
  return withEvent(state, event, spent, ...hit.map((h) => h.target));
}

const dodge = (state: CombatState, actor: Combatant, as?: string) =>
  withEvent({ ...state, dodging: [...state.dodging, actor.id] }, { kind: 'dodge', round: state.round, actor: actor.id, ...(as ? { as } : {}) }, actor);

const ACTIONS: { [K in Action['kind']]: (state: CombatState, actor: Combatant, action: Extract<Action, { kind: K }>, rng: Rng) => CombatState } = {
  attack: resolveAttack,
  spell: resolveCast,
  dodge: (state, actor, action) => dodge(state, actor, action.as),
  power: resolvePower,
  other: (state, actor, action) => withEvent(state, { kind: 'other', round: state.round, actor: actor.id, text: action.text }, actor),
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

/** The current combatant heals itself by `dice` as a Bonus Action, told by `told`; its action is still to come. */
function bonusHeal(state: CombatState, dice: string, told: (actor: string, healed: number) => CombatEvent): CombatState {
  const rng = seededRng(state.rng);
  const me = state.combatants[currentActor(state)];
  const healed = heal(me, rollDice(rng, parseDice(dice)).total);
  return { ...withEvent(state, told(me.id, healed.hp - me.hp), healed), rng: rng.state() };
}

/** The current combatant drinks a healing potion (`dice`) as a Bonus Action. */
export const drinkPotion = (state: CombatState, item: string, dice: string): CombatState =>
  bonusHeal(state, dice, (actor, healed) => ({ kind: 'potion', round: state.round, actor, item, healed }));

/** The current combatant, a fighter, uses Second Wind as a Bonus Action: 1d10 + its Fighter level (5.2). */
export const secondWind = (state: CombatState, fighterLevel: number): CombatState =>
  bonusHeal(state, `1d10+${fighterLevel}`, (actor, healed) => ({ kind: 'secondWind', round: state.round, actor, healed }));

/** Whether a power can be used now: at will, not spent while it recharges, or with uses left. */
function ready(me: Combatant, p: Power): boolean {
  const spent = me.spent?.[p.name] ?? 0;
  if (p.uses?.kind === 'per-day') return spent < p.uses.times;
  return spent === 0;
}

/** Its best move now: a power that recharges or runs out when it is ready; an at-will power only when it has no attack. */
function chosenPower(me: Combatant): Power | undefined {
  const powers = me.powers ?? [];
  return powers.find((p) => p.uses !== null && ready(me, p)) ?? (me.attacks.length ? undefined : powers[0]);
}

/** Those a power catches: the most wounded heroes up, as many as its area holds (areaCatch), or one. */
function caughtBy(state: CombatState, me: Combatant, p: Power): string[] {
  const up = upAgainst(state, me.side).sort((a, b) => a.hp - b.hp);
  return up.slice(0, p.area ? areaCatch(p.area) : 1).map((c) => c.id);
}

/**
 * A monster's turn: a ready power that recharges or runs out; else its Multiattack, or its first melee attack (or
 * first attack), on the up hero with the fewest HP, sparing one who Dodges if it can; with neither, it Dodges.
 * Null on a hero's turn.
 */
export function monsterAction(state: CombatState): Action | null {
  const me = state.combatants[currentActor(state)];
  if (me.side === 'party') return null;
  const power = chosenPower(me);
  if (power) return { kind: 'power', power: power.name, targets: caughtBy(state, me, power) };
  if (me.attacks.length === 0) return { kind: 'dodge', ...(me.idle ? { as: me.idle } : {}) }; // nothing to harm anyone with (SRD: Shriek, Bubble Dash)
  const up = upAgainst(state, me.side);
  const open = up.filter((c) => !state.dodging.includes(c.id));
  const target = fewestHp(open.length ? open : up);
  const [first, ...then] = me.multiattack ?? [(me.attacks.find((a) => !a.ranged) ?? me.attacks[0]).name];
  return { kind: 'attack', attack: first, target: target.id, ...(then.length ? { then } : {}) };
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
