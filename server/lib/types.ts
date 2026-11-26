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

/** A scene as stored. `imagePrompt` and `chosenChoiceId` are server-only. */
/** A choice as stored: with the rules hook the engine checked (rules-engine games). */
export interface StoredChoice extends Choice {
  hook?: RulesHook | null;
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
  choices: ChoiceView[];
  /** A combat round: each vote is that player's own hero's action, and the choices are written for the caller's hero. */
  combat: boolean;
  /** False when the caller's hero cannot act this round (down or dead): the round does not wait for them. */
  canAct: boolean;
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
  /** The rules engine's numbers; null for games started before it. */
  rules: RulesView | null;
  updatedAt: string;
}
