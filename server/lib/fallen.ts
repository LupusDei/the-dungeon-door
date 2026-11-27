/** How and where a hero fell: worked out from the scene that killed it, kept on the character (docs/api.md). */
import type { PartyState } from './play/state.ts';
import type { Death, Game, GamePlayer, StoredScene } from './types.ts';

const SAYS_DEATH = /\b(dies|is dead)\b/;

/** The heroes a resolution killed: alive in `before` (or not there at all), dead in `after`. */
export function newlyFallen(before: PartyState | null, after: PartyState, players: readonly GamePlayer[]): GamePlayer[] {
  return players.filter((p) => after.sheets[p.playerId]?.dead === true && before?.sheets[p.playerId]?.dead !== true);
}

/** The engine's last line that says this hero died, if any did. */
export function causeOf(name: string, lines: readonly string[]): string | null {
  return lines.findLast((line) => line.includes(name) && SAYS_DEATH.test(line)) ?? null;
}

export function deathIn(game: Pick<Game, 'code' | 'title'>, scene: Pick<StoredScene, 'title'> | null, name: string, lines: readonly string[], at: string): Death {
  return { at, adventure: game.title, place: scene?.title || null, cause: causeOf(name, lines), gameCode: game.code };
}
