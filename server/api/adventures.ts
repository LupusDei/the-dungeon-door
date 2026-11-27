import { adventuresOf } from '../lib/adventures.ts';
import { handle, requirePlayer } from '../lib/http.ts';

/** GET /api/adventures[?characterId=…] → { adventures }: the caller's adventures, most recently played first. */
export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const player = requirePlayer(request);
    const characterId = new URL(request.url).searchParams.get('characterId');
    return { adventures: await adventuresOf(player, characterId) };
  });
}
