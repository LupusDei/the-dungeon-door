import { HttpError } from './http.ts';
import { type Person, personForKey } from './quests.ts';

/**
 * Who is making this request? For now, sign-in is a personal quest key: one per team member, sent as
 * `Authorization: Bearer <key>` (what MCP clients do) or in the `x-quest-key` header (handy in curl).
 * Keys are checked against the hashes in QUEST_KEYS; see lib/quests.ts.
 *
 * This is deliberately simple while the board is a development tool. A stronger sign-in is planned.
 */
export function keyOf(request: Request): string | null {
  return request.headers.get('x-quest-key') ?? request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? null;
}

export const identify = (request: Request): Person | null => personForKey(keyOf(request));

/** The team member making this request, or a 401 that says how to sign in. */
export function requirePerson(request: Request): Person {
  const person = identify(request);
  if (!person) throw new HttpError(401, 'A valid quest key is needed: send it as "Authorization: Bearer <key>" or in the x-quest-key header.');
  return person;
}
