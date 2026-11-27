import { leaveGame, rememberPlayer } from '../lib/game.ts';
import { handle, originOf } from '../lib/http.ts';

/** POST /api/games/{code}/leave → { ok: true }. A departing host hands over to the earliest remaining player. */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const { playerId, code } = await rememberPlayer(request);
    await leaveGame(code, playerId, originOf(request));
    return { ok: true };
  });
}
