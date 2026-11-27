/**
 * One turn of play through the rules engine: the party's choice (and its hook), or a combat round. Pure:
 * the game (lib/game.ts) loads the state, calls playTurn, and stores what comes back.
 */
import type { Move } from '../rules/bands.ts';
import type { CharacterSheet } from '../rules/sheet.ts';
import type { HazardSpec } from '../rules/hazards.ts';
import { capFight } from '../rules/encounter.ts';
import { sightOf } from '../rules/light.ts';
import { seededRng } from '../rules/rng.ts';
import type { ChoiceId, StoredChoice } from '../types.ts';
import { adjudicateCheck, type CheckRuling } from './actions.ts';
import { checksOf, dcOf, groupRoll, type TurnCheck } from './checks.ts';
import { arrival, claimTreasure, clearRoom, dungeonLevel, enter, foeLevels, foesMet, habitatOf, partyLevel, waitingFoes, withAttitude } from './delve.ts';
import { shakeOff } from './conditions.ts';
import { provisions } from './provisions.ts';
import { afterHarm } from './dying.ts';
import { fightRound, startFight, type FightEnd } from './fight.ts';
import { foesNamed, type RollHook, rollName, type RulesHook } from './hooks.ts';
import { parley, rollAttitude } from './parley.ts';
import { confrontGoal, goalFound, questAfter } from './quest.ts';
import { partyRest } from './rest.ts';
import { newlyDead, raiseTheDead, revivify } from './revive.ts';
import type { CombatState, DungeonState, PartyState } from './state.ts';
import { buyItems, sellItems, type Traded, usePotion } from './trade.ts';
import { checksDue, wanderingChecks, wanderingRoll, type Wanderers } from './wandering.ts';
import { ambientLight, clockOf, lightLevel, lightUp, passTime, secondsFor } from './time.ts';
import { partyHazard, springTrap } from './traps.ts';
import { meetOnTheRoad, type RoadEnd, type Trek } from './trek.ts';

export interface RulesState { party: PartyState; combat: CombatState | null; dungeon: DungeonState | null }
export interface Ballot { playerId: string; choiceId: ChoiceId; roll: number; move?: Move; actionId?: string; targets?: readonly string[] }
/** A written check, already accepted by the engine. It is this hero's action and not a vote for a choice. */
export interface FreeformBallot { playerId: string; roll: number; text: string; ruling: CheckRuling }
export type FightNews = 'started' | FightEnd | null;
/** A hero's d20 outside a fight this turn, and whether it came good (play/xp.ts). */
export interface HeroRoll { playerId: string; success: boolean }
export type { TurnCheck } from './checks.ts';
/**
 * checks: each d20 the engine rolled for a hero outside a fight this turn, in numbers and in the order
 * rolled: for the party's choice (its check, save, parley or trap) and for a hero's own written action.
 * Each has the line it produced, so play/result.ts can tell the dice lines from the rest.
 */
export interface RulesTurn extends RulesState { lines: string[]; success: boolean | null; fight: FightNews; rolled: HeroRoll[]; checks: TurnCheck[] }

/** The most-voted choice; a tie goes to the choice whose voters rolled highest, then to the first. */
export function pickChoice(leaders: readonly ChoiceId[], ballots: readonly Ballot[]): ChoiceId | null {
  const best = (id: ChoiceId) => Math.max(...ballots.filter((b) => b.choiceId === id).map((b) => b.roll));
  return leaders.reduce<ChoiceId | null>((top, id) => (top === null || best(id) > best(top) ? id : top), null);
}

const done = (s: RulesState, lines: string[] = [], success: boolean | null = null, fight: FightNews = null, rolled: HeroRoll[] = [], checks: TurnCheck[] = []): RulesTurn =>
  ({ ...s, lines, success, fight, rolled, checks });

/** Whoever the harm left at 0 HP is dying, and is settled; whoever it killed may be Revivified on the spot. */
function harmed(before: PartyState, t: { party: PartyState; lines: string[] }): { party: PartyState; lines: string[] } {
  const settled = afterHarm(t.party);
  const back = revivify(settled.party, newlyDead(before, settled.party));
  return { party: back.party, lines: [...t.lines, ...settled.lines, ...back.lines] };
}

const votesOf = (ballots: readonly Ballot[]) => Object.fromEntries(ballots.map((b) => [b.playerId, b.roll]));
/** The levels a band, a trap or a proposed fight is scaled to (play/delve.ts foeLevels). */
const foesFor = (s: RulesState) => foeLevels(s.party, s.dungeon);
const poolOf = (s: RulesState) => habitatOf(s.party, s.dungeon);

/** The choice's check or save. `backers` picked the choice: in "best" mode one of them rolls (play/checks.ts). */
function roll(s: RulesState, hook: RollHook, ballots: readonly Ballot[], backers: readonly string[], before: string[] = []): RulesTurn {
  const rng = seededRng(s.party.rng);
  const light = lightLevel(s);
  const heroes = Object.entries(s.party.sheets).filter(([, sheet]) => !sheet.dead).map(([playerId, sheet]) => ({ playerId, sheet, sight: sightOf(sheet, light) }));
  const rolled = groupRoll(heroes, hook, votesOf(ballots), rng, backers);
  const sheets = { ...s.party.sheets, ...Object.fromEntries(rolled.sheets.map((h) => [h.playerId, h.sheet])) };
  const settled = harmed(s.party, { party: { ...s.party, rng: rng.state(), sheets }, lines: rolled.lines });
  const rolls = rolled.rolls.filter((r) => r.natural !== null).map(({ playerId, success }) => ({ playerId, success }));
  return done({ ...s, party: settled.party }, [...before, ...settled.lines], rolled.success, null, rolls, checksOf(rolled, rollName(hook), dcOf(hook)));
}

function fight(s: RulesState, monsterIds: readonly string[], before: string[] = []): RulesTurn {
  const started = startFight(s.party, monsterIds, lightLevel(s), s.party.trek ? { band: 'far' } : undefined);
  return done({ ...s, party: started.party, combat: started.combat }, [...before, ...started.lines], null, 'started');
}

/** Nobody is left alive: a trap on the way killed the last of them, so nobody takes treasure or walks on. */
const wiped = (s: RulesState) => Object.values(s.party.sheets).every((h) => h.dead);

/** The room the party is in is dealt with: its treasure is taken and it is cleared. */
function clearHere(s: RulesState, lines: string[]): { state: RulesState; lines: string[] } {
  const dungeon = s.dungeon;
  if (!dungeon || dungeon.cleared.includes(dungeon.at)) return { state: s, lines };
  const treasure = dungeon.map.nodes[dungeon.at].contents?.treasure;
  const loot = treasure ? claimTreasure(s.party, treasure) : { party: s.party, lines: [] };
  return { state: { ...s, party: loot.party, dungeon: clearRoom(dungeon, dungeon.at) }, lines: [...lines, ...loot.lines] };
}

function combatRound(s: RulesState, combat: CombatState, ballots: readonly Ballot[], freeforms: readonly FreeformBallot[]): RulesTurn {
  const votes = {
    ...Object.fromEntries(ballots.map((b) => [b.playerId, {
      choiceId: b.choiceId, roll: b.roll,
      ...(b.actionId ? { actionId: b.actionId, targets: b.targets ?? [] } : {}),
      ...(b.move ? { move: b.move } : {}),
    }])),
    ...Object.fromEntries(freeforms.map((f) => [f.playerId, { choiceId: 'c' as const, roll: f.roll, text: f.text, freeform: f.ruling }])),
  };
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
  return done(sprung.success ? after : loud(after), [...before, ...settled.lines], sprung.success, null, [], sprung.checks);
}

/** Foes met in a room: Hostile ones bar the way; the others watch and wait (their attitude is kept for the room). */
function meet(s: RulesState, monsters: string[], before: string[]): RulesTurn {
  const dungeon = s.dungeon!;
  const known = dungeon.attitudes?.[dungeon.at];
  const rng = seededRng(s.party.rng);
  const met = known ? { attitude: known, roll: null } : rollAttitude(rng, monsters);
  const here = { ...s, party: { ...s.party, rng: rng.state() }, dungeon: withAttitude(dungeon, met.attitude) };
  const told = `${foesNamed(monsters)}: ${met.attitude}${met.roll === null ? '' : ` (2d6: ${met.roll})`}.`;
  const stance = met.attitude === 'hostile' ? 'They bar the way.' : 'They watch and wait.';
  return done(here, [...before, `${told} ${stance}`]);
}

type Facing = NonNullable<DungeonState['facing']>;

const metHere = (s: RulesState) => foesMet(s.party, s.dungeon);

/** Foes barring the way, set (or cleared, null) where the party is: on the road, or in the dungeon. */
function withFacing(s: RulesState, facing: Facing | null): RulesState {
  const road = s.party.trek;
  if (road) {
    const { facing: _, ...rest } = road;
    return { ...s, party: { ...s.party, trek: facing ? { ...rest, facing } : rest } };
  }
  if (!s.dungeon) return s;
  const { facing: _, ...rest } = s.dungeon;
  return { ...s, dungeon: facing ? { ...rest, facing } : rest };
}

/**
 * Hostile foes are waiting on the party's vote: Engage, Run or Parley. Null when nobody is barring the way
 * (a fight already on, or the foes are not Hostile). The next scene's choices (lib/game.ts).
 */
export function confrontationChoices(s: RulesState): StoredChoice[] | null {
  const waiting = s.combat ? null : metHere(s);
  if (!waiting || waiting.attitude !== 'hostile') return null;
  const run = waiting.source === 'wanderers'
    ? 'Slip past them. Nothing is fought and nothing is gained.'
    : 'Back out the way you came. The room stays as you found it, and nothing is gained.';
  return [
    { id: 'a', label: 'Engage', detail: 'Stand and fight them.', hook: { kind: 'engage', monsters: [...waiting.monsters] } },
    { id: 'b', label: 'Run', detail: run, hook: { kind: 'run' } },
    { id: 'c', label: 'Parley', detail: 'The best talker among those who pick this tries to sway them.', hook: { kind: 'parley' } },
  ];
}

/** Fight the foes already met, as they stand. */
function engage(s: RulesState, monsters: readonly string[]): RulesTurn {
  return fight(withFacing(s, null), monsters);
}

/** Leave before initiative. A room is left the way the party came; wanderers are slipped past. No loot, no XP. */
function run(s: RulesState): RulesTurn {
  const waiting = metHere(s);
  if (!waiting || waiting.attitude !== 'hostile') return done(s, ['There is no one to run from.']);
  if (waiting.source === 'wanderers') return done(withFacing(s, null), ['The party slips past. The wanderers do not pursue.']);
  return backOut(s, s.dungeon!); // foes in a room: only a dungeon has rooms
}

/** Out of the room the way the party came in, if there is one. */
function backOut(s: RulesState, dungeon: DungeonState): RulesTurn {
  const back = dungeon.cameFrom;
  const exit = dungeon.map.nodes[dungeon.at].exits.find((e) => e.to === back || e.id === back);
  const moved = back && exit ? enter(dungeon, exit.id) : null;
  if (!moved) return done(s, ['There is no way back.']);
  return done({ ...s, dungeon: moved.dungeon }, [`The party backs out into ${moved.node.name}.`]);
}

/**
 * The party parleys with the foes waiting here, or with those the DM names (Indifferent). `backers` picked
 * the parley: the best talker among them speaks for the party (play/parley.ts).
 */
function talk(s: RulesState, offered: readonly string[] | null | undefined, ballots: readonly Ballot[], backers: readonly string[]): RulesTurn {
  const waiting = metHere(s);
  const monsters = waiting ? waiting.monsters : offered;
  if (!monsters || monsters.length === 0) return done(s, ['There is no one here to talk to.']);
  const talked = parley(s.party, monsters, waiting ? waiting.attitude : 'indifferent', votesOf(ballots), backers);
  const after = { ...s, party: talked.party };
  const rolls = talked.rolls.map(({ playerId, success }) => ({ playerId, success }));
  const checks = checksOf(talked, talked.name, talked.dc);
  if (!waiting) {
    if (talked.attitude === 'hostile') return { ...fight(after, monsters, talked.lines), rolled: rolls, checks };
    return done(after, talked.lines, talked.success, null, rolls, checks);
  }
  if (waiting.source === 'wanderers') {
    return done(withFacing(after, talked.success ? null : { monsters: [...waiting.monsters], attitude: talked.attitude }), talked.lines, talked.success, null, rolls, checks);
  }
  const dungeon = talked.success ? clearRoom(s.dungeon!, s.dungeon!.at) : withAttitude(s.dungeon!, talked.attitude);
  return done({ ...after, dungeon }, talked.lines, talked.success, null, rolls, checks);
}

function move(s: RulesState, exit: string, ballots: readonly Ballot[]): RulesTurn {
  if (s.party.trek) return done(s, [s.party.trek.leadsTo === 'door' ? 'The road leads on; the dungeon door is still ahead.' : 'The road leads on.']);
  const moved = s.dungeon && enter(s.dungeon, exit);
  if (!moved) return done(s, ['That way is closed.']);
  if (moved.node.type === 'corridor') return through(s, moved, exit, ballots);
  return arrive(s, moved, ballots, []);
}

type Moved = NonNullable<ReturnType<typeof enter>>;

/** Into an area: light where needed, then what is there springs (foes met, a trap), then its treasure is taken. */
function arrive(s: RulesState, entering: Moved, ballots: readonly Ballot[], before: string[]): RulesTurn {
  const { moved, party } = goalHere(s.party, entering);
  const entered = { ...s, party, dungeon: moved.dungeon };
  const lit = lightUp(party, ambientLight(entered));
  const here = { ...entered, party: lit.party };
  const lines = [...before, `The party enters ${moved.node.name}${moved.node.purpose ? `: ${moved.node.purpose}` : ''}.`, ...deeperLine(s.dungeon!, moved.dungeon), ...lit.lines];
  const found = arrival(moved.dungeon, moved.node);
  if (found.fight) return meet(here, found.fight, lines);
  const trapped = found.trap ? trap(here, found.trap, ballots, lines) : done(here, lines);
  if (wiped(trapped)) return trapped;
  const cleared = clearHere(trapped, trapped.lines);
  return { ...trapped, ...cleared.state, lines: cleared.lines };
}

/** Explore mode: the room entered may be where the quest's goal is found (play/quest.ts). */
function goalHere(party: PartyState, moved: Moved): { moved: Moved; party: PartyState } {
  if (!party.quest) return { moved, party };
  const found = goalFound(party.quest, moved.dungeon, moved.node);
  return { moved: { dungeon: found.dungeon, node: found.node }, party: { ...party, quest: found.quest } };
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
  if (wiped(trapped)) return trapped;
  const timed = passTime(trapped.party, CORRIDOR_SECONDS, ambientLight(trapped));
  const after: RulesState = { ...trapped, party: timed.party, dungeon: clearRoom(trapped.dungeon!, moved.node.id) };
  const spoor = onTheWay(after, moved.node.contents?.special === 'spoor');
  const sofar = [...trapped.lines, ...timed.lines];
  if (spoor.came) return { ...meetWanderers(done(spoor.state, sofar), spoor.came), success: trapped.success, checks: trapped.checks };
  const arrived = arrive(spoor.state, enter(spoor.state.dungeon!, exit)!, ballots, sofar);
  return { ...arrived, success: trapped.success, checks: [...trapped.checks, ...arrived.checks] };
}

/** A check in the corridor itself, 2 in 6 where there is spoor (wandering.ts). */
function onTheWay(s: RulesState, spoor: boolean): { state: RulesState; came: Wanderers | null } {
  if (!spoor) return { state: s, came: null };
  const rng = seededRng(s.party.rng);
  const came = wanderingRoll(rng, foesFor(s), 2, poolOf(s));
  return { state: { ...s, party: { ...s.party, rng: rng.state() } }, came };
}

/** Wanderers arrive: Hostile ones bar the way; the others go their way. */
function meetWanderers(t: RulesTurn, came: Wanderers): RulesTurn {
  const rng = seededRng(t.party.rng);
  const met = rollAttitude(rng, came.monsters);
  const here = { ...t, party: { ...t.party, rng: rng.state() } };
  const told = `${came.line} They are ${met.attitude}${met.roll === null ? '' : ` (2d6: ${met.roll})`}.`;
  if (met.attitude !== 'hostile') return { ...here, lines: [...t.lines, `${told} They go their way.`] };
  const dungeon = { ...here.dungeon!, facing: { monsters: [...came.monsters], attitude: 'hostile' as const } };
  return { ...here, dungeon, lines: [...t.lines, `${told} They bar the way.`], success: t.success };
}

/** After the turn's time, the checks due (noise first, 2 in 6); a fight on, or foes waiting here, keeps others off. */
function wander(t: RulesTurn, seconds: number): RulesTurn {
  const d = t.dungeon;
  if (!d || t.party.trek || t.combat || waitingFoes(d)) return t; // the road has its own encounters (play/trek.ts)
  const { noise, ...quiet } = d;
  const due = checksDue(d.wander ?? 0, seconds);
  const rng = seededRng(t.party.rng);
  const came = wanderingChecks(rng, foesFor(t), due.checks, noise === true, poolOf(t));
  const calm = { ...t, party: { ...t.party, rng: rng.state() }, dungeon: { ...quiet, wander: due.since } };
  return came ? meetWanderers(calm, came) : calm;
}

/** A rest in a dungeon: one check first (wandering.ts); wanderers who come interrupt it. */
function rest(s: RulesState, kind: 'short' | 'long'): RulesTurn {
  if (s.dungeon && !s.party.trek && !waitingFoes(s.dungeon)) {
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

/** What each hook does. `backers` are the players who picked the choice the hook belongs to. */
const HOOKS: { [K in RulesHook['kind']]: (s: RulesState, hook: Extract<RulesHook, { kind: K }>, ballots: readonly Ballot[], backers: readonly string[]) => RulesTurn } = {
  check: (s, hook, ballots, backers) => roll(s, hook, ballots, backers),
  save: (s, hook, ballots, backers) => roll(s, hook, ballots, backers),
  fight: (s, hook) => fight(s, capFight(hook.monsters, foesFor(s))),
  engage: (s, hook) => engage(s, hook.monsters),
  run: (s) => run(s),
  rest: (s, hook) => rest(s, hook.rest),
  move: (s, hook, ballots) => move(s, hook.exit, ballots),
  buy: (s, hook) => traded(s, buyItems(s.party, hook.items)),
  sell: (s, hook) => traded(s, sellItems(s.party, hook.items)),
  use: (s, hook) => traded(s, usePotion(s.party, hook.item)),
  trap: (s, hook, ballots) => trap(s, hook.trap, ballots),
  hazard: (s, { kind: _, hazard, ...amount }) => traded(s, harmed(s.party, partyHazard(s.party, { kind: hazard, ...amount } as HazardSpec))),
  parley: (s, hook, ballots, backers) => talk(s, hook.monsters, ballots, backers),
  revive: (s) => traded(s, raiseTheDead(s.party)),
  goal: (s) => confrontGoal(s),
};

/** A written check outside a fight: the dice are rolled and logged. There is no creature here to mark. */
function improvise(s: RulesState, freeforms: readonly FreeformBallot[]): { state: RulesState; lines: string[]; rolled: HeroRoll[]; checks: TurnCheck[] } {
  if (!freeforms.length) return { state: s, lines: [], rolled: [], checks: [] };
  const rng = seededRng(s.party.rng);
  const rolled: HeroRoll[] = [];
  const checks: TurnCheck[] = [];
  const lines = freeforms.map((f) => {
    const sheet = s.party.sheets[f.playerId];
    if (!sheet || sheet.dead || sheet.hp <= 0) return `${sheet?.name ?? 'A hero'} is down and does not act.`;
    const { text: line, foe: _, ...roll } = adjudicateCheck(rng, sheet, f.text, f.ruling, f.roll, null);
    rolled.push({ playerId: f.playerId, success: roll.success });
    checks.push({ for: 'own', playerId: f.playerId, ...roll, fresh: false, helpers: [], text: f.text, line });
    return line;
  });
  return { state: { ...s, party: { ...s.party, rng: rng.state() } }, lines, rolled, checks };
}

const STRETCH_SECONDS = 2 * 3600;

/**
 * After a turn on the road (play/trek.ts): foes still barring the way attack; otherwise, with no fight on,
 * the party goes on by itself, to the next stretch or to the dungeon door.
 */
function alongTheRoad(t: RulesTurn): RulesTurn {
  const trek = t.party.trek;
  if (!trek || t.combat || t.fight === 'defeat') return t;
  if (trek.facing?.attitude !== 'hostile') return goOn(t, trek);
  const attacked = fight({ ...t, ...withFacing(t, null) }, trek.facing.monsters, [...t.lines, 'They will not let the party pass: they attack.']);
  return { ...attacked, success: t.success, checks: t.checks };
}

const ARRIVED: Readonly<Record<RoadEnd, string>> = { door: 'The party reaches the dungeon door.', tale: 'The road ends where the tale begins.' };

/** Two hours on: the victors of a fight take the stretch's treasure; then the next stretch is met, or the road ends. */
function goOn(t: RulesTurn, trek: Trek): RulesTurn {
  const spoils = t.fight === 'victory' || t.fight === 'fled' ? trek.legs[trek.leg].treasure : null;
  const loot = spoils ? claimTreasure(t.party, spoils) : { party: t.party, lines: [] };
  const walked = passTime(loot.party, STRETCH_SECONDS, ambientLight(t));
  const lines = [...t.lines, ...loot.lines, ...walked.lines];
  const { facing: _, ...road } = trek;
  const { trek: __, ...arrived } = walked.party;
  if (trek.leg + 1 >= trek.legs.length) return { ...t, party: arrived, lines: [...lines, ARRIVED[trek.leadsTo]] };
  const met = meetOnTheRoad({ ...arrived, trek: { ...road, leg: trek.leg + 1 } });
  return { ...t, party: met.party, lines: [...lines, ...met.lines] };
}

/**
 * A combat round if a fight is on; otherwise the chosen choice's hook (none: a story choice, nothing to roll).
 * `backers` are the players who picked that choice: where one hero rolls for the party, it is one of them.
 */
export function playTurn(s: RulesState, hook: RulesHook | null, ballots: readonly Ballot[], freeforms: readonly FreeformBallot[] = [], backers: readonly string[] = []): RulesTurn {
  return withDeathTimes(clockOf(s.party), questAfter(alongTheRoad(turnPlayed(s, hook, ballots, freeforms, backers))));
}

function turnPlayed(s: RulesState, hook: RulesHook | null, ballots: readonly Ballot[], freeforms: readonly FreeformBallot[], backers: readonly string[]): RulesTurn {
  if (s.combat) return wander(elapse(combatRound(s, s.combat, ballots, freeforms), ROUND_SECONDS), ROUND_SECONDS);
  const lit = lightUp(s.party, ambientLight(s)); // a light is lit before anything is tried in the dark
  const ready = improvise({ ...s, party: lit.party }, freeforms);
  const hooked = hook ? (HOOKS[hook.kind] as (s: RulesState, h: RulesHook, b: readonly Ballot[], backers: readonly string[]) => RulesTurn)(ready.state, hook, ballots, backers) : done(ready.state);
  const played = { ...hooked, lines: [...lit.lines, ...ready.lines, ...hooked.lines], rolled: [...ready.rolled, ...hooked.rolled], checks: [...ready.checks, ...hooked.checks] };
  if (hook?.kind === 'rest') return elapse(played, played.fight === 'started' || played.dungeon?.facing ? 0 : secondsFor(hook), true);
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
