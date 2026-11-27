/** Shapes shared by the API (see docs/api.md) and the store. All timestamps are ISO-8601 strings. */
import type { AttackView } from './attacks.ts';
import type { RulesHook } from './play/hooks.ts';
import type { CombatState, DungeonState, PartyState } from './play/state.ts';
import type { RulesView } from './play/view.ts';
import type { Move } from './rules/bands.ts';
import type { Battlefield } from './rules/grid.ts';
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
  /**
   * The forge placed the background's ability increases, and the scores are still exactly those, so the
   * player may place them once. Worked out on read, not stored.
   */
  bonusesOpen: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A character as stored: heroes saved before the rules engine have no sheet (and may be a half-orc or half-elf). */
export type StoredCharacter = Omit<Character, 'sheet' | 'attacks' | 'bonusesOpen'> & { sheet?: CharacterSheet };

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
  /** A combat move taken with this vote. Absent outside a fight, and on votes from before range bands. */
  move?: Move;
  /** Set when the vote named a legal action rather than a choice letter. */
  actionId?: string;
  /** Ids from that action's targets. Absent when the action needs none. */
  targets?: string[];
  /**
   * Words kept with this vote. A `ruling` is a check (a written action, or a skill or ability from
   * the sheet): it counts as having acted and does not add to the tally. Text without a ruling is
   * intent beside a named action and the action still resolves.
   */
  freeform?: { text: string; ruling?: import('./play/actions.ts').CheckRuling };
  /**
   * Set when this vote's d20 is the player's to throw. The face is `roll`, hidden until `revealed`.
   * Absent when the engine does not ask them to throw.
   */
  die?: import('./play/dice.ts').PlayerDie;
  /** False while `die` is still hidden. Absent means the roll was never hidden. */
  revealed?: boolean;
}

/** One thing the caller's hero might do this turn. See docs/api.md, LegalAction. */
export interface LegalAction {
  id: string;
  label: string;
  /** "attack", "spell", "item", "feature", "common", "choice", "move", "skill", or "ability". */
  kind: string;
  detail: string;
  targets: { id: string; name: string }[];
  /** "none": no target. "one": exactly one of targets. "many": one or more, at most `limit`. */
  picks: 'none' | 'one' | 'many';
  /** For picks "many": how many targets a vote may name. */
  limit?: number;
  /** A move: squares this action can end on. Walls block; an occupied square is not an end. */
  squares?: { x: number; y: number }[];
  /** An attack or spell. Null for melee. `long` is null when there is no long range. */
  rangeFeet?: { normal: number; long: number | null } | null;
  /** A melee attack or touch spell, in feet. Null when the action is ranged. */
  reachFeet?: number | null;
  available: boolean;
  /** Why it cannot be taken; null when available. */
  reason: string | null;
}

/** A vote as the app sees it. `roll` is null while the player has not thrown. */
export interface VoteView extends Omit<Vote, 'roll' | 'die' | 'revealed' | 'freeform'> {
  roll: number | null;
  /** The thrown total, natural plus modifier, once the die is revealed. */
  total?: number | null;
  formula?: string;
  /** True while the face is still hidden. */
  pending?: boolean;
  label?: string;
  /** Words the player added to a named action. A check's words are in `freeforms` instead. */
  intent?: string;
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
  /** In-character lines this turn, oldest first. Absent on scenes from before players could speak in character. */
  roleplay?: RoleplayLine[];
  createdAt: string;
}

export interface GamePlayer {
  playerId: string;
  character: StoredCharacter;
  joinedAt: string;
  /** Last `x-dd-app-version` from this player. Null or absent when their client never sent one. */
  appVersion?: string | null;
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
  /** True when the quoted line was an emote. Absent on quotes from before emotes. */
  emote?: boolean;
}

/** Something a player said or did in character this turn. No roll, and the engine does not adjudicate it. */
export interface RoleplayLine {
  playerId: string;
  characterName: string;
  text: string;
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
  /** A third-person action. The table reads it as "*Name text*". False on lines from before emotes. */
  emote: boolean;
  /**
   * Who else may read this whisper, besides the sender. Null when the whole party may.
   * Never returned to anyone else, and never given to the narrator, whatever `voice` says.
   */
  whisperTo: Mention[] | null;
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
  /** What the caller's hero can take this turn. Empty for the epilogue and a resolved scene. */
  actions: LegalAction[];
  /**
   * The d20 the caller still has to throw. Null when they have thrown, or when this action
   * needs no throw. The face is not in here.
   */
  myDie: import('./play/dice.ts').PlayerDie | null;
  /** A combat round: each vote is that player's own hero's action, and the choices are written for the caller's hero. */
  combat: boolean;
  /** False when the caller's hero cannot act this round (down or dead): the round does not wait for them. */
  canAct: boolean;
  /** The fight's map of 5-foot squares, or null outside combat. */
  battlefield: Battlefield | null;
  isFinale: boolean;
  /** Votes for a, b or c, or a named legal action. A written check is in `freeforms`, not here. */
  votes: VoteView[];
  myVote: ChoiceId | null;
  /** The caller's vote as an action id. A letter vote is "choice:a" and so on. Null until they vote, and null for a written check with no action. `intent` is words they added. */
  myAction: { id: string; targets: string[]; intent?: string } | null;
  /** Written checks this scene. `roll` is null until that player throws. */
  freeforms: { playerId: string; text: string; roll: number | null; pending?: boolean }[];
  /** The caller's written check, or null. */
  myFreeform: { text: string; roll: number | null; pending?: boolean } | null;
  outcome: string | null;
  /** In-character lines this turn, oldest first. Empty when nobody has spoken. */
  roleplay: RoleplayLine[];
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
  /** What the heroes said and did in character that turn. */
  roleplay: RoleplayLine[];
}

export interface GameState {
  code: string;
  hostId: string;
  status: GameStatus;
  dungeonMaster: string;
  title: string | null;
  sceneCount: number;
  /** In a rules game each character is the hero as it stands in the game (live sheet). */
  players: { playerId: string; character: Character; isHost: boolean; joinedAt: string; appVersion: string | null; outdated: boolean }[];
  scene: SceneView | null;
  chronicle: ChronicleEntry[];
  messages: Message[];
  /** Lines at or before `since` whose reactions changed. Empty when the poll asked for the whole log. */
  messageUpdates: Message[];
  /** Players composing a line, other than the caller. */
  typing: TypingNotice[];
  /** The rules engine's numbers; null for games started before it. */
  rules: RulesView | null;
  /**
   * Set while status is `voting` on a scene that is not the finale. Null in the lobby, while the
   * opening is being written, while the next turn is being written (`resolving`), and after the end.
   */
  turn: TurnWindow | null;
  updatedAt: string;
}

/** The choice window while the table is voting. Display only: see play/turn-clock.ts. */
export interface TurnWindow {
  /** When the window ends, ISO-8601. */
  deadline: string;
  /** The window's length, in seconds. */
  seconds: number;
  /** The server's clock when this view was built, ISO-8601. */
  now: string;
}
