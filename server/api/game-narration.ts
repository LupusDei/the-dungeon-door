import { rememberPlayer, requestNarration } from '../lib/game.ts';
import { handle, originOf, readBody } from '../lib/http.ts';

/**
 * POST /api/games/{code}/narration { sceneIndex, voice? } → { sceneIndex, voice, status: "ready" | "making", voiceUrl }.
 * A scene read aloud by a narrator (a catalog narrators id; the default one when `voice` is left out): made
 * the first time a player asks for that voice, then kept. While it is "making", the file's URL arrives on the
 * scene itself (GameState.scene.voices), so the app's poll picks it up.
 */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const { playerId, code } = await rememberPlayer(request);
    const body = await readBody(request);
    return requestNarration(code, playerId, body.sceneIndex, body.voice, originOf(request));
  });
}
