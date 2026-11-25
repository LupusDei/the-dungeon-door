import { startGame } from '../lib/game.ts';
import { gameCodeOf, handle, originOf, readBody, requirePlayer } from '../lib/http.ts';

/** POST /api/games/{code}/start { sceneCount? } → GameState (preparing). Host only; the DM writes scene 0 in the background. */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const player = requirePlayer(request);
    const body = await readBody(request);
    return startGame(gameCodeOf(request), player, body.sceneCount, originOf(request));
  });
}
