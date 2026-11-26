import { handle, requirePlayer } from '../lib/http.ts';
import { companionsOf } from '../lib/invites.ts';

/** GET /api/companions → { companions }: the players the caller has shared a game with, most recent first. */
export async function GET(request: Request): Promise<Response> {
  return handle(async () => ({ companions: await companionsOf(requirePlayer(request)) }));
}
