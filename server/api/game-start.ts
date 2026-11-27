import { requireCurrentApp } from '../lib/app-version.ts';
import { rememberPlayer, startGame } from '../lib/game.ts';
import { handle, originOf, readBody } from '../lib/http.ts';

/** POST /api/games/{code}/start { sceneCount?, dungeon? } → GameState (preparing). Host only; the DM writes scene 0 in the background. */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const { playerId, code, appVersion } = await rememberPlayer(request);
    requireCurrentApp(appVersion);
    const body = await readBody(request);
    return startGame(code, playerId, body.sceneCount, originOf(request), body.dungeon);
  });
}
