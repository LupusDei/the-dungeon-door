import { requirePerson } from '../lib/quests.ts';
import { handle } from '../lib/http.ts';

/** GET /api/quest-me — who a quest key (`x-quest-key`) belongs to; 401 when it isn't valid. */
export async function GET(request: Request): Promise<Response> {
  return handle(async () => Response.json({ person: requirePerson(request) }, { headers: { 'cache-control': 'no-store' } }));
}
