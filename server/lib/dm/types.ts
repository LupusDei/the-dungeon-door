/**
 * The dungeon-master seam. The game engine (lib/game.ts) owns state, votes, dice and persistence; a
 * DungeonMaster only *writes*: given the adventure so far, it returns the next scene. Implementations are
 * registered per archetype in ./registry.ts. See docs/dungeon-master.md.
 */
import type { DungeonMasterArchetype } from '../catalog.ts';
import type { RulesHook } from '../play/hooks.ts';
import type { FightNews } from '../play/turn.ts';
import type { RulesContext } from '../play/view.ts';
import type { ChoiceId, RoleplayLine } from '../types.ts';

export type { RulesContext } from '../play/view.ts';

export interface PartyMember {
  playerId: string;
  name: string;
  /** Display names, e.g. "Half-Orc", "Warlock", "Chaotic Good". */
  race: string;
  characterClass: string;
  gender: string;
  temperament: string;
  alignment: string;
  backstory: string;
  /** The player's own words about their look. */
  description: string;
  /** The DM-embellished visual description used for art (falls back to `description`). */
  appearance: string;
}

export interface VoteRecord {
  playerId: string;
  characterName: string;
  choiceId: ChoiceId;
  choiceLabel: string;
  /** d20, 1–20. A 1 is a critical failure, a 20 a critical success. */
  roll: number;
}

export interface ChoiceRecord {
  id: ChoiceId;
  label: string;
  detail: string;
}

/** A scene that already happened. */
export interface PastScene {
  index: number;
  title: string;
  narration: string;
  choices: ChoiceRecord[];
  votes: VoteRecord[];
  /** The DM's summary of what happened (null only for a scene still being resolved). */
  outcome: string | null;
  chosenChoiceId: ChoiceId | null;
  /** Lines and deeds the players wrote in character this turn, oldest first. */
  roleplay?: RoleplayLine[];
}

/** The scene the party just voted on, with everything the DM needs to weigh the votes. */
export interface Resolution {
  scene: PastScene;
  votes: VoteRecord[];
  /** Votes per choice, e.g. { a: 2, b: 1, c: 0 }. */
  tally: Record<ChoiceId, number>;
  /** The most-voted choice(s); more than one on a tie. */
  leaders: ChoiceId[];
  /** Characters who didn't vote (AFK when the host advanced). */
  abstained: string[];
  /** What the rules engine rolled for the chosen choice; null for a game from before the engine. */
  rules: RulesResults | null;
}

/** The engine's results for the resolved scene. Narrate them; never change them. */
export interface RulesResults {
  /** The choice the engine picked (ties go to the higher-rolling voters); `leaders` is just this. */
  chosen: ChoiceId | null;
  /** The dice, one line each ("Bryn: Athletics 14 + 5 = 19 vs DC 12, success"). */
  lines: string[];
  /** For a check or save: did the party succeed? */
  success: boolean | null;
  fight: FightNews;
}

export interface ChatLine {
  characterName: string | null;
  kind: 'chat' | 'dm';
  text: string;
  /**
   * "in" when a player speaks as their hero, "out" when they speak as themselves.
   * Null on the dungeon master's own lines. On the line so a prompt can tell roleplay from table talk.
   */
  voice: 'in' | 'out' | null;
  /** A third-person deed ("*draws her sword*"). Absent on speech, and on lines from before emotes. */
  emote?: boolean;
}

export interface DMContext {
  archetype: DungeonMasterArchetype;
  /** The adventure's title (null until the opening scene names it). */
  adventureTitle: string | null;
  party: PartyMember[];
  /** Every scene so far, oldest first (on resolve, the last one is the scene being resolved). */
  history: PastScene[];
  /** Index of the scene to write now (0 for the opening). */
  sceneIndex: number;
  /** Total scenes planned, including the finale (the finale is index sceneCount - 1). Meaningless while `openEnded`. */
  sceneCount: number;
  /** The adventure has no set length: it goes on until the table calls the ending. Absent: a set length. */
  openEnded?: boolean;
  /** The most recent table talk, oldest first. Players may hint at what they want. */
  recentChat: ChatLine[];
  /** The rules engine's state (after the resolved scene's dice); null for a game from before the engine. */
  rules: RulesContext | null;
}

export interface SceneText {
  title: string;
  /** 2–4 short paragraphs. */
  narration: string;
  /** What to paint: one scene, concrete and visual. The engine adds style and the party's looks. */
  imagePrompt: string;
  /** The party members (by name) nearest the viewer in the picture. Every living hero is painted (lib/scene-art.ts). */
  featuredCharacters?: string[];
  /** One short in-character line for the chat (optional). */
  quip?: string;
}

export interface DMChoice {
  label: string;
  detail: string;
  /**
   * The mechanic behind the choice (rules-engine games): a RulesHook (play/hooks.ts). The engine checks it
   * where it enters; a missing or bad one makes the choice pure story.
   */
  rules?: RulesHook | Record<string, unknown> | null;
  /**
   * What taking the choice would be, for XP (rules-engine games, play/xp.ts): "discovery", "social", "puzzle"
   * or "milestone"; absent, null or "none" for most choices. The engine sets the amount and pays it only
   * when the party takes the choice and its dice do not fail.
   */
  reward?: string | null;
}

export interface OpeningScene extends SceneText {
  /** The name of the whole adventure. */
  adventureTitle: string;
  /** Exactly three. The engine assigns ids a, b, c in order. */
  choices: DMChoice[];
}

export interface ResolvedTurn {
  /** What happened as a result of the vote: summary of the previous scene's resolution, 1–3 sentences. */
  outcome: string;
  /** The choice the party went with. Must be one of `resolution.leaders`; otherwise the engine uses the first leader. */
  chosenChoiceId: ChoiceId;
}

export interface NextScene extends SceneText, ResolvedTurn {
  choices: DMChoice[];
}

/** The epilogue: no choices, the game ends. */
export interface FinaleScene extends SceneText, ResolvedTurn {}

/** What a player wrote, and the actions it may map onto. The DM classifies; it does not roll. */
export interface ActionRequest {
  characterName: string;
  /** The player's own words. */
  text: string;
  inCombat: boolean;
  /** Ids the text may map onto (today's actions). */
  actions: readonly string[];
  /** The choices on offer, so a known action can name one. */
  choices: { id: string; label: string }[];
}

export interface DungeonMaster {
  /** Scene 0: names the adventure and sets the hook. */
  openingScene(ctx: DMContext): Promise<OpeningScene>;
  /** Resolves the vote on the last scene of `ctx.history` and writes scene `ctx.sceneIndex`. */
  nextScene(ctx: DMContext, resolution: Resolution): Promise<NextScene>;
  /** Resolves the final vote and writes the epilogue (scene `ctx.sceneCount - 1`). */
  finale(ctx: DMContext, resolution: Resolution): Promise<FinaleScene>;
  /**
   * Classifies a written action. No numbers: a known action id, a check (ability or skill, a tier, an
   * effect category), or impossible. Absent on a DM that does not adjudicate written actions; the engine
   * then treats the action as impossible and the turn is not spent.
   */
  classifyAction?(ctx: DMContext, request: ActionRequest): Promise<unknown>;
}
