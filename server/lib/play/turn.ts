/**
 * One turn of play through the rules engine: the party's choice (and its hook), or a combat round. Pure:
 * the game (lib/game.ts) loads the state, calls playTurn, and stores what comes back.
 */
import { seededRng } from '../rules/rng.ts';
import type { ChoiceId } from '../types.ts';
import { groupRoll } from './checks.ts';
import { arrival, claimTreasure, clearRoom, enter } from './delve.ts';
import { fightRound, startFight, type FightEnd } from './fight.ts';
import type { RollHook, RulesHook } from './hooks.ts';
import { partyRest } from './rest.ts';
import type { CombatState, DungeonState, PartyState } from './state.ts';

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

function roll(s: RulesState, hook: RollHook, ballots: readonly Ballot[], before: string[] = []): RulesTurn {
  const rng = seededRng(s.party.rng);
  const heroes = Object.entries(s.party.sheets).map(([playerId, sheet]) => ({ playerId, sheet }));
  const votes = Object.fromEntries(ballots.map((b) => [b.playerId, b.roll]));
  const rolled = groupRoll(heroes, hook, votes, rng);
  const sheets = Object.fromEntries(rolled.sheets.map((h) => [h.playerId, h.sheet]));
  return done({ ...s, party: { ...s.party, rng: rng.state(), sheets } }, [...before, ...rolled.lines], rolled.success);
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

function move(s: RulesState, exit: string, ballots: readonly Ballot[]): RulesTurn {
  const moved = s.dungeon && enter(s.dungeon, exit);
  if (!moved) return done(s, ['That way is closed.']);
  const here = { ...s, dungeon: moved.dungeon };
  const lines = [`The party enters ${moved.node.name}: ${moved.node.purpose}.`];
  const found = arrival(moved.dungeon, moved.node);
  if (found.fight) return fight(here, found.fight, lines);
  const trapped = found.trap ? roll(here, found.trap, ballots, [...lines, 'A trap!']) : done(here, lines);
  const cleared = clearHere(trapped, trapped.lines);
  return { ...trapped, ...cleared.state, lines: cleared.lines };
}

const HOOKS: { [K in RulesHook['kind']]: (s: RulesState, hook: Extract<RulesHook, { kind: K }>, ballots: readonly Ballot[]) => RulesTurn } = {
  check: (s, hook, ballots) => roll(s, hook, ballots),
  save: (s, hook, ballots) => roll(s, hook, ballots),
  fight: (s, hook) => fight(s, hook.monsters),
  rest: (s, hook) => { const r = partyRest(s.party, hook.rest); return done({ ...s, party: r.party }, r.lines); },
  move: (s, hook, ballots) => move(s, hook.exit, ballots),
};

/** A combat round if a fight is on; otherwise the chosen choice's hook (none: a story choice, nothing to roll). */
export function playTurn(s: RulesState, hook: RulesHook | null, ballots: readonly Ballot[]): RulesTurn {
  if (s.combat) return combatRound(s, s.combat, ballots);
  if (!hook) return done(s);
  return (HOOKS[hook.kind] as (s: RulesState, h: RulesHook, b: readonly Ballot[]) => RulesTurn)(s, hook, ballots);
}
