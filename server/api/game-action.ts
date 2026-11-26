import { castAction } from '../lib/game.ts';
import { gameCodeOf, handle, originOf, readBody, requirePlayer } from '../lib/http.ts';

/** POST /api/games/{code}/action { sceneIndex, text } → GameState with `action`. */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const player = requirePlayer(request);
    const body = await readBody(request);
    return castAction(gameCodeOf(request), player, body.sceneIndex, body.text, originOf(request));
  });
}
