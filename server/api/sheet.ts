import { previewSheet } from '../lib/characters.ts';
import { handle, readBody, requirePlayer } from '../lib/http.ts';

/** POST /api/sheet { id, name, race, characterClass, backgroundId? } → { sheet, attacks }: what a save would build. */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    requirePlayer(request);
    return previewSheet(await readBody(request));
  });
}
