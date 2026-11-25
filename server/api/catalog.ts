import { publicCatalog } from '../lib/catalog.ts';
import { checkAppKey, handle } from '../lib/http.ts';

/** GET /api/catalog — races, classes, temperaments, genders, alignments and dungeon masters. */
export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    checkAppKey(request);
    return Response.json(publicCatalog(), { headers: { 'cache-control': 'public, max-age=300' } });
  });
}
