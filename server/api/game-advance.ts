import { requireCurrentApp } from '../lib/app-version.ts';
import { advanceGame, rememberPlayer } from '../lib/game.ts';
import { handle, originOf } from '../lib/http.ts';

/** POST /api/games/{code}/advance → GameState. Host only: resolve now with the votes that are in. */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const { playerId, code, appVersion } = await rememberPlayer(request);
    requireCurrentApp(appVersion);
    return advanceGame(code, playerId, originOf(request));
  });
}
