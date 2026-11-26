import { handle, requirePlayer } from '../lib/http.ts';
import { declineInvite, invitesFor } from '../lib/invites.ts';

/** GET /api/invites → { invites }: the caller's invitations to parties still gathering. */
export async function GET(request: Request): Promise<Response> {
  return handle(async () => ({ invites: await invitesFor(requirePlayer(request)) }));
}

/** DELETE /api/invites?code= → { ok }: decline one. */
export async function DELETE(request: Request): Promise<Response> {
  return handle(async () => {
    const player = requirePlayer(request);
    await declineInvite(player, new URL(request.url).searchParams.get('code') ?? '');
    return { ok: true };
  });
}
