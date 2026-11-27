import { deleteCharacter, listCharacters, saveCharacter } from '../lib/characters.ts';
import { handle, readBody, requirePlayer } from '../lib/http.ts';

/** GET /api/characters?status=active|retired|dead|all → { characters } (mine, newest first). */
export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const player = requirePlayer(request);
    return { characters: await listCharacters(player, new URL(request.url).searchParams.get('status')) };
  });
}

/** PUT /api/characters { Character } → Character (upsert by id, owner only). */
export async function PUT(request: Request): Promise<Response> {
  return handle(async () => {
    const player = requirePlayer(request);
    return saveCharacter(player, await readBody(request));
  });
}

/** DELETE /api/characters?id=… → { ok: true }: retires the hero (older apps' "Retire hero"). */
export async function DELETE(request: Request): Promise<Response> {
  return handle(async () => {
    const player = requirePlayer(request);
    await deleteCharacter(player, new URL(request.url).searchParams.get('id'));
    return { ok: true };
  });
}
