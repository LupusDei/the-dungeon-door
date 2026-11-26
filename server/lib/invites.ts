/**
 * Inviting someone to a party. There are no accounts and no friend lists: the people a player can invite are
 * their companions, the players they have shared a game with. An invitation tells the invited player's
 * devices (lib/push) and shows on their home screen until the party sets out, they join, or they decline.
 */
import { badRequest, conflict, forbidden, isUUID, notFound } from './http.ts';
import { pushInvite } from './push/notify.ts';
import { getStore } from './store/index.ts';
import type { Companion, InviteView } from './store/types.ts';

const CODE = /^[A-Z0-9]{6}$/;

/** GET /api/companions */
export async function companionsOf(playerId: string): Promise<Companion[]> {
  return getStore().listCompanions(playerId);
}

/** POST /api/games/{code}/invites { playerId }: a member of a party in its lobby invites a companion. */
export async function invite(code: string, playerId: string, to: unknown): Promise<{ ok: true; alreadyInvited: boolean }> {
  if (!isUUID(to)) throw badRequest('playerId must be a player id');
  if (to === playerId) throw badRequest('you are already here');
  const store = getStore();
  const game = CODE.test(code) ? await store.getGame(code) : null;
  if (!game) throw notFound('no such game');
  const me = game.players.find((p) => p.playerId === playerId);
  if (!me) throw forbidden('you are not in this game');
  if (game.status !== 'lobby') throw conflict('this adventure has already begun');
  if (game.players.some((p) => p.playerId === to)) throw conflict('they are already in the party');
  if (!(await store.listCompanions(playerId, 200)).some((c) => c.playerId === to)) throw forbidden('you can only invite players you have adventured with');
  const added = await store.addInvite({ code, toPlayerId: to, fromPlayerId: playerId, fromName: me.character.name, createdAt: new Date().toISOString() });
  if (added) pushInvite(code, to, me.character.name);
  return { ok: true, alreadyInvited: !added };
}

/** GET /api/invites */
export async function invitesFor(playerId: string): Promise<InviteView[]> {
  return getStore().listInvites(playerId);
}

/** DELETE /api/invites?code= */
export async function declineInvite(playerId: string, code: string): Promise<void> {
  await getStore().removeInvite(code.toUpperCase(), playerId);
}
