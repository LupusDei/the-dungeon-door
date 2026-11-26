import { checkAppKey, handle } from '../lib/http.ts';
import { reference } from '../lib/reference.ts';

/** GET /api/reference → the SRD 5.2 text behind the ids on a character sheet. Static; the app caches it. */
export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    checkAppKey(request);
    return reference();
  });
}
