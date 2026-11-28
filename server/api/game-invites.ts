import { rememberPlayer } from '../lib/game.ts';
import { invite } from '../lib/invites.ts';
import { handle, readBody } from '../lib/http.ts';

/** POST /api/games/{code}/invites { playerId, characterId? } → { ok, alreadyInvited }: invite a companion, and perhaps ask for one of their heroes. */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const { playerId, code } = await rememberPlayer(request);
    const body = await readBody(request);
    return invite(code, playerId, body.playerId, body.characterId ?? null);
  });
}
