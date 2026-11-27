import { rememberPlayer, setDungeonMaster } from '../lib/game.ts';
import { handle, readBody } from '../lib/http.ts';

/** POST /api/games/{code}/dungeon-master { dungeonMaster } → GameState. Host only, lobby only. */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const { playerId, code } = await rememberPlayer(request);
    const body = await readBody(request);
    return setDungeonMaster(code, playerId, body.dungeonMaster);
  });
}
