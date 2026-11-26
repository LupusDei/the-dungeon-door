import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { beforeEach, test } from 'node:test';
import * as catalogApi from '../api/catalog.ts';
import * as reviveApi from '../api/character-revive.ts';
import * as charactersApi from '../api/characters.ts';
import * as gamesApi from '../api/games.ts';
import { call, makeCharacter } from './api.fixture.ts';
import { heroSheet } from './characters.ts';
import { srd } from './rules/srd.ts';
import { getStore, setStore } from './store/index.ts';
import { MemoryStore } from './store/memory.ts';
import type { Character, GameState } from './types.ts';

delete process.env.DATABASE_URL;
delete process.env.DD_APP_KEY;
beforeEach(() => setStore(new MemoryStore()));

const PINNED = ['soldier', { str: 15, dex: 12, con: 15, int: 13, wis: 12, cha: 8 }];

const put = (player: string, body: unknown) => call<Character & { error?: string }>(charactersApi.PUT, '/api/characters', { player, method: 'PUT', body });
const mine = async (player: string) => (await call<{ characters: Character[] }>(charactersApi.GET, '/api/characters', { player })).body.characters;

test('a new hero gets a level-1 SRD 5.2 sheet of its species and class, the same every time for its id', async () => {
  const me = randomUUID();
  const hero = await makeCharacter(me, 'Astrid', { race: 'goliath', characterClass: 'barbarian' });
  const { sheet } = hero;
  assert.deepEqual([sheet.version, sheet.name, sheet.level, sheet.xp, sheet.speciesId, sheet.classId], [1, 'Astrid', 1, 0, 'goliath', 'barbarian']);
  assert.ok(srd().backgrounds.has(sheet.backgroundId));
  assert.equal(sheet.hp, sheet.maxHp);
  await call(charactersApi.DELETE, `/api/characters?id=${hero.id}`, { player: me, method: 'DELETE' });
  const again = await put(me, { ...hero, sheet: undefined });
  assert.deepEqual(again.body.sheet, sheet);
});

test('the seed is pinned: a hero not yet saved with a sheet keeps the same numbers on every read and every release', () => {
  const sheet = heroSheet({ id: 'pinned-hero', name: 'Pin', race: 'human', characterClass: 'fighter' });
  assert.deepEqual([sheet.backgroundId, sheet.abilityScores], PINNED);
});

test('the player may pick the background; an unknown one is refused', async () => {
  const me = randomUUID();
  assert.equal((await makeCharacter(me, 'Sage', { backgroundId: 'sage' })).sheet.backgroundId, 'sage');
  const bad = await put(me, { id: randomUUID(), name: 'X', race: 'elf', characterClass: 'wizard', gender: 'female', temperament: 'kind', alignment: 'true-neutral', backgroundId: 'pirate' });
  assert.deepEqual([bad.status, bad.body.error], [400, 'backgroundId: unknown background']);
});

test('saving again keeps the sheet; a rename renames it; a sheet the app sends is ignored', async () => {
  const me = randomUUID();
  const hero = await makeCharacter(me, 'Borin');
  const stored = await getStore().getCharacter(hero.id);
  await getStore().saveCharacter({ ...stored!, sheet: { ...stored!.sheet!, hp: 3, xp: 50 } });
  const saved = await put(me, { ...hero, name: 'Borin Ironfoot', sheet: { ...hero.sheet, maxHp: 999 } });
  assert.deepEqual([saved.body.sheet.hp, saved.body.sheet.xp, saved.body.sheet.maxHp, saved.body.sheet.name], [3, 50, hero.sheet.maxHp, 'Borin Ironfoot']);
  const sage = await makeCharacter(me, 'Sage', { backgroundId: 'sage' });
  const kept = await getStore().getCharacter(sage.id);
  await getStore().saveCharacter({ ...kept!, sheet: { ...kept!.sheet!, level: 2 } });
  const resaved = await put(me, { ...sage, backgroundId: undefined });
  assert.deepEqual([resaved.status, resaved.body.sheet.backgroundId], [200, 'sage'], 'leaving the background out keeps it');
});

test('changing race, class or background rebuilds the sheet at level 1, and is refused once levelled', async () => {
  const me = randomUUID();
  const hero = await makeCharacter(me, 'Cyra', { characterClass: 'fighter' });
  const wizard = await put(me, { ...hero, characterClass: 'wizard' });
  assert.equal(wizard.body.sheet.classId, 'wizard');
  assert.notEqual(wizard.body.sheet.spellcasting, null);
  assert.equal((await put(me, { ...hero, race: 'elf' })).body.sheet.speciesId, 'elf');
  const other = [...srd().backgrounds.keys()].find((id) => id !== wizard.body.sheet.backgroundId);
  assert.equal((await put(me, { ...hero, characterClass: 'wizard', race: 'elf', backgroundId: other })).body.sheet.backgroundId, other);
  const third = [...srd().backgrounds.keys()].find((id) => id !== other)!;
  assert.equal((await put(me, { ...hero, characterClass: 'wizard', race: 'elf', backgroundId: third })).body.sheet.backgroundId, third, 'the background alone');
  const stored = await getStore().getCharacter(hero.id);
  await getStore().saveCharacter({ ...stored!, sheet: { ...stored!.sheet!, level: 2 } });
  const refused = await put(me, { ...hero, characterClass: 'rogue' });
  assert.deepEqual([refused.status, refused.body.error], [400, 'a hero above level 1 cannot change race, class or background']);
  assert.equal((await put(me, { ...hero, race: 'elf', characterClass: 'wizard', backgroundId: third, name: 'Cyra II' })).status, 200, 'unchanged build: fine');
});

test('heroes saved before the rules engine load upgraded: half-orc becomes orc, half-elf elf, and they get a sheet', async () => {
  const me = randomUUID();
  const now = new Date().toISOString();
  const legacy = (id: string, race: string) => ({
    id, ownerId: me, name: `Old ${race}`, race, characterClass: 'rogue', gender: 'male', temperament: 'cunning', alignment: 'chaotic-neutral',
    backstory: '', description: '', appearance: null, portraitUrl: null, createdAt: now, updatedAt: now,
  }) as unknown as Character;
  await getStore().saveCharacter(legacy('a', 'half-orc'));
  await getStore().saveCharacter(legacy('b', 'half-elf'));
  const heroes = await mine(me);
  assert.deepEqual(heroes.map((h) => [h.race, h.sheet.speciesId, h.sheet.classId]).sort(), [['elf', 'elf', 'rogue'], ['orc', 'orc', 'rogue']]);
  const game = await call<GameState>(gamesApi.POST, '/api/games', { player: me, body: { characterId: 'a' } });
  assert.equal(game.body.players[0].character.sheet!.speciesId, 'orc', 'a game gets the upgraded hero');
  const blank = await call(gamesApi.POST, '/api/games', { player: me, body: { characterId: '' } });
  assert.deepEqual([blank.status, blank.body.error], [400, 'characterId is required']);
});

test('the old race ids are still accepted on save, as their SRD 5.2 species', async () => {
  const me = randomUUID();
  assert.equal((await makeCharacter(me, 'Grok', { race: 'half-orc' })).race, 'orc');
  assert.equal((await makeCharacter(me, 'Lia', { race: 'half-elf' })).sheet.speciesId, 'elf');
});

test('the catalog lists the SRD 5.2 backgrounds', async () => {
  const { body } = await call(catalogApi.GET, '/api/catalog');
  assert.deepEqual(body.backgrounds.map((b: { id: string; name: string }) => ({ id: b.id, name: b.name })), [...srd().backgrounds.values()].map((b) => ({ id: b.id, name: b.name })));
});

test('between adventures a dead hero can buy a temple’s Raise Dead (2,500 gp): from its own purse or a friend’s', async () => {
  const player = randomUUID();
  const fallen = await makeCharacter(player, 'Fallen', { race: 'human', characterClass: 'fighter' });
  const friend = await makeCharacter(player, 'Friend', { race: 'human', characterClass: 'rogue' });
  const setSheet = async (c: Character, patch: Partial<Character['sheet']>) => {
    const stored = (await getStore().getCharacter(c.id))!;
    await getStore().saveCharacter({ ...stored, sheet: { ...c.sheet, ...patch } });
  };
  const revive = (body: unknown, who = player) => call<Character & { error?: string }>(reviveApi.POST, '/api/characters/revive', { player: who, body });
  assert.deepEqual([(await revive({ characterId: fallen.id })).status, (await revive({ characterId: fallen.id })).body.error], [409, 'Fallen is not dead']);
  await setSheet(fallen, { hp: 0, dead: true, gp: 2499 });
  const poor = await revive({ characterId: fallen.id });
  assert.deepEqual([poor.status, poor.body.error], [409, 'the temple asks 2500 gp; Fallen has 2499']);
  await setSheet(fallen, { hp: 0, dead: true, gp: 2600 });
  const own = await revive({ characterId: fallen.id, payerId: fallen.id });
  assert.equal(own.status, 200);
  assert.deepEqual([own.body.sheet.dead, own.body.sheet.hp, own.body.sheet.gp, own.body.sheet.revivalPenalty], [undefined, 1, 100, 4]);
  assert.deepEqual((await mine(player)).find((c) => c.id === fallen.id)!.sheet.gp, 100, 'saved');
  await setSheet(fallen, { hp: 0, dead: true, gp: 0 });
  await setSheet(friend, { gp: 2500 });
  const helped = await revive({ characterId: fallen.id, payerId: friend.id });
  assert.deepEqual([helped.status, helped.body.sheet.hp, helped.body.sheet.gp], [200, 1, 0]);
  assert.equal((await mine(player)).find((c) => c.id === friend.id)!.sheet.gp, 0, 'the friend paid it all: exactly enough will do');
  await setSheet(fallen, { hp: 0, dead: true, gp: 0 });
  await setSheet(friend, { hp: 0, dead: true, gp: 3000 });
  const ghost = await revive({ characterId: fallen.id, payerId: friend.id });
  assert.deepEqual([ghost.status, ghost.body.error], [409, 'Friend is dead']);
  assert.equal((await revive({ characterId: fallen.id }, randomUUID())).status, 404, 'only your own heroes');
  assert.equal((await revive({ characterId: fallen.id, payerId: null })).body.error, 'the temple asks 2500 gp; Fallen has 0');
  const stranger = await makeCharacter(randomUUID(), 'Stranger', { race: 'human', characterClass: 'rogue' });
  assert.equal((await revive({ characterId: fallen.id, payerId: stranger.id })).status, 404, 'nor someone else’s purse');
});
