import { appVersionOf } from '../lib/app-version.ts';
import { joinGame } from '../lib/game.ts';
import { gameCodeOf, handle, readBody, requirePlayer } from '../lib/http.ts';

/** POST /api/games/{code}/join { characterId } → GameState. Lobby only; re-joining swaps the character. */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const player = requirePlayer(request);
    const body = await readBody(request);
    return joinGame(gameCodeOf(request), player, body.characterId, appVersionOf(request));
  });
}
