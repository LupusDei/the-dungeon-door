import { assignAbilityBoost } from '../lib/characters.ts';
import { handle, readBody, requirePlayer } from '../lib/http.ts';

/** POST /api/characters/ability-boost { characterId, boost } → Character. Places the background's increases once. */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const player = requirePlayer(request);
    const body = (await readBody(request)) as { characterId?: unknown; boost?: unknown } | null;
    return assignAbilityBoost(player, body?.characterId, body?.boost);
  });
}
