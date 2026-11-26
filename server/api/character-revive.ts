import { reviveCharacter } from '../lib/characters.ts';
import { handle, readBody, requirePlayer } from '../lib/http.ts';

/** POST /api/characters/revive { characterId, payerId? } → Character: a temple's Raise Dead (2,500 gp). */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const player = requirePlayer(request);
    const body = (await readBody(request)) as { characterId?: unknown; payerId?: unknown } | null;
    return reviveCharacter(player, body?.characterId, body?.payerId);
  });
}
