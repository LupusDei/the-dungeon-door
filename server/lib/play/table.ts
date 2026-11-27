/**
 * The rules engine at the table: what lib/game.ts needs to start a rules game, resolve a scene through
 * the engine, show it, and send the heroes home. A game whose party is null is from before the engine and
 * plays as it always did.
 */
import { upgradeCharacter } from '../characters.ts';
import type { Resolution } from '../dm/types.ts';
import { badRequest } from '../http.ts';
import { paceOf, unpacked } from '../rules/inventory.ts';
import { ensureGrid } from '../rules/scene.ts';
import { longRest } from '../rules/rests.ts';
import type { CharacterSheet } from '../rules/sheet.ts';
import { currentTraps } from '../rules/traps.ts';
import type { Choice, ChoiceView, Game, GamePlayer, StoredChoice, StoredScene } from '../types.ts';
import { isPersonalCheck } from './actions.ts';
import { dungeonLevel, partyLevel, startDungeon } from './delve.ts';
import { autoLevelUp } from './fight.ts';
import { hookLabel, parseHook, type RulesHook } from './hooks.ts';
import type { DungeonState, LevelUp, PartyState } from './state.ts';
import { meetOnTheRoad, planTrek, type Trek } from './trek.ts';
import { overtime, planQuest, questClosed } from './quest.ts';
import { pickChoice, playTurn, type FightNews, type FreeformBallot, type RulesState, type RulesTurn } from './turn.ts';
import { type Deeds, questXp, sceneXp, type XpEvent, xpTag } from './xp.ts';

export const DUNGEON_MODES = ['none', 'fixed', 'explore'] as const;
export type DungeonMode = (typeof DUNGEON_MODES)[number];

export function dungeonMode(value: unknown): DungeonMode {
  if (value === undefined || value === null) return 'none';
  if (!DUNGEON_MODES.includes(value as DungeonMode)) throw badRequest('dungeon must be "none", "fixed" or "explore"');
  return value as DungeonMode;
}

const sheetOf = ({ character }: GamePlayer): CharacterSheet => upgradeCharacter(character).sheet;

/**
 * A new game's rules for `sceneCount` tale scenes: the heroes, the dungeon if asked for, the road from the
 * tavern, and the quest (play/quest.ts), unless the adventure has no set length (`quest` false).
 */
export function newRules(players: readonly GamePlayer[], mode: DungeonMode, seed: number, sceneCount: number, quest = true): RulesState {
  const sheets = Object.fromEntries(players.map((p) => [p.playerId, unpacked(sheetOf(p))]));
  const levels = Object.values(sheets).filter((s) => !s.dead).map((s) => s.level); // the dungeon starts at the living heroes' level
  const started = mode === 'none' ? null : startDungeon(mode, seed, levels, sceneCount);
  const planned = quest && levels.length > 0 ? planQuest(seed, levels, sceneCount, started) : null;
  const dungeon = planned ? planned.dungeon : started;
  const trek = dungeon ? planTrek(seed, levels, dungeonLevel(dungeon), 'door') : planTrek(seed, levels, partyLevel(levels), 'tale');
  const met = meetOnTheRoad({ version: 1, rng: seed, sheets, trek, ...(planned ? { quest: planned.quest } : {}) }); // first, the road from the tavern
  return { party: met.party, combat: null, dungeon };
}

const openPacks = (party: PartyState): PartyState =>
  (Object.values(party.sheets).some((s) => unpacked(s) !== s) ? { ...party, sheets: Object.fromEntries(Object.entries(party.sheets).map(([id, s]) => [id, unpacked(s)])) } : party);

/** A dungeon as stored before the road moved to the party: the road, and foes met on it, kept in the dungeon. */
type StoredDungeon = DungeonState & { trek?: Omit<Trek, 'leadsTo' | 'facing'> };

/** The road taken out of a dungeon stored with it, and given to the party, with any foes met on it. */
function roadToParty(party: PartyState, stored: StoredDungeon): { party: PartyState; dungeon: DungeonState } {
  const { trek, facing, ...dungeon } = stored;
  if (!trek) return { party, dungeon: stored };
  return { party: { ...party, trek: { ...trek, leadsTo: 'door', ...(facing ? { facing } : {}) } }, dungeon };
}

/**
 * The game's rules state, mended as it is read (and stored back on the next write): the heroes' packs are opened
 * (their torches and rations to hand), a map from before Phase 3 gets its traps' 5.2 ids, and a road stored in
 * the dungeon goes to the party.
 */
const gridded = (party: PartyState, combat: RulesState['combat']) =>
  combat && ensureGrid(combat, Object.fromEntries(Object.entries(party.sheets).map(([id, s]) => [id, paceOf(s)])));

export function rulesStateOf({ party, combat, dungeon }: Game): RulesState | null {
  if (!party) return null;
  if (!dungeon) return { party: openPacks(party), combat: gridded(openPacks(party), combat), dungeon };
  const moved = roadToParty(openPacks(party), dungeon);
  return { party: moved.party, combat: gridded(moved.party, combat), dungeon: { ...moved.dungeon, map: currentTraps(moved.dungeon.map) } };
}

/** A choice with its hook, if it holds up, the hook's label from where the party is now, and the DM's XP tag if it is one. */
export function storedChoice(choice: Choice, hook: unknown, dungeon: DungeonState | null = null, reward: unknown = null): StoredChoice {
  const parsed = parseHook(hook);
  const tag = xpTag(reward);
  return { ...choice, hook: parsed, rules: parsed && hookLabel(parsed, dungeon), ...(tag ? { reward: tag } : {}) };
}

/**
 * The choice as the app shows it. A way on keeps the name stored when it was offered. A fight or an
 * engage is rated against the party now (`levels`). Anything else uses the stored label, or the hook.
 */
export function choiceView({ hook, rules, reward: _, ...choice }: StoredChoice, levels?: readonly number[]): ChoiceView {
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
  return scene.votes.flatMap((v) => {
    const ruling = v.freeform?.ruling;
    if (!ruling || ruling.kind !== 'check' || !isPersonalCheck(v)) return [];
    return [{ playerId: v.playerId, roll: v.roll, text: v.freeform!.text, ruling }];
  });
}

/** Resolves a scene through the engine: a combat round, or the chosen choice's hook (ties to the higher roll). */
export function engineStep(state: RulesState, scene: StoredScene, resolution: Resolution): EngineStep {
  const ballots = resolution.votes.map(({ playerId, choiceId, roll }) => {
    const stored = scene.votes.find((v) => v.playerId === playerId);
    return {
      playerId, choiceId, roll,
      ...(stored?.move ? { move: stored.move } : {}),
      ...(stored?.actionId ? { actionId: stored.actionId, targets: stored.targets ?? [] } : {}),
    };
  });
  const chosen = pickChoice(resolution.leaders, ballots);
  const inFight = state.combat !== null;
  const choice = inFight ? undefined : scene.choices.find((c) => c.id === chosen);
  const turn = playTurn(state, choice?.hook || null, ballots, freeformsOf(scene));
  const xp = sceneXp(turn.party, deedsOf(state, turn, scene, inFight ? null : choice ?? null, inFight));
  const lines = [...turn.lines, ...xp.lines];
  return {
    state: { party: { ...xp.party, results: lines }, combat: turn.combat, dungeon: turn.dungeon },
    resolution: {
      ...resolution,
      leaders: chosen ? [chosen] : [],
      rules: { chosen: inFight ? null : chosen, lines, success: turn.success, fight: turn.fight },
    },
    fight: turn.fight,
    round: inFight,
  };
}

/** Hooks whose XP is the fight's own: a DM's tag on them pays nothing. */
const FIGHTING: readonly RulesHook['kind'][] = ['fight', 'engage', 'run'];

/** What the heroes did this scene that earns XP outside a fight (play/xp.ts). */
function deedsOf(before: RulesState, turn: RulesTurn, scene: StoredScene, choice: StoredChoice | null, round: boolean): Deeds {
  const actors = scene.votes.map((v) => ({ playerId: v.playerId, idle: v.autoRolled === true }));
  const hook = choice?.hook ?? null;
  const events: XpEvent[] = [];
  if ((hook?.kind === 'trap' || hook?.kind === 'move') && turn.success === true) events.push('trap');
  if (hook?.kind === 'parley' && turn.success === true) events.push('social');
  if (before.dungeon && turn.dungeon) {
    const map = turn.dungeon.map;
    if (turn.dungeon.visited.some((id) => !before.dungeon!.visited.includes(id) && map.nodes[id].type !== 'corridor')) events.push('new-ground');
    if (dungeonLevel(turn.dungeon) > dungeonLevel(before.dungeon)) events.push('deeper');
  }
  const paid = choice?.reward && !(hook && FIGHTING.includes(hook.kind)) && turn.fight === null && turn.success !== false;
  return { sceneIndex: scene.index, actors, rolls: turn.rolled, events, tag: paid ? choice.reward! : null, round };
}

/**
 * The quest is over: each living hero who took part gets the adventure's-end milestone (play/xp.ts), then
 * levels up as far as its XP reaches (2024 thresholds, play/fight.ts autoLevelUp). The lines join the
 * scene's, for the table and for the DM's epilogue.
 */
export function endQuest(step: EngineStep): EngineStep {
  const ended = questXp(step.state.party);
  const party = ended.party;
  const levelUps: LevelUp[] = [];
  const lines = [...(party.results ?? []), ...ended.lines];
  const sheets = { ...party.sheets };
  for (const [playerId, sheet] of Object.entries(party.sheets).filter(([, s]) => !s.dead)) {
    const up = autoLevelUp(sheet);
    if (up.sheet.level > sheet.level) levelUps.push({ playerId, from: sheet.level, to: up.sheet.level });
    sheets[playerId] = up.sheet;
    lines.push(...up.lines);
  }
  const rules = step.resolution.rules && { ...step.resolution.rules, lines };
  return { ...step, state: { ...step.state, party: questClosed({ ...party, sheets, results: lines, levelUps }) }, resolution: { ...step.resolution, rules } };
}

/**
 * Combat rounds don't use up the story's scenes: a scene is added for each round, as the round's scene is
 * made (the next scene is a round while a fight is on), and none when a fight ends, so a game of N scenes
 * has N - 1 story scenes and then the epilogue, however many rounds are fought and wherever. A fight still
 * on is never followed by the epilogue (nor in a game counted before this rule). A lost fight makes the next
 * scene the epilogue.
 */
/**
 * Whether the next scene is the epilogue, and the game's scene count after this step. With the quest open
 * the count is pacing: the planned finale passes and as many scenes again are allowed (play/quest.ts
 * overtime), then the ending is called. The goal reached, or the party lost, ends it at once. Rounds add
 * scenes as sceneCountAfter says, in overtime too. At the end the count is the scenes played.
 */
export function endingOf(step: Pick<EngineStep, 'state' | 'fight'>, next: number, sceneCount: number): { isFinale: boolean; sceneCount: number } {
  const quest = step.state.party.quest;
  if (quest?.reached && !step.state.combat) return { isFinale: true, sceneCount: next + 1 };
  const extra = overtime(quest);
  const limit = sceneCountAfter(step, next, sceneCount + extra);
  return next >= limit - 1 ? { isFinale: true, sceneCount: next + 1 } : { isFinale: false, sceneCount: limit - extra };
}

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
