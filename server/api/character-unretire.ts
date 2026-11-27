import { unretireCharacter } from '../lib/characters.ts';
import { handle, readBody, requirePlayer } from '../lib/http.ts';

/** POST /api/characters/unretire { characterId } → Character: a retired, living hero back on the roster. */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const player = requirePlayer(request);
    const body = (await readBody(request)) as { characterId?: unknown } | null;
    return unretireCharacter(player, body?.characterId);
  });
}
