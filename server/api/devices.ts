import { badRequest, handle, readBody, requirePlayer } from '../lib/http.ts';
import { registerDevice, unregisterDevice } from '../lib/push/notify.ts';

const orBadRequest = async (work: Promise<void>) => {
  try { await work; } catch (error) { if (error instanceof RangeError) throw badRequest(error.message); throw error; }
  return { ok: true };
};

/** POST /api/devices { token, environment } → { ok }: this device takes pushes for the caller. */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const player = requirePlayer(request);
    const body = await readBody(request);
    return orBadRequest(registerDevice(player, body.token, body.environment));
  });
}

/** DELETE /api/devices { token } → { ok }: this device takes no more pushes. */
export async function DELETE(request: Request): Promise<Response> {
  return handle(async () => {
    requirePlayer(request);
    const body = await readBody(request);
    return orBadRequest(unregisterDevice(body.token));
  });
}
