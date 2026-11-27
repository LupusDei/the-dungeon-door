import { requireCurrentApp } from '../lib/app-version.ts';
import { rememberPlayer, speakInCharacter } from '../lib/game.ts';
import { handle, readBody } from '../lib/http.ts';

/** POST /api/games/{code}/speak { text } → GameState. An in-character line or deed. No roll. */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const { playerId, code, appVersion } = await rememberPlayer(request);
    requireCurrentApp(appVersion);
    const body = await readBody(request);
    return speakInCharacter(code, playerId, body.text);
  });
}
