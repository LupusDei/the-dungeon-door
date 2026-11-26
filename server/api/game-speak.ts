import { speakInCharacter } from '../lib/game.ts';
import { gameCodeOf, handle, readBody, requirePlayer } from '../lib/http.ts';

/** POST /api/games/{code}/speak { text } → GameState. An in-character line or deed. No roll. */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const player = requirePlayer(request);
    const body = await readBody(request);
    return speakInCharacter(gameCodeOf(request), player, body.text);
  });
}
