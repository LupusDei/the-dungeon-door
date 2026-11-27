import { rememberPlayer, setTyping } from '../lib/game.ts';
import { handle, readBody } from '../lib/http.ts';

/** POST /api/games/{code}/typing { typing? } → { ok: true }. */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const { playerId, code } = await rememberPlayer(request);
    const body = await readBody(request);
    return setTyping(code, playerId, body.typing);
  });
}
