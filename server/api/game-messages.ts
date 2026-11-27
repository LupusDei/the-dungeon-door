import { postMessage, rememberPlayer } from '../lib/game.ts';
import { handle, readBody } from '../lib/http.ts';

/** POST /api/games/{code}/messages { text, voice?, replyTo? } → Message. */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const { playerId, code } = await rememberPlayer(request);
    const body = await readBody(request);
    return postMessage(code, playerId, body.text, { voice: body.voice, replyTo: body.replyTo });
  });
}
