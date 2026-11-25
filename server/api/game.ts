import { viewGame } from '../lib/game.ts';
import { badRequest, gameCodeOf, handle, requirePlayer } from '../lib/http.ts';

/** GET /api/games/{code}?since={messageId} → GameState (rewritten to /api/game?code=…). Polled every ~2 s. */
export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const player = requirePlayer(request);
    const sinceParam = new URL(request.url).searchParams.get('since');
    const since = sinceParam === null || sinceParam === '' ? undefined : Number(sinceParam);
    if (since !== undefined && !Number.isInteger(since)) throw badRequest('since must be a message id');
    return viewGame(gameCodeOf(request), player, since);
  });
}
