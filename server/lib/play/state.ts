/**
 * The rules engine's state on a game, stored as JSON columns beside it (db/schema.sql). All three are null
 * for a game that began before the engine was wired, and the game then plays as it always did.
 */
import type { Dungeon } from '../rules/dungeon.ts';
import type { CombatState } from '../rules/scene.ts';
import type { CharacterSheet } from '../rules/sheet.ts';

export type { CombatState } from '../rules/scene.ts';

/** The heroes' sheets during the adventure, by player id, and the dice for rolls outside combat. */
export interface PartyState {
  version: 1;
  /** seededRng(rng) continues the game's dice. */
  rng: number;
  sheets: Record<string, CharacterSheet>;
  /** The engine's lines for the last resolved scene (the API's rules.results). */
  results?: string[];
}

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
}
