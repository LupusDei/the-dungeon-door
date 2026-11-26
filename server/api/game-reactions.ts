import { react } from '../lib/game.ts';
import { gameCodeOf, handle, readBody, requirePlayer } from '../lib/http.ts';

/** POST /api/games/{code}/reactions { messageId, emoji } → Message (same id, reaction toggled). */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const player = requirePlayer(request);
    const body = await readBody(request);
    return react(gameCodeOf(request), player, body.messageId, body.emoji);
  });
}
