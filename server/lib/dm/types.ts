/**
 * The dungeon-master seam. The game engine (lib/game.ts) owns state, votes, dice and persistence; a
 * DungeonMaster only *writes*: given the adventure so far, it returns the next scene. Implementations are
 * registered per archetype in ./registry.ts. See docs/dungeon-master.md.
 */
import type { DungeonMasterArchetype } from '../catalog.ts';
import type { ChoiceId } from '../types.ts';

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
}

export interface ChatLine {
  characterName: string | null;
  kind: 'chat' | 'dm';
  text: string;
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
  /** Total scenes planned, including the finale (the finale is index sceneCount - 1). */
  sceneCount: number;
  /** The most recent table talk, oldest first. Players may hint at what they want. */
  recentChat: ChatLine[];
}

export interface SceneText {
  title: string;
  /** 2–4 short paragraphs. */
  narration: string;
  /** What to paint: one scene, concrete and visual. The engine adds style and the party's looks. */
  imagePrompt: string;
  /** Which party members (by name) appear in the picture; their portraits become references. */
  featuredCharacters?: string[];
  /** One short in-character line for the chat (optional). */
  quip?: string;
}

export interface DMChoice {
  label: string;
  detail: string;
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

export interface DungeonMaster {
  /** Scene 0: names the adventure and sets the hook. */
  openingScene(ctx: DMContext): Promise<OpeningScene>;
  /** Resolves the vote on the last scene of `ctx.history` and writes scene `ctx.sceneIndex`. */
  nextScene(ctx: DMContext, resolution: Resolution): Promise<NextScene>;
  /** Resolves the final vote and writes the epilogue (scene `ctx.sceneCount - 1`). */
  finale(ctx: DMContext, resolution: Resolution): Promise<FinaleScene>;
}
