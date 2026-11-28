import { handle, readBody, requirePlayer } from '../lib/http.ts';
import { me, nameMe } from '../lib/invites.ts';

/** GET /api/me → { playerId, name }: the caller, and the name they go by (null until they give one). */
export async function GET(request: Request): Promise<Response> {
  return handle(async () => me(requirePlayer(request)));
}

/** PUT /api/me { name } → { playerId, name }: the name the caller's companions see. "" or null clears it. */
export async function PUT(request: Request): Promise<Response> {
  return handle(async () => {
    const playerId = requirePlayer(request);
    const body = await readBody(request);
    return nameMe(playerId, body.name);
  });
}
