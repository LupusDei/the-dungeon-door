import { requireCurrentApp } from '../lib/app-version.ts';
import { castVote, rememberPlayer } from '../lib/game.ts';
import { handle, originOf, readBody } from '../lib/http.ts';

/** POST /api/games/{code}/vote { sceneIndex, choiceId } or { sceneIndex, actionId, targets? } → GameState. Resolves the scene once everyone has voted. */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const { playerId, code, appVersion } = await rememberPlayer(request);
    requireCurrentApp(appVersion);
    const body = await readBody(request);
    return castVote(code, playerId, body, originOf(request));
  });
}
