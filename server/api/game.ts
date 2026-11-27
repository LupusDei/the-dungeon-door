import { rememberPlayer, settleDice, viewGame } from '../lib/game.ts';
import { badRequest, handle, originOf } from '../lib/http.ts';

/** GET /api/games/{code}?since={messageId} → GameState (rewritten to /api/game?code=…). Polled every ~2 s. */
export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const { playerId, code } = await rememberPlayer(request);
    const sinceParam = new URL(request.url).searchParams.get('since');
    const since = sinceParam === null || sinceParam === '' ? undefined : Number(sinceParam);
    if (since !== undefined && !Number.isInteger(since)) throw badRequest('since must be a message id');
    await settleDice(code, originOf(request));
    return viewGame(code, playerId, since);
  });
}
