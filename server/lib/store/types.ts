import type { CombatState, DungeonState, PartyState } from '../play/state.ts';
import type { Move } from '../rules/bands.ts';
import type { StoredCharacter, ChoiceId, Game, GamePlayer, GameStatus, Mention, Message, MessageKind, MessageQuote, MessageVoice, RoleplayLine, StoredScene, TypingNotice, Vote } from '../types.ts';

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

/** Someone the player has shared a game with, by the hero they last played beside them. */
export interface Companion { playerId: string; name: string; lastPlayedAt: string }

/** An invitation to a party still in its lobby. */
export interface Invite { code: string; toPlayerId: string; fromPlayerId: string; fromName: string; createdAt: string }
/** An invitation as the invited player sees it: with who is in the party already. */
export interface InviteView extends Invite { party: string[] }

export interface NewMessage {
  kind: MessageKind;
  playerId: string | null;
  characterName: string | null;
  text: string;
  voice?: MessageVoice | null;
  replyTo?: number | null;
  reply?: MessageQuote | null;
  mentions?: Mention[];
  emote?: boolean;
  /** Null or omitted: the whole party. A non-empty list is a whisper to those players. */
  whisperTo?: Mention[] | null;
}

/** A scene as written by the DM: everything but its votes, its in-character lines, and its resolution. */
export type SceneDraftRecord = Omit<StoredScene, 'votes' | 'outcome' | 'chosenChoiceId' | 'createdAt' | 'voices' | 'roleplay'>;

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
  /**
   * Records the app version last seen from a player already in the game. No-op when they are not
   * seated, or when the stored value is already this one. Null means the client sent no version.
   */
  noteAppVersion(code: string, playerId: string, appVersion: string | null): Promise<void>;
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
   * original roll. `named` is the legal action the vote names; null is a choice letter, and clears one.
   * Returns the stored vote, or null when the game isn't voting on that scene.
   */
  castVote(code: string, index: number, playerId: string, choiceId: ChoiceId, roll: number, named?: { actionId: string; targets: string[] } | null, move?: Move | null): Promise<Vote | null>;
  /**
   * Records a written check on this player's vote — only while the game is voting on scene `index`.
   * The first d20 is kept, as with a changed vote. Returns the stored vote, or null when voting has closed.
   */
  setFreeform(code: string, index: number, playerId: string, roll: number, freeform: NonNullable<Vote['freeform']>): Promise<Vote | null>;
  /**
   * Appends an in-character line to the scene, only while the game is voting on it and the turn holds
   * fewer than 20. Returns the turn's lines, or null when the scene is not open.
   */
  appendRoleplay(code: string, index: number, line: RoleplayLine): Promise<RoleplayLine[] | null>;

  /** Appends a chat/system/dm message with the game's next message id. Ids are never reused. */
  addMessage(code: string, message: NewMessage): Promise<Message>;
  /** One line, or null. Used to quote a reply and to reject a reply to a line that isn't there. */
  getMessage(code: string, id: number): Promise<Message | null>;
  /** Messages with id > `since` (all when omitted), oldest first, at most the newest `limit`. */
  listMessages(code: string, since?: number, limit?: number): Promise<Message[]>;
  /**
   * Lines with id ≤ `since` whose reactions have changed, oldest first, at most the newest `limit`.
   * A reaction never changes the line's id, so the poll can deliver it beside the new lines.
   */
  listUpdatedMessages(code: string, since: number, limit?: number): Promise<Message[]>;
  /** Adds the caller's emoji or removes it if they already had it. Null when the line isn't in the game. */
  toggleReaction(code: string, messageId: number, playerId: string, emoji: string): Promise<Message | null>;
  /** `until` is an ISO time; a time in the past clears the player. */
  setTyping(code: string, playerId: string, name: string, until: string): Promise<void>;
  /** Players still composing at `now` (ISO). */
  listTyping(code: string, now: string): Promise<TypingNotice[]>;

  /** The players this one has shared a game with, most recent first. */
  listCompanions(playerId: string, limit?: number): Promise<Companion[]>;
  /** Records an invitation. False when that player is already invited to that game. */
  addInvite(invite: Invite): Promise<boolean>;
  /** The player's invitations to games still in the lobby that they have not joined, newest first. */
  listInvites(toPlayerId: string): Promise<InviteView[]>;
  removeInvite(code: string, toPlayerId: string): Promise<void>;
}
