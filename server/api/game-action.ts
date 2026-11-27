import { requireCurrentApp } from '../lib/app-version.ts';
import { castAction, rememberPlayer } from '../lib/game.ts';
import { handle, originOf, readBody } from '../lib/http.ts';

/** POST /api/games/{code}/action { sceneIndex, text } → GameState with `action`. */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const { playerId, code, appVersion } = await rememberPlayer(request);
    requireCurrentApp(appVersion);
    const body = await readBody(request);
    return castAction(code, playerId, body.sceneIndex, body.text, originOf(request));
  });
}
