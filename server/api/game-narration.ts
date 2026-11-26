import { requestNarration } from '../lib/game.ts';
import { gameCodeOf, handle, originOf, readBody, requirePlayer } from '../lib/http.ts';

/**
 * POST /api/games/{code}/narration { sceneIndex } → { sceneIndex, status: "ready" | "making", voiceUrl }.
 * A scene read aloud by the narrator: made the first time a player asks, then kept. While it is "making",
 * the file's URL arrives on the scene itself (GameState.scene.voiceUrl), so the app's poll picks it up.
 */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const player = requirePlayer(request);
    const body = await readBody(request);
    return requestNarration(gameCodeOf(request), player, body.sceneIndex, originOf(request));
  });
}
