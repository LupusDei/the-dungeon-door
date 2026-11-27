/** The Hall of Heroes: the retired and the fallen, kept off the roster but not lost (docs/api.md, Characters). */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, test } from 'node:test';

process.env.DD_FAKE_AI = '1';
delete process.env.DATABASE_URL;
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.DD_APP_KEY;
delete process.env.DD_FAKE_DELAY_MS;

import * as reviveApi from '../api/character-revive.ts';
import * as retireApi from '../api/character-retire.ts';
import * as unretireApi from '../api/character-unretire.ts';
import * as charactersApi from '../api/characters.ts';
import * as gameApi from '../api/game.ts';
import * as gamesApi from '../api/games.ts';
import * as joinApi from '../api/game-join.ts';
import * as startApi from '../api/game-start.ts';
import * as voteApi from '../api/game-vote.ts';
import { call, gamePath, makeCharacter } from './api.fixture.ts';
import { settle } from './background.ts';
import { heroSheet } from './characters.ts';
import { fakeDungeonMaster } from './dm/fake.ts';
import { registerDungeonMaster, unregisterDungeonMaster } from './dm/registry.ts';
import { causeOf, deathIn, newlyFallen } from './fallen.ts';
import { setDice } from './game.ts';
import type { PartyState } from './play/state.ts';
import { getStore, setStore } from './store/index.ts';
import { MemoryStore } from './store/memory.ts';
import type { Character, GamePlayer, GameState } from './types.ts';

let rolls: number[] = [];
beforeEach(() => {
  setStore(new MemoryStore());
  setDice({ d20: () => rolls.shift() ?? 10, seed: () => 42 });
});
afterEach(async () => {
  await settle();
  unregisterDungeonMaster('chronicler');
  setDice();
});

type Reply = Character & { error?: string };
const list = async (player: string, status?: string) =>
  call<{ characters: Character[]; error?: string }>(charactersApi.GET, `/api/characters${status ? `?status=${status}` : ''}`, { player });
const names = async (player: string, status?: string) => (await list(player, status)).body.characters.map((c) => c.name).sort();
const retire = (player: string, characterId: unknown) => call<Reply>(retireApi.POST, '/api/characters/retire', { player, body: { characterId } });
const unretire = (player: string, characterId: unknown) => call<Reply>(unretireApi.POST, '/api/characters/unretire', { player, body: { characterId } });
const kill = async (c: Character) => {
  const stored = (await getStore().getCharacter(c.id))!;
  await getStore().saveCharacter({ ...stored, sheet: { ...c.sheet, hp: 0, dead: true } });
};

async function roster(player: string) {
  const live = await makeCharacter(player, 'Live', { race: 'human', characterClass: 'fighter' });
  const old = await makeCharacter(player, 'Old', { race: 'human', characterClass: 'rogue' });
  const ghost = await makeCharacter(player, 'Ghost', { race: 'human', characterClass: 'wizard' });
  const gone = await makeCharacter(player, 'Gone', { race: 'human', characterClass: 'cleric' });
  await kill(ghost);
  await kill(gone);
  assert.equal((await retire(player, old.id)).status, 200);
  assert.equal((await retire(player, gone.id)).status, 200);
  return { live, old, ghost, gone };
}

test('a hero comes back with retiredAt and death, both null while active and alive', async () => {
  const me = randomUUID();
  const hero = await makeCharacter(me, 'Astrid');
  assert.deepEqual([hero.retiredAt, hero.death], [null, null]);
  assert.deepEqual(((await list(me)).body.characters[0]).retiredAt, null);
});

test('GET /api/characters?status picks the active, the retired, the dead or all; left out, everyone not retired', async () => {
  const me = randomUUID();
  await roster(me);
  assert.deepEqual(await names(me, 'active'), ['Live']);
  assert.deepEqual(await names(me, 'retired'), ['Old'], 'a retired hero who is dead is among the fallen');
  assert.deepEqual(await names(me, 'dead'), ['Ghost', 'Gone']);
  assert.deepEqual(await names(me, 'all'), ['Ghost', 'Gone', 'Live', 'Old']);
  assert.deepEqual(await names(me), ['Ghost', 'Live'], 'what older apps show: the living and the fallen, not the retired');
  const bad = await list(me, 'buried');
  assert.deepEqual([bad.status, bad.body.error], [400, 'status must be "active", "retired", "dead" or "all"']);
  assert.deepEqual(await names(randomUUID(), 'all'), [], 'only your own');
});

test('retiring keeps the hero, stamped; retiring again keeps the first stamp; un-retiring brings it back', async () => {
  const me = randomUUID();
  const hero = await makeCharacter(me, 'Old', { race: 'human', characterClass: 'rogue' });
  const first = await retire(me, hero.id);
  assert.equal(first.status, 200);
  assert.ok(first.body.retiredAt && !Number.isNaN(Date.parse(first.body.retiredAt)));
  assert.equal((await retire(me, hero.id)).body.retiredAt, first.body.retiredAt);
  assert.deepEqual(await names(me, 'active'), []);
  const back = await unretire(me, hero.id);
  assert.deepEqual([back.status, back.body.retiredAt, back.body.sheet], [200, null, hero.sheet], 'back as it was');
  assert.deepEqual(await names(me, 'active'), ['Old']);
  const again = await unretire(me, hero.id);
  assert.deepEqual([again.status, again.body.error], [409, 'Old is not retired']);
});

test('the dead are not un-retired; a temple raises them, back on the roster', async () => {
  const me = randomUUID();
  const { gone } = await roster(me);
  const refused = await unretire(me, gone.id);
  assert.deepEqual([refused.status, refused.body.error], [409, 'Gone is dead: the dead are not un-retired, but a temple can raise them']);
  const stored = (await getStore().getCharacter(gone.id))!;
  await getStore().saveCharacter({ ...stored, sheet: { ...stored.sheet!, gp: 2500 }, death: { at: '2026-11-01T00:00:00Z', adventure: 'The Crypt', place: 'The Crypt', cause: 'Gone dies.', gameCode: 'ABCDEF' } });
  const raised = await call<Reply>(reviveApi.POST, '/api/characters/revive', { player: me, body: { characterId: gone.id } });
  assert.equal(raised.status, 200, JSON.stringify(raised.body));
  assert.deepEqual([raised.body.sheet.dead, raised.body.retiredAt, raised.body.death], [undefined, null, null]);
  assert.ok((await names(me, 'active')).includes('Gone'));
});

test('only the owner retires or un-retires a hero', async () => {
  const me = randomUUID();
  const stranger = randomUUID();
  const hero = await makeCharacter(me, 'Mine');
  assert.equal((await retire(stranger, hero.id)).status, 404);
  await retire(me, hero.id);
  assert.equal((await unretire(stranger, hero.id)).status, 404);
  assert.equal((await retire(me, undefined)).status, 400);
  assert.equal((await call(charactersApi.DELETE, `/api/characters?id=${hero.id}`, { player: stranger, method: 'DELETE' })).status, 403);
});

test('DELETE retires: an older app’s "Retire hero" keeps the hero for the Hall', async () => {
  const me = randomUUID();
  const hero = await makeCharacter(me, 'Kept');
  const gone = await call(charactersApi.DELETE, `/api/characters?id=${hero.id}`, { player: me, method: 'DELETE' });
  assert.deepEqual([gone.status, gone.body], [200, { ok: true }]);
  assert.deepEqual(await names(me), []);
  assert.deepEqual(await names(me, 'retired'), ['Kept']);
});

test('saving a retired or fallen hero keeps its retirement and its death', async () => {
  const me = randomUUID();
  const hero = await makeCharacter(me, 'Old');
  const { body: retired } = await retire(me, hero.id);
  const stored = (await getStore().getCharacter(hero.id))!;
  const death = { at: '2026-11-01T00:00:00Z', adventure: null, place: null, cause: null, gameCode: null };
  await getStore().saveCharacter({ ...stored, death });
  const renamed = await call<Reply>(charactersApi.PUT, '/api/characters', { player: me, method: 'PUT', body: { ...hero, name: 'Older' } });
  assert.deepEqual([renamed.body.name, renamed.body.retiredAt, renamed.body.death], ['Older', retired.retiredAt, death]);
});

test('a retired hero cannot open or join a door', async () => {
  const me = randomUUID();
  const host = randomUUID();
  const hero = await makeCharacter(me, 'Old');
  const friend = await makeCharacter(host, 'Host');
  await retire(me, hero.id);
  const open = await call<GameState & { error?: string }>(gamesApi.POST, '/api/games', { player: me, body: { characterId: hero.id } });
  assert.deepEqual([open.status, open.body.error], [409, 'Old is retired']);
  const { body: game } = await call<GameState>(gamesApi.POST, '/api/games', { player: host, body: { characterId: friend.id } });
  const join = await call<{ error?: string }>(joinApi.POST, gamePath(game.code, 'join'), { player: me, body: { characterId: hero.id } });
  assert.deepEqual([join.status, join.body.error], [409, 'Old is retired']);
});

// ---- how a hero fell ----

const bryn = heroSheet({ id: 'b', name: 'Bryn', race: 'human', characterClass: 'fighter' });
const player = (playerId: string, name: string): GamePlayer => ({
  playerId, joinedAt: '', character: { id: `c-${playerId}`, ownerId: playerId, name, race: 'human', characterClass: 'fighter', gender: 'male', temperament: 'stoic', alignment: 'neutral', backstory: '', description: '', appearance: '', portraitUrl: null, createdAt: '', updatedAt: '' },
});

test('the heroes a resolution killed: alive before, dead after; one already dead is not killed again', () => {
  const before: PartyState = { version: 1, rng: 1, sheets: { p1: bryn, p2: { ...bryn, name: 'Cleo' }, p3: { ...bryn, name: 'Dag', dead: true } } };
  const after: PartyState = { ...before, sheets: { p1: { ...bryn, hp: 0, dead: true }, p2: before.sheets.p2, p3: before.sheets.p3 } };
  const players = [player('p1', 'Bryn'), player('p2', 'Cleo'), player('p3', 'Dag')];
  assert.deepEqual(newlyFallen(before, after, players).map((p) => p.playerId), ['p1']);
  assert.deepEqual(newlyFallen(null, after, players).map((p) => p.playerId), ['p1', 'p3'], 'with nothing before, every dead hero');
});

test('the cause is the engine’s last line that says this hero died', () => {
  const lines = ['Goblin hits Bryn for 7.', 'Bryn is down.', 'Cleo dies.', 'Bryn fails a death save.', 'Bryn dies.'];
  assert.equal(causeOf('Bryn', lines), 'Bryn dies.');
  assert.equal(causeOf('Cleo', lines), 'Cleo dies.');
  assert.equal(causeOf('Dag', lines), null);
  assert.equal(causeOf('Bryn', ['Starvation (Bryn): Exhaustion 6, and dies']), 'Starvation (Bryn): Exhaustion 6, and dies');
  assert.equal(causeOf('Bryn', ['Hero 2 is dead.', 'Bryn is dead.']), 'Bryn is dead.');
});

test('a death names the adventure, the scene and the line', () => {
  const death = deathIn({ code: 'ABCDEF', title: 'The Sunken Keep' }, { title: 'The Flooded Crypt' }, 'Bryn', ['Bryn dies.'], '2026-11-27T00:00:00.000Z');
  assert.deepEqual(death, { at: '2026-11-27T00:00:00.000Z', adventure: 'The Sunken Keep', place: 'The Flooded Crypt', cause: 'Bryn dies.', gameCode: 'ABCDEF' });
  assert.deepEqual(deathIn({ code: 'ABCDEF', title: null }, null, 'Bryn', [], 'now'), { at: 'now', adventure: null, place: null, cause: null, gameCode: 'ABCDEF' });
});

test('a hero slain on an adventure goes home dead with how and where', async () => {
  registerDungeonMaster('chronicler', {
    ...fakeDungeonMaster,
    openingScene: async (ctx) => {
      const scene = await fakeDungeonMaster.openingScene(ctx);
      return { ...scene, choices: [{ label: 'Fight', detail: 'Try it.', rules: { kind: 'fight', monsters: ['tyrannosaurus-rex'] } }, ...scene.choices.slice(1)] };
    },
  });
  const host = '00000000-0000-4000-8000-000000000001';
  const hero = await makeCharacter(host, 'Hero 1', { id: '00000000-0000-4000-8001-000000000001', race: 'human', characterClass: 'wizard' });
  const { body: game } = await call<GameState>(gamesApi.POST, '/api/games', { player: host, body: { characterId: hero.id } });
  await call(startApi.POST, gamePath(game.code, 'start'), { player: host, body: { sceneCount: 8 } });
  await settle();
  let index = 0;
  let state = (await call<GameState>(gameApi.GET, gamePath(game.code), { player: host })).body;
  while (state.status === 'voting') {
    rolls = Array(60).fill(1);
    await call(voteApi.POST, gamePath(game.code, 'vote'), { player: host, body: { sceneIndex: index, choiceId: index === 0 ? 'a' : 'c' } });
    await settle();
    index++;
    state = (await call<GameState>(gameApi.GET, gamePath(game.code), { player: host })).body;
    assert.ok(index < 14, 'the fight ends');
  }
  assert.equal(state.status, 'ended');
  const home = (await list(host, 'all')).body.characters[0];
  assert.equal(home.sheet.dead, true, 'a bite past twice their hit points: dead outright');
  assert.ok(home.death, 'the slain go home with a death');
  assert.equal(home.death!.gameCode, game.code);
  assert.equal(home.death!.adventure, state.title);
  assert.ok(state.chronicle.some((c) => c.title === home.death!.place), `a scene of the adventure: ${home.death!.place}`);
  assert.match(home.death!.cause ?? '', /Hero 1.*(dies|is dead)/);
  assert.deepEqual(await names(host, 'dead'), ['Hero 1']);
  assert.deepEqual(await names(host, 'active'), []);
});
