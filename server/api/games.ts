import { appVersionOf } from '../lib/app-version.ts';
import { createGame } from '../lib/game.ts';
import { handle, readBody, requirePlayer } from '../lib/http.ts';

/** POST /api/games { characterId, dungeonMaster? } → GameState. The caller hosts. */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const player = requirePlayer(request);
    const body = await readBody(request);
    return createGame(player, body.characterId, body.dungeonMaster, appVersionOf(request));
  });
}
