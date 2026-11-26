import { handle, readBody } from '../lib/http.ts';
import { requirePerson } from '../lib/identity.ts';
import { board, saveMeta } from '../lib/quests.ts';

/**
 * PUT /api/quest-meta — admins reshape the board: `{ summary, milestones, areas, facts }`, any subset.
 * Lists are replaced whole and keep the order sent; an entry without an `id` is new. Tasks that
 * pointed at a removed level or workstream are kept, unassigned from it. Returns the whole board.
 */
export async function PUT(request: Request): Promise<Response> {
  return handle(async () => {
    const person = await requirePerson(request);
    await saveMeta(person, await readBody(request));
    return Response.json(await board(), { headers: { 'cache-control': 'no-store' } });
  });
}
