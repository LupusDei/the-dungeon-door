import { requireCurrentApp } from '../lib/app-version.ts';
import { callEnding, rememberPlayer } from '../lib/game.ts';
import { handle } from '../lib/http.ts';

/** POST /api/games/{code}/ending → GameState. Host only: this scene is the last, then the epilogue. */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const { playerId, code, appVersion } = await rememberPlayer(request);
    requireCurrentApp(appVersion);
    return callEnding(code, playerId);
  });
}
