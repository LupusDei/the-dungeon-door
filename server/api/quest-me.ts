import { handle } from '../lib/http.ts';
import { requirePerson } from '../lib/identity.ts';

/** GET /api/quest-me — which team member a quest key belongs to; 401 when it isn't valid. */
export async function GET(request: Request): Promise<Response> {
  return handle(async () => Response.json({ person: requirePerson(request) }, { headers: { 'cache-control': 'no-store' } }));
}
