/**
 * The choice window the table sees while it is voting (docs/api.md, GameState.turn).
 *
 * It is display only. A vote is still taken after `deadline`, and nothing in the game
 * looks at this clock to resolve a scene. The host can still advance.
 *
 * The window opens when the scene is stored, which is when voting on it begins.
 */
import type { GameStatus } from '../types.ts';

/** How long the party has to choose, counted from the scene's creation. */
export const TURN_SECONDS = 90;

export interface TurnWindow {
  /** When the window ends, ISO-8601. */
  deadline: string;
  /** The window's length, in seconds. A bar drains across it. */
  seconds: number;
  /** The server's clock when this view was built, ISO-8601. */
  now: string;
}

/** The window for a scene the table is choosing, or null when it is not. */
export function turnWindow(
  status: GameStatus,
  scene: { createdAt: string; isFinale: boolean } | null,
  now: Date = new Date(),
): TurnWindow | null {
  if (status !== 'voting' || !scene || scene.isFinale) return null;
  const start = Date.parse(scene.createdAt);
  if (!Number.isFinite(start)) return null;
  return {
    deadline: new Date(start + TURN_SECONDS * 1000).toISOString(),
    seconds: TURN_SECONDS,
    now: now.toISOString(),
  };
}
