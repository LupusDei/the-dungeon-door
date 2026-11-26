/** Shapes shared by the API (see docs/api.md) and the store. All timestamps are ISO-8601 strings. */
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
  createdAt: string;
  updatedAt: string;
}

/** A character as stored: heroes saved before the rules engine have no sheet (and may be a half-orc or half-elf). */
export type StoredCharacter = Omit<Character, 'sheet'> & { sheet?: CharacterSheet };

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

/** A scene as stored. `imagePrompt` and `chosenChoiceId` are server-only. */
export interface StoredScene {
  index: number;
  title: string;
  narration: string;
  imagePrompt: string;
  imageUrl: string | null;
  choices: Choice[];
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
  createdAt: string;
  updatedAt: string;
}

export type MessageKind = 'chat' | 'system' | 'dm';

export interface Message {
  id: number;
  kind: MessageKind;
  playerId: string | null;
  characterName: string | null;
  text: string;
  createdAt: string;
}

// ---- API views ----

export interface SceneView {
  index: number;
  title: string;
  narration: string;
  imageUrl: string | null;
  choices: Choice[];
  isFinale: boolean;
  votes: Vote[];
  myVote: ChoiceId | null;
  outcome: string | null;
}

export interface ChronicleEntry {
  index: number;
  title: string;
  imageUrl: string | null;
  choiceLabel: string;
  outcome: string;
}

export interface GameState {
  code: string;
  hostId: string;
  status: GameStatus;
  dungeonMaster: string;
  title: string | null;
  sceneCount: number;
  players: { playerId: string; character: StoredCharacter; isHost: boolean; joinedAt: string }[];
  scene: SceneView | null;
  chronicle: ChronicleEntry[];
  messages: Message[];
  updatedAt: string;
}
