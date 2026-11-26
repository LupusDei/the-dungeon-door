import type { CombatState, DungeonState, PartyState } from '../play/state.ts';
import type { StoredCharacter, ChoiceId, Game, GamePlayer, GameStatus, Message, MessageKind, StoredScene, Vote } from '../types.ts';

export interface NewGame {
  code: string;
  hostId: string;
  dungeonMaster: string;
  sceneCount: number;
  host: GamePlayer;
}

/** Fields a compare-and-set game update may change. */
export interface GamePatch {
  status?: GameStatus;
  title?: string | null;
  sceneIndex?: number;
  dungeonMaster?: string;
  sceneCount?: number;
  hostId?: string;
  party?: PartyState | null;
  combat?: CombatState | null;
  dungeon?: DungeonState | null;
}

/** The precondition of a compare-and-set game update. */
export interface GameExpectation {
  status?: GameStatus;
  sceneIndex?: number;
}

export interface NewMessage {
  kind: MessageKind;
  playerId: string | null;
  characterName: string | null;
  text: string;
}

/** A scene as written by the DM: everything but its votes and resolution. */
export type SceneDraftRecord = Omit<StoredScene, 'votes' | 'outcome' | 'chosenChoiceId' | 'createdAt' | 'voices'>;

/**
 * Persistence for characters, games and chat. Two implementations: Postgres (`postgres.ts`, when
 * DATABASE_URL is set) and in-memory (`memory.ts`, local dev and tests). Every method is a single atomic
 * step, so concurrent requests can't lose each other's writes; the game rules live in lib/game.ts.
 */
export interface Store {
  getCharacter(id: string): Promise<StoredCharacter | null>;
  /** Insert or replace by id. */
  saveCharacter(character: StoredCharacter): Promise<StoredCharacter>;
  /** The owner's characters, newest first. */
  listCharacters(ownerId: string): Promise<StoredCharacter[]>;
  deleteCharacter(id: string): Promise<void>;

  /** Creates a game with its host as the first player. False when the code is already taken. */
  createGame(game: NewGame): Promise<boolean>;
  getGame(code: string): Promise<Game | null>;
  /**
   * Compare-and-set: applies `patch` only if the game currently matches `expect`, and returns whether it
   * did. This is how status transitions (lobby → preparing → voting → resolving → …) happen exactly once.
   */
  updateGame(code: string, expect: GameExpectation, patch: GamePatch): Promise<boolean>;
  /**
   * Adds a player, or swaps the character of one already in the game — only while the game is in the
   * lobby and (for a newcomer) has fewer than `maxPlayers`. Returns whether it did.
   */
  upsertPlayer(code: string, player: GamePlayer, maxPlayers: number): Promise<boolean>;
  removePlayer(code: string, playerId: string): Promise<boolean>;

  /** Inserts (or rewrites the text of) a scene; its votes and resolution are kept. */
  saveScene(code: string, scene: SceneDraftRecord): Promise<void>;
  setSceneImage(code: string, index: number, imageUrl: string): Promise<void>;
  /**
   * Claims the making of a scene's reading in one narrator's voice: true for exactly one caller, until the
   * reading is set or the claim is given back, or `staleMs` pass without either (the maker died). False once
   * the scene has that reading.
   */
  claimSceneVoice(code: string, index: number, voice: string, staleMs: number): Promise<boolean>;
  /** Sets the scene's reading in that voice; null gives the claim back so the next request tries again. */
  setSceneVoice(code: string, index: number, voice: string, voiceUrl: string | null): Promise<void>;
  setSceneOutcome(code: string, index: number, outcome: string, chosenChoiceId: ChoiceId | null): Promise<void>;
  /**
   * Records or changes a vote — only while the game is voting on scene `index`. A changed vote keeps its
   * original roll. Returns the stored vote, or null when the game isn't voting on that scene.
   */
  castVote(code: string, index: number, playerId: string, choiceId: ChoiceId, roll: number): Promise<Vote | null>;
  /**
   * Records a written check on this player's vote — only while the game is voting on scene `index`.
   * The first d20 is kept, as with a changed vote. Returns the stored vote, or null when voting has closed.
   */
  setFreeform(code: string, index: number, playerId: string, roll: number, freeform: NonNullable<Vote['freeform']>): Promise<Vote | null>;

  /** Appends a chat/system/dm message with the game's next message id. */
  addMessage(code: string, message: NewMessage): Promise<Message>;
  /** Messages with id > `since` (all when omitted), oldest first, at most the newest `limit`. */
  listMessages(code: string, since?: number, limit?: number): Promise<Message[]>;
}
