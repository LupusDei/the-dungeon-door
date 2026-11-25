import { leaveGame } from '../lib/game.ts';
import { gameCodeOf, handle, originOf, requirePlayer } from '../lib/http.ts';

/** POST /api/games/{code}/leave → { ok: true }. A departing host hands over to the earliest remaining player. */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const player = requirePlayer(request);
    await leaveGame(gameCodeOf(request), player, originOf(request));
    return { ok: true };
  });
}
