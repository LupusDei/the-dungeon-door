import { react, rememberPlayer } from '../lib/game.ts';
import { handle, readBody } from '../lib/http.ts';

/** POST /api/games/{code}/reactions { messageId, emoji } → Message (same id, reaction toggled). */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const { playerId, code } = await rememberPlayer(request);
    const body = await readBody(request);
    return react(code, playerId, body.messageId, body.emoji);
  });
}
