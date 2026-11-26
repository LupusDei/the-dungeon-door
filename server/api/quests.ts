import { addTask, board, editTask, removeTask, requirePerson } from '../lib/quests.ts';
import { badRequest, handle, readBody } from '../lib/http.ts';

/**
 * The quest log behind the website's /quest-log page (see lib/quests.ts).
 *
 *   GET    /api/quests            the whole board; public
 *   POST   /api/quests            add a task          (x-quest-key)
 *   PATCH  /api/quests?id=…       change a task       (x-quest-key)
 *   DELETE /api/quests?id=…       delete a task       (x-quest-key)
 *
 * A task: { title, area, milestone, status: todo|doing|done, owner, notes, link }.
 */
const fresh = { headers: { 'cache-control': 'no-store' } };

const idOf = (request: Request): string => {
  const id = new URL(request.url).searchParams.get('id') ?? '';
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw badRequest('id is required');
  return id;
};

export async function GET(): Promise<Response> {
  return handle(async () => Response.json(await board(), fresh));
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const person = requirePerson(request);
    return Response.json(await addTask(person, await readBody(request)), { status: 201, ...fresh });
  });
}

export async function PATCH(request: Request): Promise<Response> {
  return handle(async () => {
    const person = requirePerson(request);
    return Response.json(await editTask(person, idOf(request), await readBody(request)), fresh);
  });
}

export async function DELETE(request: Request): Promise<Response> {
  return handle(async () => {
    requirePerson(request);
    await removeTask(idOf(request));
    return Response.json({ ok: true }, fresh);
  });
}
