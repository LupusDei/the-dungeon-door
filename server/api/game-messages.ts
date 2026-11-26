import { postMessage } from '../lib/game.ts';
import { gameCodeOf, handle, readBody, requirePlayer } from '../lib/http.ts';

/** POST /api/games/{code}/messages { text, voice?, replyTo? } → Message. */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const player = requirePlayer(request);
    const body = await readBody(request);
    return postMessage(gameCodeOf(request), player, body.text, { voice: body.voice, replyTo: body.replyTo });
  });
}
