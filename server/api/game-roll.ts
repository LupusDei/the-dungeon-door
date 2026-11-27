import { requireCurrentApp } from '../lib/app-version.ts';
import { rememberPlayer, throwDie } from '../lib/game.ts';
import { handle, originOf, readBody } from '../lib/http.ts';

/** POST /api/games/{code}/roll { sceneIndex } → GameState. Reveals the d20 rolled when the caller declared. */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const { playerId, code, appVersion } = await rememberPlayer(request);
    requireCurrentApp(appVersion);
    const body = await readBody(request);
    return throwDie(code, playerId, body.sceneIndex, originOf(request));
  });
}
