import { handle, originOf, readBody, requirePlayer } from '../lib/http.ts';
import { makePortrait } from '../lib/portrait.ts';

/** POST /api/portrait { character, previousAppearance?, note? } → { appearance, portraitUrl }. Slow. */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    requirePlayer(request);
    return makePortrait(await readBody(request), originOf(request));
  });
}
