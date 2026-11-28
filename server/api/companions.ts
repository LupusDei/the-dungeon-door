import { handle, readBody, requirePlayer } from '../lib/http.ts';
import { companionsOf, nameCompanion } from '../lib/invites.ts';

/** GET /api/companions → { companions }: the people the caller has shared a game with, most recent first. */
export async function GET(request: Request): Promise<Response> {
  return handle(async () => ({ companions: await companionsOf(requirePlayer(request)) }));
}

/** PUT /api/companions { playerId, name } → { companions }: the caller's nickname for one of them. */
export async function PUT(request: Request): Promise<Response> {
  return handle(async () => {
    const playerId = requirePlayer(request);
    const body = await readBody(request);
    return { companions: await nameCompanion(playerId, body.playerId, body.name) };
  });
}
