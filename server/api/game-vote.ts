import { castVote } from '../lib/game.ts';
import { gameCodeOf, handle, originOf, readBody, requirePlayer } from '../lib/http.ts';

/** POST /api/games/{code}/vote { sceneIndex, choiceId } → GameState. Resolves the scene once everyone has voted. */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const player = requirePlayer(request);
    const body = await readBody(request);
    return castVote(gameCodeOf(request), player, body.sceneIndex, body.choiceId, originOf(request));
  });
}
