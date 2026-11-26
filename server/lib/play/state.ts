/**
 * The rules engine's state on a game, stored as JSON columns beside it (db/schema.sql). All three are null
 * for a game that began before the engine was wired, and the game then plays as it always did.
 */
import type { Dungeon } from '../rules/dungeon.ts';
import type { CombatState } from '../rules/scene.ts';
import type { CharacterSheet } from '../rules/sheet.ts';
import type { Attitude } from './parley.ts';
import type { Lit } from './time.ts';

export type { CombatState } from '../rules/scene.ts';

/** The heroes' sheets during the adventure, by player id, and the dice for rolls outside combat. */
export interface PartyState {
  version: 1;
  /** seededRng(rng) continues the game's dice. */
  rng: number;
  sheets: Record<string, CharacterSheet>;
  /** The engine's lines for the last resolved scene (the API's rules.results). */
  results?: string[];
  /** Seconds since the adventure began (play/time.ts); absent in games from before it: 0. */
  clock?: number;
  /** The light the party carries lit, if any (absent or null: none). */
  lit?: Lit | null;
  /** Who levelled up at the quest's end (play/table.ts endQuest); absent before it ends. */
  levelUps?: LevelUp[];
}

/** A hero's level before and after the quest's end. */
export interface LevelUp { playerId: string; from: number; to: number }

/** Where the party is in its dungeon, and what it has found and beaten there. */
export interface DungeonState {
  version: 1;
  map: Dungeon;
  /** The area the party is in. */
  at: string;
  /** Areas entered, oldest first: the map the players have seen. */
  visited: string[];
  /** Rooms whose monsters, trap and treasure are dealt with. */
  cleared: string[];
  /** The attitude of the foes met in each room (play/parley.ts); absent in games from before it. */
  attitudes?: Record<string, Attitude>;
  /** The area the party came from on the last move, so a Run can back out. Absent before that move. */
  cameFrom?: string;
  /** Wanderers barring the way, awaiting Engage, Run or Parley. Absent when none are. */
  facing?: { monsters: string[]; attitude: Attitude };
  /** Seconds toward the next wandering-monster check (play/wandering.ts); absent: 0. */
  wander?: number;
  /** Something loud just happened (a fight ended, a trap went off): a check comes at once, 2 in 6. */
  noise?: true;
  /** The dungeon level the party has reached (Phase 5, play/delve.ts dungeonLevel); absent: the map's starting level. */
  level?: number;
  /** Where the dungeon went deeper, and to what level, oldest first. */
  deepened?: { at: string; level: number }[];
}
