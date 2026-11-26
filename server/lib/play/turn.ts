/**
 * One turn of play through the rules engine: the party's choice (and its hook), or a combat round. Pure:
 * the game (lib/game.ts) loads the state, calls playTurn, and stores what comes back.
 */
import type { CharacterSheet } from '../rules/sheet.ts';
import type { HazardSpec } from '../rules/hazards.ts';
import { capFight } from '../rules/encounter.ts';
import { sightOf } from '../rules/light.ts';
import { seededRng } from '../rules/rng.ts';
import type { ChoiceId } from '../types.ts';
import { groupRoll } from './checks.ts';
import { arrival, claimTreasure, clearRoom, dungeonLevel, enter, foeLevels, habitatOf, partyLevel, waitingFoes, withAttitude } from './delve.ts';
import { shakeOff } from './conditions.ts';
import { provisions } from './provisions.ts';
import { afterHarm } from './dying.ts';
import { fightRound, startFight, type FightEnd } from './fight.ts';
import { foesNamed, type RollHook, type RulesHook } from './hooks.ts';
import { parley, rollAttitude } from './parley.ts';
import { partyRest } from './rest.ts';
import { newlyDead, raiseTheDead, revivify } from './revive.ts';
import type { CombatState, DungeonState, PartyState } from './state.ts';
import { buyItems, sellItems, type Traded, usePotion } from './trade.ts';
import { checksDue, wanderingChecks, wanderingRoll, type Wanderers } from './wandering.ts';
import { ambientLight, clockOf, lightLevel, lightUp, passTime, secondsFor } from './time.ts';
import { partyHazard, springTrap } from './traps.ts';

export interface RulesState { party: PartyState; combat: CombatState | null; dungeon: DungeonState | null }
export interface Ballot { playerId: string; choiceId: ChoiceId; roll: number }
export type FightNews = 'started' | FightEnd | null;
export interface RulesTurn extends RulesState { lines: string[]; success: boolean | null; fight: FightNews }

/** The most-voted choice; a tie goes to the choice whose voters rolled highest, then to the first. */
export function pickChoice(leaders: readonly ChoiceId[], ballots: readonly Ballot[]): ChoiceId | null {
  const best = (id: ChoiceId) => Math.max(...ballots.filter((b) => b.choiceId === id).map((b) => b.roll));
  return leaders.reduce<ChoiceId | null>((top, id) => (top === null || best(id) > best(top) ? id : top), null);
}

const done = (s: RulesState, lines: string[] = [], success: boolean | null = null, fight: FightNews = null): RulesTurn =>
  ({ ...s, lines, success, fight });

/** Whoever the harm left at 0 HP is dying, and is settled; whoever it killed may be Revivified on the spot. */
function harmed(before: PartyState, t: { party: PartyState; lines: string[] }): { party: PartyState; lines: string[] } {
  const settled = afterHarm(t.party);
  const back = revivify(settled.party, newlyDead(before, settled.party));
  return { party: back.party, lines: [...t.lines, ...settled.lines, ...back.lines] };
}

const votesOf = (ballots: readonly Ballot[]) => Object.fromEntries(ballots.map((b) => [b.playerId, b.roll]));
/** The levels a band, a trap or a proposed fight is scaled to (play/delve.ts foeLevels). */
const foesFor = (s: RulesState) => foeLevels(s.party, s.dungeon);
const poolOf = (s: RulesState) => habitatOf(s.dungeon);

function roll(s: RulesState, hook: RollHook, ballots: readonly Ballot[], before: string[] = []): RulesTurn {
  const rng = seededRng(s.party.rng);
  const light = lightLevel(s);
  const heroes = Object.entries(s.party.sheets).filter(([, sheet]) => !sheet.dead).map(([playerId, sheet]) => ({ playerId, sheet, sight: sightOf(sheet, light) }));
  const rolled = groupRoll(heroes, hook, votesOf(ballots), rng);
  const sheets = { ...s.party.sheets, ...Object.fromEntries(rolled.sheets.map((h) => [h.playerId, h.sheet])) };
  const settled = harmed(s.party, { party: { ...s.party, rng: rng.state(), sheets }, lines: rolled.lines });
  return done({ ...s, party: settled.party }, [...before, ...settled.lines], rolled.success);
}

function fight(s: RulesState, monsterIds: readonly string[], before: string[] = []): RulesTurn {
  const started = startFight(s.party, monsterIds, lightLevel(s));
  return done({ ...s, party: started.party, combat: started.combat }, [...before, ...started.lines], null, 'started');
}

/** The room the party is in is dealt with: its treasure is taken and it is cleared. */
function clearHere(s: RulesState, lines: string[]): { state: RulesState; lines: string[] } {
  const dungeon = s.dungeon;
  if (!dungeon || dungeon.cleared.includes(dungeon.at)) return { state: s, lines };
  const treasure = dungeon.map.nodes[dungeon.at].contents?.treasure;
  const loot = treasure ? claimTreasure(s.party, treasure) : { party: s.party, lines: [] };
  return { state: { ...s, party: loot.party, dungeon: clearRoom(dungeon, dungeon.at) }, lines: [...lines, ...loot.lines] };
}

function combatRound(s: RulesState, combat: CombatState, ballots: readonly Ballot[]): RulesTurn {
  const votes = Object.fromEntries(ballots.map((b) => [b.playerId, { choiceId: b.choiceId, roll: b.roll }]));
  const round = fightRound(s.party, combat, votes);
  const after = { ...s, party: round.party, combat: round.ended ? null : round.combat };
  if (round.ended === null || round.ended === 'defeat') return done(after, round.lines, null, round.ended);
  const cleared = clearHere(after, round.lines);
  return done(loud(cleared.state), cleared.lines, null, round.ended);
}

/** A fight ended or a trap went off: wanderers may have heard. */
const loud = (s: RulesState): RulesState => (s.dungeon ? { ...s, dungeon: { ...s.dungeon, noise: true } } : s);

function trap(s: RulesState, id: string, ballots: readonly Ballot[], before: string[] = []): RulesTurn {
  const sprung = springTrap(s.party, id, partyLevel(foesFor(s)), votesOf(ballots), lightLevel(s));
  const settled = harmed(s.party, sprung);
  const after = { ...s, party: settled.party };
  return done(sprung.success ? after : loud(after), [...before, ...settled.lines], sprung.success);
}

/** Foes met in a room: Hostile ones attack; the others watch and wait (their attitude is kept for the room). */
function meet(s: RulesState, monsters: string[], before: string[]): RulesTurn {
  const dungeon = s.dungeon!;
  const known = dungeon.attitudes?.[dungeon.at];
  const rng = seededRng(s.party.rng);
  const met = known ? { attitude: known, roll: null } : rollAttitude(rng, monsters);
  const here = { ...s, party: { ...s.party, rng: rng.state() }, dungeon: withAttitude(dungeon, met.attitude) };
  const told = `${foesNamed(monsters)}: ${met.attitude}${met.roll === null ? '' : ` (2d6: ${met.roll})`}.`;
  if (met.attitude === 'hostile') return fight(here, monsters, [...before, told]);
  return done(here, [...before, `${told} They watch and wait.`]);
}

/** The party parleys with the foes waiting here, or with those the DM names (Indifferent). */
function talk(s: RulesState, offered: readonly string[] | null | undefined, ballots: readonly Ballot[]): RulesTurn {
  const waiting = s.dungeon && waitingFoes(s.dungeon);
  const monsters = waiting ? waiting.monsters : offered;
  if (!monsters || monsters.length === 0) return done(s, ['There is no one here to talk to.']);
  const talked = parley(s.party, monsters, waiting ? waiting.attitude : 'indifferent', votesOf(ballots));
  const dungeon = waiting ? (talked.success ? clearRoom(s.dungeon!, s.dungeon!.at) : withAttitude(s.dungeon!, talked.attitude)) : s.dungeon;
  const after = { ...s, party: talked.party, dungeon };
  if (talked.attitude === 'hostile') return fight(after, monsters, talked.lines);
  return done(after, talked.lines, talked.success);
}

function move(s: RulesState, exit: string, ballots: readonly Ballot[]): RulesTurn {
  const moved = s.dungeon && enter(s.dungeon, exit);
  if (!moved) return done(s, ['That way is closed.']);
  if (moved.node.type === 'corridor') return through(s, moved, exit, ballots);
  return arrive(s, moved, ballots, []);
}

type Moved = NonNullable<ReturnType<typeof enter>>;

/** Into an area: light where needed, then what is there springs (foes met, a trap), then its treasure is taken. */
function arrive(s: RulesState, moved: Moved, ballots: readonly Ballot[], before: string[]): RulesTurn {
  const entered = { ...s, dungeon: moved.dungeon };
  const lit = lightUp(s.party, ambientLight(entered));
  const here = { ...entered, party: lit.party };
  const lines = [...before, `The party enters ${moved.node.name}${moved.node.purpose ? `: ${moved.node.purpose}` : ''}.`, ...deeperLine(s.dungeon!, moved.dungeon), ...lit.lines];
  const found = arrival(moved.dungeon, moved.node);
  if (found.fight) return meet(here, found.fight, lines);
  const trapped = found.trap ? trap(here, found.trap, ballots, lines) : done(here, lines);
  const cleared = clearHere(trapped, trapped.lines);
  return { ...trapped, ...cleared.state, lines: cleared.lines };
}

/** The way went a level deeper on this move. */
const deeperLine = (before: DungeonState, after: DungeonState): string[] =>
  (dungeonLevel(after) > dungeonLevel(before) ? [`The way leads deeper: dungeon level ${dungeonLevel(after)}.`] : []);

const CORRIDOR_SECONDS = 600;

/** A corridor is passed through on the way (ten minutes): its trap springs, then the party goes on to the room. */
function through(s: RulesState, moved: Moved, exit: string, ballots: readonly Ballot[]): RulesTurn {
  const lit = lightUp(s.party, ambientLight({ ...s, dungeon: moved.dungeon }));
  const here: RulesState = { ...s, party: lit.party, dungeon: moved.dungeon };
  const lines = [`The party goes by way of a ${moved.node.name.toLowerCase()}.`, ...lit.lines];
  const found = arrival(moved.dungeon, moved.node);
  const trapped = found.trap ? trap(here, found.trap, ballots, lines) : done(here, lines);
  const timed = passTime(trapped.party, CORRIDOR_SECONDS, ambientLight(trapped));
  const after: RulesState = { ...trapped, party: timed.party, dungeon: clearRoom(trapped.dungeon!, moved.node.id) };
  const spoor = onTheWay(after, moved.node.contents?.special === 'spoor');
  const sofar = [...trapped.lines, ...timed.lines];
  if (spoor.came) return { ...meetWanderers(done(spoor.state, sofar), spoor.came), success: trapped.success };
  return { ...arrive(spoor.state, enter(spoor.state.dungeon!, exit)!, ballots, sofar), success: trapped.success };
}

/** A check in the corridor itself, 2 in 6 where there is spoor (wandering.ts). */
function onTheWay(s: RulesState, spoor: boolean): { state: RulesState; came: Wanderers | null } {
  if (!spoor) return { state: s, came: null };
  const rng = seededRng(s.party.rng);
  const came = wanderingRoll(rng, foesFor(s), 2, poolOf(s));
  return { state: { ...s, party: { ...s.party, rng: rng.state() } }, came };
}

/** Wanderers arrive: Hostile ones attack; the others go their way. */
function meetWanderers(t: RulesTurn, came: Wanderers): RulesTurn {
  const rng = seededRng(t.party.rng);
  const met = rollAttitude(rng, came.monsters);
  const here = { ...t, party: { ...t.party, rng: rng.state() } };
  const told = `${came.line} They are ${met.attitude}${met.roll === null ? '' : ` (2d6: ${met.roll})`}.`;
  if (met.attitude === 'hostile') return { ...fight(here, came.monsters, [...t.lines, told]), success: t.success };
  return { ...here, lines: [...t.lines, `${told} They go their way.`] };
}

/** After the turn's time, the checks due (noise first, 2 in 6); a fight on, or foes waiting here, keeps others off. */
function wander(t: RulesTurn, seconds: number): RulesTurn {
  const d = t.dungeon;
  if (!d || t.combat || waitingFoes(d)) return t;
  const { noise, ...quiet } = d;
  const due = checksDue(d.wander ?? 0, seconds);
  const rng = seededRng(t.party.rng);
  const came = wanderingChecks(rng, foesFor(t), due.checks, noise === true, poolOf(t));
  const calm = { ...t, party: { ...t.party, rng: rng.state() }, dungeon: { ...quiet, wander: due.since } };
  return came ? meetWanderers(calm, came) : calm;
}

/** A rest in a dungeon: one check first (wandering.ts); wanderers who come interrupt it. */
function rest(s: RulesState, kind: 'short' | 'long'): RulesTurn {
  if (s.dungeon && !waitingFoes(s.dungeon)) {
    const rng = seededRng(s.party.rng);
    const came = wanderingRoll(rng, foesFor(s), 1, poolOf(s));
    const calm = { ...s, party: { ...s.party, rng: rng.state() }, dungeon: { ...s.dungeon, wander: 0 } };
    if (came) return meetWanderers(done(calm, [`Before the party can rest:`]), came);
    s = calm;
  }
  const r = partyRest(s.party, kind);
  return done({ ...s, party: r.party }, r.lines);
}

const traded = (s: RulesState, t: Pick<Traded, 'party' | 'lines'>) => done({ ...s, party: t.party }, t.lines);

const HOOKS: { [K in RulesHook['kind']]: (s: RulesState, hook: Extract<RulesHook, { kind: K }>, ballots: readonly Ballot[]) => RulesTurn } = {
  check: (s, hook, ballots) => roll(s, hook, ballots),
  save: (s, hook, ballots) => roll(s, hook, ballots),
  fight: (s, hook) => fight(s, capFight(hook.monsters, foesFor(s))),
  rest: (s, hook) => rest(s, hook.rest),
  move: (s, hook, ballots) => move(s, hook.exit, ballots),
  buy: (s, hook) => traded(s, buyItems(s.party, hook.items)),
  sell: (s, hook) => traded(s, sellItems(s.party, hook.items)),
  use: (s, hook) => traded(s, usePotion(s.party, hook.item)),
  trap: (s, hook, ballots) => trap(s, hook.trap, ballots),
  hazard: (s, { kind: _, hazard, ...amount }) => traded(s, harmed(s.party, partyHazard(s.party, { kind: hazard, ...amount } as HazardSpec))),
  parley: (s, hook, ballots) => talk(s, hook.monsters, ballots),
  revive: (s) => traded(s, raiseTheDead(s.party)),
};

/** A combat round if a fight is on; otherwise the chosen choice's hook (none: a story choice, nothing to roll). */
export function playTurn(s: RulesState, hook: RulesHook | null, ballots: readonly Ballot[]): RulesTurn {
  return withDeathTimes(clockOf(s.party), turnPlayed(s, hook, ballots));
}

function turnPlayed(s: RulesState, hook: RulesHook | null, ballots: readonly Ballot[]): RulesTurn {
  if (s.combat) return wander(elapse(combatRound(s, s.combat, ballots), ROUND_SECONDS), ROUND_SECONDS);
  const lit = lightUp(s.party, ambientLight(s)); // a light is lit before anything is tried in the dark
  const ready = { ...s, party: lit.party };
  const hooked = hook ? (HOOKS[hook.kind] as (s: RulesState, h: RulesHook, b: readonly Ballot[]) => RulesTurn)(ready, hook, ballots) : done(ready);
  const played = { ...hooked, lines: [...lit.lines, ...hooked.lines] };
  if (hook?.kind === 'rest') return elapse(played, played.fight === 'started' ? 0 : secondsFor(hook), true);
  return wander(elapse(played, secondsFor(hook)), secondsFor(hook));
}

/** Each hero who died this turn is marked with the clock at its start (for Raise Dead's 10 days). */
function withDeathTimes(started: number, t: RulesTurn): RulesTurn {
  const unmarked = (sh: CharacterSheet) => sh.dead === true && sh.diedAt === undefined;
  if (!Object.values(t.party.sheets).some(unmarked)) return t;
  const sheets = Object.fromEntries(Object.entries(t.party.sheets).map(([id, sh]) => [id, unmarked(sh) ? { ...sh, diedAt: started } : sh]));
  return { ...t, party: { ...t.party, sheets } };
}

const ROUND_SECONDS = 6;

/** The turn's time passes: the light burns (put out to rest, and the time it has left kept), and is lit where needed. */
function elapse(t: RulesTurn, seconds: number, resting = false): RulesTurn {
  const ambient = ambientLight(t);
  const shaken = t.combat || resting ? { party: t.party, lines: [] } : shakeOff(t.party);
  const timed = resting ? { party: { ...shaken.party, clock: clockOf(t.party) + seconds }, lines: [] } : passTime(shaken.party, seconds, ambient);
  const fed = provisions(timed.party, clockOf(t.party));
  const lit = lightUp(fed.party, ambient);
  return { ...t, party: lit.party, lines: [...t.lines, ...shaken.lines, ...timed.lines, ...fed.lines, ...lit.lines] };
}
