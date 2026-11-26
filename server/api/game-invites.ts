import { gameCodeOf, handle, readBody, requirePlayer } from '../lib/http.ts';
import { invite } from '../lib/invites.ts';

/** POST /api/games/{code}/invites { playerId } → { ok, alreadyInvited }: invite a companion to the lobby. */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const player = requirePlayer(request);
    const body = await readBody(request);
    return invite(gameCodeOf(request), player, body.playerId);
  });
}
