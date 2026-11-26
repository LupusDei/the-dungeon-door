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
import { dungeonLevel, startDungeon } from './delve.ts';
import { autoLevelUp } from './fight.ts';
import { hookLabel, parseHook } from './hooks.ts';
import type { DungeonState, LevelUp, PartyState } from './state.ts';
import { meetOnTheRoad, planTrek } from './trek.ts';
import { pickChoice, playTurn, type FightNews, type FreeformBallot, type RulesState } from './turn.ts';

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
  const party: PartyState = { version: 1, rng: seed, sheets };
  if (mode === 'none') return { party, combat: null, dungeon: null };
  const dungeon = startDungeon(mode, seed, levels, sceneCount);
  const met = meetOnTheRoad(party, { ...dungeon, trek: planTrek(seed, levels, dungeonLevel(dungeon)) }); // first, the road from the tavern
  return { party: met.party, combat: null, dungeon: met.dungeon };
}

const openPacks = (party: PartyState): PartyState =>
  (Object.values(party.sheets).some((s) => unpacked(s) !== s) ? { ...party, sheets: Object.fromEntries(Object.entries(party.sheets).map(([id, s]) => [id, unpacked(s)])) } : party);

/**
 * The game's rules state, mended as it is read (and stored back on the next write): the heroes' packs are opened
 * (their torches and rations to hand), and a map from before Phase 3 gets its traps' 5.2 ids.
 */
export const rulesStateOf = ({ party, combat, dungeon }: Game): RulesState | null =>
  party && { party: openPacks(party), combat, dungeon: dungeon && { ...dungeon, map: currentTraps(dungeon.map) } };

/** A choice with its hook, if it holds up, and the hook's label from where the party is now. */
export function storedChoice(choice: Choice, hook: unknown, dungeon: DungeonState | null = null): StoredChoice {
  const parsed = parseHook(hook);
  return { ...choice, hook: parsed, rules: parsed && hookLabel(parsed, dungeon) };
}

/**
 * The choice as the app shows it. A way on keeps the name stored when it was offered. A fight or an
 * engage is rated against the party now (`levels`). Anything else uses the stored label, or the hook.
 */
export function choiceView({ hook, rules, ...choice }: StoredChoice, levels?: readonly number[]): ChoiceView {
  const rated = hook && (hook.kind === 'fight' || hook.kind === 'engage') ? hookLabel(hook, levels) : null;
  return { ...choice, rules: rated ?? rules ?? (hook ? hookLabel(hook) : null) };
}

export interface EngineStep {
  state: RulesState;
  resolution: Resolution;
  fight: FightNews;
  /** The resolved scene was a combat round. */
  round: boolean;
}

/** Written checks stored on the scene's votes. A corrupt one is dropped rather than thrown. */
function freeformsOf(scene: StoredScene): FreeformBallot[] {
  return scene.votes.flatMap((v) => (v.freeform?.ruling.kind === 'check' ? [{ playerId: v.playerId, roll: v.roll, text: v.freeform.text, ruling: v.freeform.ruling }] : []));
}

/** Resolves a scene through the engine: a combat round, or the chosen choice's hook (ties to the higher roll). */
export function engineStep(state: RulesState, scene: StoredScene, resolution: Resolution): EngineStep {
  const ballots = resolution.votes.map(({ playerId, choiceId, roll }) => {
    const stored = scene.votes.find((v) => v.playerId === playerId);
    return { playerId, choiceId, roll, ...(stored?.actionId ? { actionId: stored.actionId, targets: stored.targets ?? [] } : {}) };
  });
  const chosen = pickChoice(resolution.leaders, ballots);
  const inFight = state.combat !== null;
  const choice = inFight ? undefined : scene.choices.find((c) => c.id === chosen);
  const turn = playTurn(state, choice?.hook || null, ballots, freeformsOf(scene));
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
 * The quest is over: each living hero levels up as far as its XP reaches (2024 thresholds, play/fight.ts
 * autoLevelUp). The lines join the scene's, for the table and for the DM's epilogue.
 */
export function endQuest(step: EngineStep): EngineStep {
  const { party } = step.state;
  const levelUps: LevelUp[] = [];
  const lines = [...(party.results ?? [])];
  const sheets = { ...party.sheets };
  for (const [playerId, sheet] of Object.entries(party.sheets).filter(([, s]) => !s.dead)) {
    const up = autoLevelUp(sheet);
    if (up.sheet.level > sheet.level) levelUps.push({ playerId, from: sheet.level, to: up.sheet.level });
    sheets[playerId] = up.sheet;
    lines.push(...up.lines);
  }
  const rules = step.resolution.rules && { ...step.resolution.rules, lines };
  return { ...step, state: { ...step.state, party: { ...party, sheets, results: lines, levelUps } }, resolution: { ...step.resolution, rules } };
}

/**
 * Combat rounds don't use up the story's scenes: a scene is added for each round, as the round's scene is
 * made (the next scene is a round while a fight is on), and none when a fight ends, so a game of N scenes
 * has N - 1 story scenes and then the epilogue, however many rounds are fought and wherever. A fight still
 * on is never followed by the epilogue (nor in a game counted before this rule). A lost fight makes the next
 * scene the epilogue.
 */
export function sceneCountAfter(step: Pick<EngineStep, 'state' | 'fight'>, next: number, sceneCount: number): number {
  if (step.fight === 'defeat') return next + 1;
  return step.state.combat ? Math.max(sceneCount + 1, next + 2) : sceneCount;
}

/** A hero goes home rested; the dead go home dead. */
const homeward = (s: CharacterSheet): CharacterSheet => (s.dead ? s : longRest({ ...s, hp: Math.max(1, s.hp) }));

/** The heroes' sheets to save back to their characters (players still at the table). */
export function writeBack(party: PartyState, players: readonly GamePlayer[]): { characterId: string; sheet: CharacterSheet }[] {
  return players
    .filter((p) => Object.hasOwn(party.sheets, p.playerId))
    .map((p) => ({ characterId: p.character.id, sheet: homeward(party.sheets[p.playerId]) }));
}
