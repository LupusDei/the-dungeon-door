/**
 * The people a player knows, and inviting them to a party. There are no accounts and no friend lists: the
 * people a player can invite are their companions, the players they have shared a game with.
 *
 * A companion is a person, not a hero. The hero they last played may have died or retired since, so the
 * list names the person and offers only their heroes who can go now. The name a person gives themselves
 * is their name. Another player may also give them a nickname, which is that player's alone: it is shown
 * beside the name, and stands in for it only while the person has given none. Failing both they are
 * "<that hero>'s player". An invitation is to the person, and
 * may ask for one of those heroes. It tells the invited player's devices (lib/push) and shows on their home
 * screen until the party sets out, they join, or they decline.
 */
import { canGo, upgradeCharacter } from './characters.ts';
import { badRequest, conflict, forbidden, isUUID, notFound } from './http.ts';
import { pushInvite } from './push/notify.ts';
import { getStore } from './store/index.ts';
import type { CompanionRecord } from './store/types.ts';
import type { Character } from './types.ts';

const CODE = /^[A-Z0-9]{6}$/;

/** The longest name a person may go by, or be given. */
export const NAME_MAX = 24;
/** The most heroes listed for one companion. */
export const HEROES_SHOWN = 6;

/** One of a companion's heroes who can go now. */
export interface CompanionHero { id: string; name: string; race: string; characterClass: string; level: number; portraitUrl: string | null }

/** A person the caller has played with (docs/api.md, Companion). */
export interface Companion {
  playerId: string;
  name: string;
  namedBy: 'you' | 'them' | null;
  /** The caller's own nickname for them, seen by nobody else. Null when the caller has given none. */
  nickname: string | null;
  playedAs: string;
  lastPlayedAt: string;
  heroes: CompanionHero[];
}

/** An invitation as the invited player sees it (docs/api.md, GET /api/invites). */
export interface InviteView {
  code: string;
  fromPlayerId: string;
  fromName: string;
  fromPlayerName: string | null;
  hero: { id: string; name: string } | null;
  createdAt: string;
  party: string[];
}

/** A person: the player id their app made, and the name they go by. */
export interface Person { playerId: string; name: string | null }

/** A name as given: trimmed, on one line, with single spaces. Null for none; 400 for one that will not do. */
export function personName(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw badRequest('name must be text');
  const name = value.replace(/\p{Cc}+/gu, ' ').replace(/\s+/g, ' ').trim();
  if ([...name].length > NAME_MAX) throw badRequest(`name is at most ${NAME_MAX} characters`);
  return name === '' ? null : name;
}

/** GET /api/me */
export async function me(playerId: string): Promise<Person> {
  return { playerId, name: (await getStore().getPlayerNames([playerId]))[playerId] ?? null };
}

/** PUT /api/me { name } */
export async function nameMe(playerId: string, name: unknown): Promise<Person> {
  const cleaned = personName(name);
  await getStore().setPlayerName(playerId, cleaned);
  return { playerId, name: cleaned };
}

const asHero = (c: Character): CompanionHero => ({
  id: c.id, name: c.name, race: c.race, characterClass: c.characterClass, level: c.sheet.level, portraitUrl: c.portraitUrl,
});

/** The companions as people: named, and each with the heroes who can go. */
async function asPeople(playerId: string, records: readonly CompanionRecord[]): Promise<Companion[]> {
  const store = getStore();
  const ids = records.map((r) => r.playerId);
  const [mine, theirs, heroes] = await Promise.all([store.listCompanionNames(playerId), store.getPlayerNames(ids), store.listCharactersOf(ids)]);
  const fit = heroes.map(upgradeCharacter).filter(canGo);
  return records.map((r): Companion => ({
    playerId: r.playerId,
    // Their own name is their name. A nickname stands in only while they have given none.
    name: theirs[r.playerId] ?? mine[r.playerId] ?? `${r.playedAs}'s player`,
    namedBy: theirs[r.playerId] ? 'them' : mine[r.playerId] ? 'you' : null,
    nickname: mine[r.playerId] ?? null,
    playedAs: r.playedAs,
    lastPlayedAt: r.lastPlayedAt,
    heroes: fit.filter((c) => c.ownerId === r.playerId).slice(0, HEROES_SHOWN).map(asHero),
  }));
}

/** GET /api/companions */
export async function companionsOf(playerId: string): Promise<Companion[]> {
  return asPeople(playerId, await getStore().listCompanions(playerId));
}

const isCompanion = async (playerId: string, other: string) => (await getStore().listCompanions(playerId, 200)).some((c) => c.playerId === other);

/** PUT /api/companions { playerId, name }: the caller's nickname for a companion. */
export async function nameCompanion(playerId: string, companionId: unknown, name: unknown): Promise<Companion[]> {
  if (!isUUID(companionId)) throw badRequest('playerId must be a player id');
  const cleaned = personName(name);
  if (!(await isCompanion(playerId, companionId))) throw forbidden('you can only name players you have adventured with');
  await getStore().setCompanionName(playerId, companionId, cleaned);
  return companionsOf(playerId);
}

/** The hero asked for: one of the invited player's own, alive and not retired. */
async function heroAskedFor(owner: string, characterId: unknown): Promise<Character> {
  if (!isUUID(characterId)) throw badRequest('characterId must be a character id');
  const stored = await getStore().getCharacter(characterId);
  if (!stored || stored.ownerId !== owner) throw notFound('they have no such hero');
  const hero = upgradeCharacter(stored);
  if (hero.sheet.dead) throw conflict(`${hero.name} is dead`);
  if (hero.retiredAt) throw conflict(`${hero.name} is retired`);
  return hero;
}

/** Who `player` is to `reader`: the name they gave themselves, else the reader's nickname for them. */
async function nameFor(reader: string, player: string): Promise<string | null> {
  const store = getStore();
  const [mine, theirs] = await Promise.all([store.listCompanionNames(reader), store.getPlayerNames([player])]);
  return theirs[player] ?? mine[player] ?? null;
}

/**
 * POST /api/games/{code}/invites { playerId, characterId? }: a member of a party in its lobby invites a
 * companion, and may ask for one of their heroes.
 */
export async function invite(code: string, playerId: string, to: unknown, characterId: unknown = null): Promise<{ ok: true; alreadyInvited: boolean }> {
  if (!isUUID(to)) throw badRequest('playerId must be a player id');
  if (to === playerId) throw badRequest('you are already here');
  const store = getStore();
  const game = CODE.test(code) ? await store.getGame(code) : null;
  if (!game) throw notFound('no such game');
  const host = game.players.find((p) => p.playerId === playerId);
  if (!host) throw forbidden('you are not in this game');
  if (game.status !== 'lobby') throw conflict('this adventure has already begun');
  if (game.players.some((p) => p.playerId === to)) throw conflict('they are already in the party');
  if (!(await isCompanion(playerId, to))) throw forbidden('you can only invite players you have adventured with');
  const hero = characterId === null || characterId === undefined ? null : await heroAskedFor(to, characterId);
  const added = await store.addInvite({
    code, toPlayerId: to, fromPlayerId: playerId, fromName: host.character.name, characterId: hero?.id ?? null, createdAt: new Date().toISOString(),
  });
  if (added) pushInvite(code, to, (await nameFor(to, playerId)) ?? host.character.name, hero?.name ?? null);
  return { ok: true, alreadyInvited: !added };
}

/** GET /api/invites */
export async function invitesFor(playerId: string): Promise<InviteView[]> {
  const store = getStore();
  const invites = await store.listInvites(playerId);
  if (invites.length === 0) return [];
  const from = [...new Set(invites.map((i) => i.fromPlayerId))];
  const [mine, theirs, heroes] = await Promise.all([store.listCompanionNames(playerId), store.getPlayerNames(from), store.listCharactersOf([playerId])]);
  const fit = heroes.map(upgradeCharacter).filter(canGo);
  return invites.map((i): InviteView => {
    const hero = i.characterId ? fit.find((c) => c.id === i.characterId) : undefined;
    return {
      code: i.code, fromPlayerId: i.fromPlayerId, fromName: i.fromName,
      fromPlayerName: theirs[i.fromPlayerId] ?? mine[i.fromPlayerId] ?? null,
      hero: hero ? { id: hero.id, name: hero.name } : null,
      createdAt: i.createdAt, party: i.party,
    };
  });
}

/** DELETE /api/invites?code= */
export async function declineInvite(playerId: string, code: string): Promise<void> {
  await getStore().removeInvite(code.toUpperCase(), playerId);
}
