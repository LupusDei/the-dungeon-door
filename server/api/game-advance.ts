import { advanceGame } from '../lib/game.ts';
import { gameCodeOf, handle, originOf, requirePlayer } from '../lib/http.ts';

/** POST /api/games/{code}/advance → GameState. Host only: resolve now with the votes that are in. */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const player = requirePlayer(request);
    return advanceGame(gameCodeOf(request), player, originOf(request));
  });
}
