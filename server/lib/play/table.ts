/**
 * The rules engine at the table: what lib/game.ts needs to start a rules game, resolve a scene through
 * the engine, show it, and send the heroes home. A game whose party is null is from before the engine and
 * plays as it always did.
 */
import { upgradeCharacter } from '../characters.ts';
import type { Resolution } from '../dm/types.ts';
import { badRequest } from '../http.ts';
import { unpacked } from '../rules/inventory.ts';
import { longRest } from '../rules/rests.ts';
import type { CharacterSheet } from '../rules/sheet.ts';
import { currentTraps } from '../rules/traps.ts';
import type { Choice, ChoiceView, Game, GamePlayer, StoredChoice, StoredScene } from '../types.ts';
import { startDungeon } from './delve.ts';
import { hookLabel, parseHook } from './hooks.ts';
import type { PartyState } from './state.ts';
import { pickChoice, playTurn, type FightNews, type RulesState } from './turn.ts';

export const DUNGEON_MODES = ['none', 'fixed', 'explore'] as const;
export type DungeonMode = (typeof DUNGEON_MODES)[number];

export function dungeonMode(value: unknown): DungeonMode {
  if (value === undefined || value === null) return 'none';
  if (!DUNGEON_MODES.includes(value as DungeonMode)) throw badRequest('dungeon must be "none", "fixed" or "explore"');
  return value as DungeonMode;
}

const sheetOf = ({ character }: GamePlayer): CharacterSheet => upgradeCharacter(character).sheet;

export function newRules(players: readonly GamePlayer[], mode: DungeonMode, seed: number, sceneCount: number): RulesState {
  const sheets = Object.fromEntries(players.map((p) => [p.playerId, unpacked(sheetOf(p))]));
  const levels = Object.values(sheets).filter((s) => !s.dead).map((s) => s.level); // the dungeon starts at the living heroes' level
  return {
    party: { version: 1, rng: seed, sheets },
    combat: null,
    dungeon: mode === 'none' ? null : startDungeon(mode, seed, levels, sceneCount),
  };
}

const openPacks = (party: PartyState): PartyState =>
  (Object.values(party.sheets).some((s) => unpacked(s) !== s) ? { ...party, sheets: Object.fromEntries(Object.entries(party.sheets).map(([id, s]) => [id, unpacked(s)])) } : party);

/**
 * The game's rules state, mended as it is read (and stored back on the next write): the heroes' packs are opened
 * (their torches and rations to hand), and a map from before Phase 3 gets its traps' 5.2 ids.
 */
export const rulesStateOf = ({ party, combat, dungeon }: Game): RulesState | null =>
  party && { party: openPacks(party), combat, dungeon: dungeon && { ...dungeon, map: currentTraps(dungeon.map) } };

export const storedChoice = (choice: Choice, hook: unknown): StoredChoice => ({ ...choice, hook: parseHook(hook) });

export const choiceView = ({ hook, ...choice }: StoredChoice): ChoiceView => ({ ...choice, rules: hook ? hookLabel(hook) : null });

export interface EngineStep {
  state: RulesState;
  resolution: Resolution;
  fight: FightNews;
  /** The resolved scene was a combat round. */
  round: boolean;
}

/** Resolves a scene through the engine: a combat round, or the chosen choice's hook (ties to the higher roll). */
export function engineStep(state: RulesState, scene: StoredScene, resolution: Resolution): EngineStep {
  const ballots = resolution.votes.map(({ playerId, choiceId, roll }) => ({ playerId, choiceId, roll }));
  const chosen = pickChoice(resolution.leaders, ballots);
  const inFight = state.combat !== null;
  const choice = inFight ? undefined : scene.choices.find((c) => c.id === chosen);
  const turn = playTurn(state, choice?.hook || null, ballots);
  return {
    state: { party: { ...turn.party, results: turn.lines }, combat: turn.combat, dungeon: turn.dungeon },
    resolution: {
      ...resolution,
      leaders: chosen ? [chosen] : [],
      rules: { chosen: inFight ? null : chosen, lines: turn.lines, success: turn.success, fight: turn.fight },
    },
    fight: turn.fight,
    round: inFight,
  };
}

/**
 * Combat rounds don't use up the story's scenes: each one adds a scene, and a fight still on is never
 * followed by the epilogue. A lost fight makes the next scene the epilogue.
 */
export function sceneCountAfter(step: Pick<EngineStep, 'state' | 'fight' | 'round'>, next: number, sceneCount: number): number {
  if (step.fight === 'defeat') return next + 1;
  const count = step.round ? sceneCount + 1 : sceneCount;
  return step.state.combat ? Math.max(count, next + 2) : count;
}

/** A hero goes home rested; the dead go home dead. */
const homeward = (s: CharacterSheet): CharacterSheet => (s.dead ? s : longRest({ ...s, hp: Math.max(1, s.hp) }));

/** The heroes' sheets to save back to their characters (players still at the table). */
export function writeBack(party: PartyState, players: readonly GamePlayer[]): { characterId: string; sheet: CharacterSheet }[] {
  return players
    .filter((p) => Object.hasOwn(party.sheets, p.playerId))
    .map((p) => ({ characterId: p.character.id, sheet: homeward(party.sheets[p.playerId]) }));
}
