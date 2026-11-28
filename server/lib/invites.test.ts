import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { beforeEach, test } from 'node:test';

import * as retireApi from '../api/character-retire.ts';
import * as companionsApi from '../api/companions.ts';
import * as inviteApi from '../api/game-invites.ts';
import * as joinApi from '../api/game-join.ts';
import * as gamesApi from '../api/games.ts';
import * as invitesApi from '../api/invites.ts';
import * as meApi from '../api/me.ts';
import { call, gamePath, makeCharacter } from './api.fixture.ts';
import { settle } from './background.ts';
import { type Companion, HEROES_SHOWN, type InviteView, NAME_MAX, personName } from './invites.ts';
import { getStore, setStore } from './store/index.ts';
import { MemoryStore } from './store/memory.ts';
import type { Character, GameState } from './types.ts';

beforeEach(() => setStore(new MemoryStore()));

/** Two players who have shared a game: `me` with Bryn, `them` with the heroes named (the first is the one they played). */
async function met(...theirs: string[]) {
  const me = randomUUID();
  const them = randomUUID();
  const bryn = await makeCharacter(me, 'Bryn');
  const heroes: Record<string, Character> = {};
  for (const name of theirs) heroes[name] = await makeCharacter(them, name);
  const shared = await call<GameState>(gamesApi.POST, '/api/games', { player: me, body: { characterId: bryn.id } });
  await call(joinApi.POST, gamePath(shared.body.code, 'join'), { player: them, body: { characterId: heroes[theirs[0]].id } });
  const door = (await call<GameState>(gamesApi.POST, '/api/games', { player: me, body: { characterId: bryn.id } })).body.code;
  return { me, them, bryn, heroes, door };
}

const companions = async (player: string) => (await call<{ companions: Companion[] }>(companionsApi.GET, '/api/companions', { player })).body.companions;
const invitations = async (player: string) => (await call<{ invites: InviteView[] }>(invitesApi.GET, '/api/invites', { player })).body.invites;
const fell = async (hero: Character) => {
  const stored = (await getStore().getCharacter(hero.id))!;
  await getStore().saveCharacter({ ...stored, sheet: { ...stored.sheet!, hp: 0, dead: true } });
};

test('a name is trimmed to one line of single spaces, and none is null', () => {
  assert.equal(personName('  Micah \n Martin  '), 'Micah Martin');
  assert.equal(personName('   '), null);
  assert.equal(personName(''), null);
  assert.equal(personName(null), null);
  assert.equal(personName('n'.repeat(NAME_MAX)), 'n'.repeat(NAME_MAX));
  assert.throws(() => personName('n'.repeat(NAME_MAX + 1)), /at most 24/);
  assert.throws(() => personName(7), /must be text/);
});

test('GET /api/me is unnamed until PUT names the player; "" clears it', async () => {
  const player = randomUUID();
  assert.deepEqual((await call(meApi.GET, '/api/me', { player })).body, { playerId: player, name: null });
  assert.deepEqual((await call(meApi.PUT, '/api/me', { player, method: 'PUT', body: { name: ' Justin ' } })).body, { playerId: player, name: 'Justin' });
  assert.equal((await call(meApi.GET, '/api/me', { player })).body.name, 'Justin');
  assert.equal((await call(meApi.PUT, '/api/me', { player, method: 'PUT', body: { name: 'x'.repeat(25) } })).status, 400);
  assert.equal((await call(meApi.GET, '/api/me', { player })).body.name, 'Justin', 'a refused name changes nothing');
  await call(meApi.PUT, '/api/me', { player, method: 'PUT', body: { name: '' } });
  assert.equal((await call(meApi.GET, '/api/me', { player })).body.name, null);
});

test('a companion is a person: their living heroes, never the dead or retired', async () => {
  const { me, them, heroes } = await met('Slagette', 'Brannoch', 'Ilse');
  await fell(heroes.Slagette);
  await call(retireApi.POST, '/api/characters/retire', { player: them, body: { characterId: heroes.Ilse.id } });
  const [only, ...rest] = await companions(me);
  assert.deepEqual(rest, []);
  assert.deepEqual([only.playerId, only.name, only.namedBy, only.playedAs], [them, "Slagette's player", null, 'Slagette']);
  assert.deepEqual(only.heroes.map((h) => [h.id, h.name, h.race, h.characterClass, h.level, h.portraitUrl]), [
    [heroes.Brannoch.id, 'Brannoch', 'dwarf', 'cleric', 1, heroes.Brannoch.portraitUrl],
  ]);
});

test('a companion lists at most six heroes, newest first', async () => {
  const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const { me } = await met(...names);
  const [only] = await companions(me);
  assert.equal(only.heroes.length, HEROES_SHOWN);
});

test('names: mine for them first, then theirs, and mine is mine alone', async () => {
  const { me, them } = await met('Slagette');
  await call(meApi.PUT, '/api/me', { player: them, method: 'PUT', body: { name: 'Slagyr' } });
  assert.deepEqual((await companions(me)).map((c) => [c.name, c.namedBy]), [['Slagyr', 'them']]);
  const named = await call<{ companions: Companion[] }>(companionsApi.PUT, '/api/companions', { player: me, method: 'PUT', body: { playerId: them, name: 'Micah' } });
  assert.deepEqual(named.body.companions.map((c) => [c.name, c.namedBy]), [['Micah', 'you']]);
  // They see me by my hero: my name for them is not their name for me, nor shown to them.
  assert.deepEqual((await companions(them)).map((c) => [c.name, c.namedBy]), [["Bryn's player", null]]);
  assert.equal((await call(meApi.GET, '/api/me', { player: them })).body.name, 'Slagyr');
  // A stranger is nobody's companion to name.
  const stranger = randomUUID();
  assert.equal((await call(companionsApi.PUT, '/api/companions', { player: me, method: 'PUT', body: { playerId: stranger, name: 'Who' } })).status, 403);
  assert.equal((await call(companionsApi.PUT, '/api/companions', { player: me, method: 'PUT', body: { playerId: 'nobody', name: 'Who' } })).status, 400);
  assert.equal((await call(companionsApi.PUT, '/api/companions', { player: me, method: 'PUT', body: { playerId: them, name: 'x'.repeat(25) } })).status, 400);
});

test('an invitation may ask for a hero: theirs, alive and not retired', async () => {
  const { me, them, heroes, door, bryn } = await met('Slagette', 'Brannoch', 'Ilse');
  const ask = (characterId: unknown) => call<{ alreadyInvited?: boolean; error?: string }>(inviteApi.POST, gamePath(door, 'invites'), { player: me, body: { playerId: them, characterId } });
  await fell(heroes.Slagette);
  await call(retireApi.POST, '/api/characters/retire', { player: them, body: { characterId: heroes.Ilse.id } });
  assert.deepEqual([(await ask(heroes.Slagette.id)).status, (await ask(heroes.Slagette.id)).body.error], [409, 'Slagette is dead']);
  assert.deepEqual([(await ask(heroes.Ilse.id)).status, (await ask(heroes.Ilse.id)).body.error], [409, 'Ilse is retired']);
  assert.equal((await ask(bryn.id)).status, 404, 'my own hero is not theirs to bring');
  assert.equal((await ask(randomUUID())).status, 404);
  assert.equal((await ask('brannoch')).status, 400);
  assert.deepEqual(await invitations(them), [], 'a refused invitation is not sent');
  const asked = await ask(heroes.Brannoch.id);
  assert.deepEqual([asked.status, asked.body.alreadyInvited], [200, false]);
  assert.deepEqual((await invitations(them)).map((i) => [i.code, i.fromPlayerId, i.fromName, i.fromPlayerName, i.hero]), [
    [door, me, 'Bryn', null, { id: heroes.Brannoch.id, name: 'Brannoch' }],
  ]);
  // Asking again for nobody in particular keeps the one invitation and drops the hero.
  const again = await call<{ alreadyInvited: boolean }>(inviteApi.POST, gamePath(door, 'invites'), { player: me, body: { playerId: them } });
  assert.equal(again.body.alreadyInvited, true);
  assert.deepEqual((await invitations(them)).map((i) => i.hero), [null]);
  await settle();
});

test('the invited player reads who invited them as they know them', async () => {
  const { me, them, door } = await met('Slagette');
  await call(meApi.PUT, '/api/me', { player: me, method: 'PUT', body: { name: 'Justin' } });
  await call(inviteApi.POST, gamePath(door, 'invites'), { player: me, body: { playerId: them } });
  assert.deepEqual((await invitations(them)).map((i) => [i.fromName, i.fromPlayerName]), [['Bryn', 'Justin']]);
  await call(companionsApi.PUT, '/api/companions', { player: them, method: 'PUT', body: { playerId: me, name: 'Jus' } });
  assert.deepEqual((await invitations(them)).map((i) => i.fromPlayerName), ['Jus']);
  await settle();
});
