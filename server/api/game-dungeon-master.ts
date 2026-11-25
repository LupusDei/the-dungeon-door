import { setDungeonMaster } from '../lib/game.ts';
import { gameCodeOf, handle, readBody, requirePlayer } from '../lib/http.ts';

/** POST /api/games/{code}/dungeon-master { dungeonMaster } → GameState. Host only, lobby only. */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const player = requirePlayer(request);
    const body = await readBody(request);
    return setDungeonMaster(gameCodeOf(request), player, body.dungeonMaster);
  });
}
