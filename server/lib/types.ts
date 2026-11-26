/** Shapes shared by the API (see docs/api.md) and the store. All timestamps are ISO-8601 strings. */
import type { AttackView } from './attacks.ts';
import type { RulesHook } from './play/hooks.ts';
import type { CombatState, DungeonState, PartyState } from './play/state.ts';
import type { RulesView } from './play/view.ts';
import type { CharacterSheet } from './rules/sheet.ts';

export interface Character {
  id: string;
  ownerId: string;
  name: string;
  race: string;
  characterClass: string;
  gender: string;
  temperament: string;
  alignment: string;
  backstory: string;
  description: string;
  appearance: string | null;
  portraitUrl: string | null;
  /** The rules engine's numbers (SRD 5.2), built and kept by the server. */
  sheet: CharacterSheet;
  /** What the hero can attack with, worked out from the sheet on every read (lib/attacks.ts). */
  attacks: AttackView[];
  createdAt: string;
  updatedAt: string;
}

/** A character as stored: heroes saved before the rules engine have no sheet (and may be a half-orc or half-elf). */
export type StoredCharacter = Omit<Character, 'sheet' | 'attacks'> & { sheet?: CharacterSheet };

export type GameStatus = 'lobby' | 'preparing' | 'voting' | 'resolving' | 'ended';
export type ChoiceId = 'a' | 'b' | 'c';
export const CHOICE_IDS: readonly ChoiceId[] = ['a', 'b', 'c'];

export interface Choice {
  id: ChoiceId;
  label: string;
  detail: string;
}

export interface Vote {
  playerId: string;
  choiceId: ChoiceId;
  /** d20, rolled by the server on the first vote and kept when the vote changes. */
  roll: number;
}

/** A vote as the app sees it. In a combat round `label` is what that hero is doing, in their own choice's words: "Cast Fire Bolt", "Break Free", "Help Ilsa". */
export interface VoteView extends Vote {
  label?: string;
}

/** A scene as stored. `imagePrompt` and `chosenChoiceId` are server-only. */
/** A choice as stored: with the rules hook the engine checked (rules-engine games). */
export interface StoredChoice extends Choice {
  hook?: RulesHook | null;
  /** The hook's label, made where the choice was offered (a way on is named from there); absent on choices from before. */
  rules?: string | null;
}

/** A choice as the API shows it: the hook as a label ("Athletics check, DC 12"). */
export interface ChoiceView extends Choice {
  rules: string | null;
}

export interface StoredScene {
  index: number;
  title: string;
  narration: string;
  imagePrompt: string;
  imageUrl: string | null;
  /** The readings of this scene made so far, by narrator id (lib/voice.ts): one per voice a player has asked for. */
  voices: Record<string, string>;
  choices: StoredChoice[];
  isFinale: boolean;
  votes: Vote[];
  outcome: string | null;
  /** The choice the party went with: most votes, ties broken by the DM. Set on resolution. */
  chosenChoiceId: ChoiceId | null;
  createdAt: string;
}

export interface GamePlayer {
  playerId: string;
  character: StoredCharacter;
  joinedAt: string;
}

/** Everything about a game except its chat, as the store returns it. */
export interface Game {
  code: string;
  hostId: string;
  status: GameStatus;
  dungeonMaster: string;
  title: string | null;
  sceneCount: number;
  /** Index of the current scene, -1 before the opening scene exists. */
  sceneIndex: number;
  players: GamePlayer[]; // oldest first
  scenes: StoredScene[]; // oldest first
  /** Rules engine state; all null for games from before the engine. */
  party: PartyState | null;
  combat: CombatState | null;
  dungeon: DungeonState | null;
  createdAt: string;
  updatedAt: string;
}

export type MessageKind = 'chat' | 'system' | 'dm';

/** "in": the hero speaks. "out": the player, out of character. */
export type MessageVoice = 'in' | 'out';

/** Who a `@name` points at. "hero" is the character; "player" is the person who plays them. */
export type MentionTarget = 'hero' | 'player';

export interface Mention {
  playerId: string;
  /** The hero's name, as the party knows it. */
  name: string;
  target: MentionTarget;
}

/** One emoji on a line. `count` is `playerIds.length`; ids are in the order they first reacted. */
export interface Reaction {
  emoji: string;
  count: number;
  playerIds: string[];
}

/** A snapshot of the line a message answers. It has no reactions: those live on the original. */
export interface MessageQuote {
  id: number;
  kind: MessageKind;
  playerId: string | null;
  characterName: string | null;
  text: string;
  voice: MessageVoice | null;
}

export interface Message {
  /** Monotonic per game, and stable: reactions edit the line and never mint a new id. */
  id: number;
  kind: MessageKind;
  playerId: string | null;
  characterName: string | null;
  text: string;
  /** "in" or "out" on a player's line; null for system and dm. A chat line from before the field reads as "in". */
  voice: MessageVoice | null;
  replyTo: number | null;
  reply: MessageQuote | null;
  mentions: Mention[];
  reactions: Reaction[];
  createdAt: string;
}

export interface TypingNotice {
  playerId: string;
  /** The hero's name, so the table can say who is writing. */
  name: string;
}

// ---- API views ----

export interface SceneView {
  index: number;
  title: string;
  narration: string;
  imageUrl: string | null;
  /** The readings of this scene made so far, by narrator id: audio files. A player asks for one with POST …/narration. */
  voices: Record<string, string>;
  /** The default narrator's reading, or null: what apps from before the voice picker play. */
  voiceUrl: string | null;
  choices: ChoiceView[];
  /** A combat round: each vote is that player's own hero's action, and the choices are written for the caller's hero. */
  combat: boolean;
  /** False when the caller's hero cannot act this round (down or dead): the round does not wait for them. */
  canAct: boolean;
  isFinale: boolean;
  votes: VoteView[];
  myVote: ChoiceId | null;
  outcome: string | null;
}

export interface ChronicleEntry {
  index: number;
  title: string;
  imageUrl: string | null;
  /** The readings of that scene that were made, by narrator id; `voiceUrl` is the default narrator's. */
  voices: Record<string, string>;
  voiceUrl: string | null;
  choiceLabel: string;
  outcome: string;
  /** A combat round: every hero took their own action, so `choiceLabel` is empty. */
  combat: boolean;
}

export interface GameState {
  code: string;
  hostId: string;
  status: GameStatus;
  dungeonMaster: string;
  title: string | null;
  sceneCount: number;
  /** In a rules game each character is the hero as it stands in the game (live sheet). */
  players: { playerId: string; character: Character; isHost: boolean; joinedAt: string }[];
  scene: SceneView | null;
  chronicle: ChronicleEntry[];
  messages: Message[];
  /** Lines at or before `since` whose reactions changed. Empty when the poll asked for the whole log. */
  messageUpdates: Message[];
  /** Players composing a line, other than the caller. */
  typing: TypingNotice[];
  /** The rules engine's numbers; null for games started before it. */
  rules: RulesView | null;
  updatedAt: string;
}
