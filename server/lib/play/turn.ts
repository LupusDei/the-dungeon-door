/**
 * One turn of play through the rules engine: the party's choice (and its hook), or a combat round. Pure:
 * the game (lib/game.ts) loads the state, calls playTurn, and stores what comes back.
 */
import type { HazardSpec } from '../rules/hazards.ts';
import { seededRng } from '../rules/rng.ts';
import type { ChoiceId } from '../types.ts';
import { groupRoll } from './checks.ts';
import { arrival, claimTreasure, clearRoom, enter, partyLevel, waitingFoes, withAttitude } from './delve.ts';
import { afterHarm } from './dying.ts';
import { fightRound, startFight, type FightEnd } from './fight.ts';
import { foesNamed, type RollHook, type RulesHook } from './hooks.ts';
import { parley, rollAttitude } from './parley.ts';
import { partyRest } from './rest.ts';
import type { CombatState, DungeonState, PartyState } from './state.ts';
import { buyItems, sellItems, type Traded, usePotion } from './trade.ts';
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

const votesOf = (ballots: readonly Ballot[]) => Object.fromEntries(ballots.map((b) => [b.playerId, b.roll]));
const levelsOf = (s: RulesState) => Object.values(s.party.sheets).map((h) => h.level);

function roll(s: RulesState, hook: RollHook, ballots: readonly Ballot[], before: string[] = []): RulesTurn {
  const rng = seededRng(s.party.rng);
  const heroes = Object.entries(s.party.sheets).filter(([, sheet]) => !sheet.dead).map(([playerId, sheet]) => ({ playerId, sheet }));
  const rolled = groupRoll(heroes, hook, votesOf(ballots), rng);
  const sheets = { ...s.party.sheets, ...Object.fromEntries(rolled.sheets.map((h) => [h.playerId, h.sheet])) };
  const settled = afterHarm({ ...s.party, rng: rng.state(), sheets });
  return done({ ...s, party: settled.party }, [...before, ...rolled.lines, ...settled.lines], rolled.success);
}

function fight(s: RulesState, monsterIds: readonly string[], before: string[] = []): RulesTurn {
  const started = startFight(s.party, monsterIds);
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
  return done(cleared.state, cleared.lines, null, round.ended);
}

function trap(s: RulesState, id: string, ballots: readonly Ballot[], before: string[] = []): RulesTurn {
  const sprung = springTrap(s.party, id, partyLevel(levelsOf(s)), votesOf(ballots));
  const settled = afterHarm(sprung.party);
  return done({ ...s, party: settled.party }, [...before, ...sprung.lines, ...settled.lines], sprung.success);
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
  const here = { ...s, dungeon: moved.dungeon };
  const lines = [`The party enters ${moved.node.name}: ${moved.node.purpose}.`];
  const found = arrival(moved.dungeon, moved.node);
  if (found.fight) return meet(here, found.fight, lines);
  const trapped = found.trap ? trap(here, found.trap, ballots, lines) : done(here, lines);
  const cleared = clearHere(trapped, trapped.lines);
  return { ...trapped, ...cleared.state, lines: cleared.lines };
}

/** Whoever the harm left at 0 HP is dying, and is settled. */
function harmed(t: { party: PartyState; lines: string[] }): { party: PartyState; lines: string[] } {
  const settled = afterHarm(t.party);
  return { party: settled.party, lines: [...t.lines, ...settled.lines] };
}

const traded = (s: RulesState, t: Pick<Traded, 'party' | 'lines'>) => done({ ...s, party: t.party }, t.lines);

const HOOKS: { [K in RulesHook['kind']]: (s: RulesState, hook: Extract<RulesHook, { kind: K }>, ballots: readonly Ballot[]) => RulesTurn } = {
  check: (s, hook, ballots) => roll(s, hook, ballots),
  save: (s, hook, ballots) => roll(s, hook, ballots),
  fight: (s, hook) => fight(s, hook.monsters),
  rest: (s, hook) => { const r = partyRest(s.party, hook.rest); return done({ ...s, party: r.party }, r.lines); },
  move: (s, hook, ballots) => move(s, hook.exit, ballots),
  buy: (s, hook) => traded(s, buyItems(s.party, hook.items)),
  sell: (s, hook) => traded(s, sellItems(s.party, hook.items)),
  use: (s, hook) => traded(s, usePotion(s.party, hook.item)),
  trap: (s, hook, ballots) => trap(s, hook.trap, ballots),
  hazard: (s, { kind: _, hazard, ...amount }) => traded(s, harmed(partyHazard(s.party, { kind: hazard, ...amount } as HazardSpec))),
  parley: (s, hook, ballots) => talk(s, hook.monsters, ballots),
};

/** A combat round if a fight is on; otherwise the chosen choice's hook (none: a story choice, nothing to roll). */
export function playTurn(s: RulesState, hook: RulesHook | null, ballots: readonly Ballot[]): RulesTurn {
  if (s.combat) return combatRound(s, s.combat, ballots);
  if (!hook) return done(s);
  return (HOOKS[hook.kind] as (s: RulesState, h: RulesHook, b: readonly Ballot[]) => RulesTurn)(s, hook, ballots);
}
