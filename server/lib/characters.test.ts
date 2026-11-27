import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { beforeEach, test } from 'node:test';
import * as catalogApi from '../api/catalog.ts';
import * as reviveApi from '../api/character-revive.ts';
import * as charactersApi from '../api/characters.ts';
import * as sheetApi from '../api/sheet.ts';
import * as gamesApi from '../api/games.ts';
import { call, makeCharacter } from './api.fixture.ts';
import * as boostApi from '../api/character-ability-boost.ts';
import { heroSheet, upgradeCharacter } from './characters.ts';
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

const greater = (sheet: Character['sheet']) => sheet.equipment.filter((e) => e.id === 'potion-of-greater-healing');

test('a new hero is forged with one Potion of Greater Healing; a saved hero is left as it is', async () => {
  const me = randomUUID();
  const hero = await makeCharacter(me, 'Dara', { characterClass: 'wizard' });
  assert.deepEqual(greater(hero.sheet), [{ id: 'potion-of-greater-healing', name: 'Potion of Greater Healing', count: 1 }]);
  const preview = await call<{ sheet: Character['sheet'] }>(sheetApi.POST, '/api/sheet', { player: me, method: 'POST', body: { id: randomUUID(), name: 'Eli', race: 'human', characterClass: 'fighter' } });
  assert.equal(greater(preview.body.sheet).length, 1, 'the forge shows it');
  assert.equal(greater((await put(me, { ...hero, characterClass: 'rogue' })).body.sheet).length, 1, 'rebuilt in the forge (level 1): still forged with it');
  const stored = await getStore().getCharacter(hero.id);
  const without = { ...stored!.sheet!, equipment: stored!.sheet!.equipment.filter((e) => e.id !== 'potion-of-greater-healing') };
  await getStore().saveCharacter({ ...stored!, sheet: without });
  assert.deepEqual(greater((await put(me, { ...hero, characterClass: 'rogue', name: 'Dara the Bold' })).body.sheet), [], 'a saved hero gets none');
  assert.deepEqual(greater(heroSheet({ id: randomUUID(), name: 'x', race: 'human', characterClass: 'fighter' })), [], 'the engine sheet itself is unchanged');
  const { sheet: _, ...old } = { ...hero, sheet: undefined };
  assert.deepEqual(greater(upgradeCharacter(old as never).sheet), [], 'a hero stored before sheets gets none on read');
});

test('a saved hero\u2019s sheet reads with its passive Perception as it stands: exhaustion off, like any d20 test (q-mwxaavkv)', async () => {
  const me = randomUUID();
  const hero = await makeCharacter(me, 'Fen');
  const stored = await getStore().getCharacter(hero.id);
  await getStore().saveCharacter({ ...stored!, sheet: { ...stored!.sheet!, exhaustion: 2 } });
  const [read] = await mine(me);
  assert.deepEqual([read.sheet.passivePerception, read.sheet.speed], [hero.sheet.passivePerception - 4, hero.sheet.speed]);
});

test('the seed is pinned: a hero not yet saved with a sheet keeps the same numbers on every read and every release', () => {
  const build = { id: 'pinned-hero', name: 'Pin', race: 'human', characterClass: 'fighter' };
  const sheet = heroSheet(build, 'classic');
  assert.deepEqual([sheet.backgroundId, sheet.abilityScores], PINNED);
  const stored = { ...build, gender: 'male', temperament: 'kind', alignment: 'true-neutral', backstory: '', description: '', appearance: null, portraitUrl: null, createdAt: '', updatedAt: '' };
  assert.deepEqual(upgradeCharacter(stored as Parameters<typeof upgradeCharacter>[0]).sheet, sheet, 'a stored hero without a sheet reads the classic way');
  const fresh = heroSheet(build);
  assert.equal(Math.max(...Object.values(fresh.abilityScores)), fresh.abilityScores.str, 'a new fighter’s best score is Strength');
});

const SOLDIER = { kind: 'twoOne' as const, plusTwo: 'con' as const, plusOne: 'str' as const };

test('the player places the background\'s +2 and +1; leaving them out lets the forge place them', async () => {
  const me = randomUUID();
  const id = randomUUID();
  const look = { gender: 'female', temperament: 'brave', alignment: 'true-neutral', backstory: '', description: '' };
  const build = { id, name: 'Slykat', race: 'human', characterClass: 'fighter', backgroundId: 'soldier', ...look };
  const preview = await call(sheetApi.POST, '/api/sheet', { player: me, body: { ...build, boost: SOLDIER } });
  const saved = await put(me, { ...build, boost: SOLDIER });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual(saved.body.sheet.abilityBoost, SOLDIER);
  assert.equal(saved.body.bonusesOpen, false);
  assert.deepEqual(saved.body.sheet, preview.body.sheet, 'the preview is the hero that gets saved');
  const auto = await call(sheetApi.POST, '/api/sheet', { player: me, body: build });
  assert.equal(auto.body.sheet.abilityBoost, undefined, 'no choice: the forge places +2 and +1 and does not record it');
  assert.equal(saved.body.sheet.abilityScores.con, auto.body.sheet.abilityScores.con + 1, 'the player\'s +2 to Constitution, not the forge\'s +1');
  assert.equal(saved.body.sheet.abilityScores.str, auto.body.sheet.abilityScores.str - 1);
  assert.equal(saved.body.sheet.abilityScores.dex, auto.body.sheet.abilityScores.dex);
  assert.deepEqual(saved.body.sheet.skills, auto.body.sheet.skills, 'the increase does not reshuffle skills');
  assert.equal(saved.body.sheet.maxHp, auto.body.sheet.maxHp + 1, 'Constitution 15 (+2) becomes 16 (+3)');
  const spread = { kind: 'oneOneOne' };
  const again = await put(me, { ...saved.body, backgroundId: 'soldier', boost: spread });
  assert.equal(again.body.sheet.abilityScores.str, saved.body.sheet.abilityScores.str);
  assert.equal(again.body.sheet.abilityScores.dex, saved.body.sheet.abilityScores.dex + 1);
  assert.equal(again.body.sheet.abilityScores.con, saved.body.sheet.abilityScores.con - 1);
  assert.deepEqual(again.body.sheet.equipment, saved.body.sheet.equipment, 'moving the bonuses keeps the pack');
  assert.deepEqual(again.body.sheet.abilityBoost, spread);
});

test('a background increase the rules forbid is refused', async () => {
  const me = randomUUID();
  const body = { id: randomUUID(), name: 'Slykat', race: 'human', characterClass: 'fighter', gender: 'female', temperament: 'brave', alignment: 'true-neutral', backgroundId: 'soldier' };
  const bad = async (boost: unknown) => {
    const res = await put(me, { ...body, id: randomUUID(), boost });
    return [res.status, res.body.error];
  };
  assert.deepEqual(await bad({ kind: 'twoOne', plusTwo: 'int', plusOne: 'str' }), [400, 'int is not one of this background\'s abilities (str, dex, con)']);
  assert.deepEqual(await bad({ kind: 'twoOne', plusTwo: 'str', plusOne: 'str' }), [400, 'the +2 and +1 go to two different abilities']);
  assert.equal((await bad({ kind: 'plusThree' }))[0], 400);
  const preview = await call(sheetApi.POST, '/api/sheet', { player: me, body: { ...body, boost: { kind: 'twoOne', plusTwo: 'cha', plusOne: 'str' } } });
  assert.equal(preview.status, 400);
  assert.match(preview.body.error, /cha is not one of/);
});

test('a hero the forge built can place the bonuses once, and not after the scores have changed', async () => {
  const me = randomUUID();
  const hero = await makeCharacter(me, 'Slykat', { race: 'human', characterClass: 'fighter', backgroundId: 'soldier' });
  assert.equal(hero.bonusesOpen, true);
  assert.equal(hero.sheet.abilityBoost, undefined);
  const place = (body: unknown, who = me) => call<Character & { error?: string }>(boostApi.POST, '/api/characters/ability-boost', { player: who, body });
  const moved = await place({ characterId: hero.id, boost: SOLDIER });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.equal(moved.body.bonusesOpen, false);
  assert.deepEqual(moved.body.sheet.abilityBoost, SOLDIER);
  assert.equal(moved.body.sheet.abilityScores.con, hero.sheet.abilityScores.con + 1);
  assert.equal(moved.body.sheet.abilityScores.str, hero.sheet.abilityScores.str - 1);
  assert.deepEqual(moved.body.sheet.equipment, hero.sheet.equipment);
  assert.equal(moved.body.sheet.xp, hero.sheet.xp);
  const twice = await place({ characterId: hero.id, boost: { kind: 'oneOneOne' } });
  assert.deepEqual([twice.status, twice.body.error], [409, 'the ability bonuses are already chosen']);
  const other = await makeCharacter(me, 'Pip', { race: 'human', characterClass: 'fighter', backgroundId: 'soldier' });
  const stored = (await getStore().getCharacter(other.id))!;
  await getStore().saveCharacter({ ...stored, sheet: { ...stored.sheet!, abilityScores: { ...stored.sheet!.abilityScores, str: stored.sheet!.abilityScores.str + 1 } } });
  const drifted = await place({ characterId: other.id, boost: SOLDIER });
  assert.deepEqual([drifted.status, drifted.body.error], [409, 'these scores are no longer the ones the forge assigned, so the bonuses cannot be placed']);
  const higher = await makeCharacter(me, 'Old', { race: 'human', characterClass: 'fighter', backgroundId: 'soldier' });
  const kept = (await getStore().getCharacter(higher.id))!;
  await getStore().saveCharacter({ ...kept, sheet: { ...kept.sheet!, level: 2, xp: 300, hpRolls: [...kept.sheet!.hpRolls, 6] } });
  const leveled = await place({ characterId: higher.id, boost: { kind: 'oneOneOne' } });
  assert.equal(leveled.status, 200, 'no improvement yet: the forge\'s scores can still be replaced');
  assert.equal(leveled.body.sheet.level, 2);
  assert.equal((await place({ characterId: hero.id, boost: SOLDIER }, randomUUID())).status, 404);
  assert.equal((await place({ boost: SOLDIER })).status, 400);
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
