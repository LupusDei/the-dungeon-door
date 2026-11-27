import { retireCharacter } from '../lib/characters.ts';
import { handle, readBody, requirePlayer } from '../lib/http.ts';

/** POST /api/characters/retire { characterId } → Character: off the roster, kept for the Hall of Heroes. */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const player = requirePlayer(request);
    const body = (await readBody(request)) as { characterId?: unknown } | null;
    return retireCharacter(player, body?.characterId);
  });
}
