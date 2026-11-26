import { handle } from '../lib/http.ts';
import { requirePerson } from '../lib/identity.ts';

/** GET /api/quest-me — which team member this request acts as (quest key, token or session); 401 otherwise. */
export async function GET(request: Request): Promise<Response> {
  return handle(async () => Response.json({ person: await requirePerson(request) }, { headers: { 'cache-control': 'no-store' } }));
}
