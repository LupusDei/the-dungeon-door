import assert from 'node:assert/strict';
import test from 'node:test';
import { addItem } from './inventory.ts';
import { generateDungeon } from './dungeon.ts';
import { startExplore } from './explore.ts';
import { areaLight, bestLight, clockLabel, darkvision, kindle, LIGHTS, outdoorLight, seeingIn, sightOf } from './light.ts';
import { SAMPLE } from './sheet.fixture.ts';

const human = { ...SAMPLE, speciesId: 'human', traits: [] };

test('SRD 5.2 light sources: how long they burn, how far they shine, what they use up', () => {
  assert.deepEqual(LIGHTS.torch, { name: 'Torch', burns: 3600, bright: 20, dim: 20, holds: null, uses: 'torch' });
  assert.deepEqual(LIGHTS.candle, { name: 'Candle', burns: 3600, bright: 5, dim: 5, holds: null, uses: 'candle' });
  assert.deepEqual(LIGHTS.lamp, { name: 'Lamp', burns: 6 * 3600, bright: 15, dim: 30, holds: 'lamp', uses: 'oil' });
  assert.deepEqual(LIGHTS['lantern-hooded'], { name: 'Hooded Lantern', burns: 6 * 3600, bright: 30, dim: 30, holds: 'lantern-hooded', uses: 'oil' });
  assert.deepEqual(LIGHTS['lantern-bullseye'], { name: 'Bullseye Lantern', burns: 6 * 3600, bright: 60, dim: 60, holds: 'lantern-bullseye', uses: 'oil' });
  assert.deepEqual(LIGHTS['light-spell'], { name: 'Light', burns: 3600, bright: 20, dim: 20, holds: null, uses: null });
});

test('the best light a hero can make: the Light cantrip first (it costs nothing), then lanterns, a lamp, a torch, a candle', () => {
  assert.equal(bestLight(human), null);
  assert.equal(bestLight(addItem(human, 'candle')), 'candle');
  assert.equal(bestLight(addItem(addItem(human, 'candle'), 'torch')), 'torch');
  assert.equal(bestLight(addItem(human, 'lamp')), null, 'a lamp without oil gives no light');
  assert.equal(bestLight(addItem(addItem(addItem(human, 'torch'), 'lamp'), 'oil')), 'lamp');
  assert.equal(bestLight(addItem(addItem(addItem(human, 'lamp'), 'lantern-hooded'), 'oil')), 'lantern-hooded');
  assert.equal(bestLight(addItem(addItem(human, 'lantern-bullseye'), 'oil')), 'lantern-bullseye');
  const caster = { ...human, spellcasting: { ability: 'int' as const, saveDc: 13, attackBonus: 5, slots: [2, 0, 0, 0, 0, 0, 0, 0, 0], cantrips: ['light'], prepared: [], expended: [0, 0, 0, 0, 0, 0, 0, 0, 0], concentratingOn: null } };
  assert.equal(bestLight(addItem(caster, 'torch')), 'light-spell');
});

test('lighting uses up the torch or candle, or a flask of oil; the lamp and the spell stay', () => {
  const lit = kindle(addItem(addItem(human, 'torch'), 'torch'), 'torch');
  assert.equal(lit.equipment.find((e) => e.id === 'torch')!.count, 1);
  const lamp = kindle(addItem(addItem(human, 'lamp'), 'oil'), 'lamp');
  assert.deepEqual(lamp.equipment.map((e) => e.id), ['chain-mail', 'lamp']);
  assert.deepEqual(kindle(human, 'light-spell'), human);
});

test('darkvision comes from the species trait', () => {
  assert.equal(darkvision(human), 0);
  assert.equal(darkvision({ ...human, traits: ['darkvision-60'] }), 60);
  assert.equal(darkvision({ ...human, traits: ['darkvision-120', 'stonecunning'] }), 120);
});

test('5.2 sight: darkvision sees dim light as bright and darkness as dim; without it darkness is blindness', () => {
  assert.deepEqual(['bright', 'dim', 'dark'].map((l) => seeingIn(l as 'bright', 0)), ['clear', 'dim', 'none']);
  assert.deepEqual(['bright', 'dim', 'dark'].map((l) => seeingIn(l as 'bright', 60)), ['clear', 'clear', 'dim']);
  assert.equal(sightOf({ ...human, traits: ['darkvision-60'] }, 'dark'), 'dim');
  assert.equal(sightOf(human, 'dark'), 'none');
});

test('the clock reads from the start of the adventure, 8 in the morning of day 1', () => {
  assert.equal(clockLabel(0), 'Day 1, 08:00');
  assert.equal(clockLabel(40 * 60 + 59), 'Day 1, 08:40');
  assert.equal(clockLabel(16 * 3600), 'Day 2, 00:00');
  assert.equal(clockLabel(15 * 3600 + 3540), 'Day 1, 23:59');
});

test('outdoors: daylight from 6 to 19, twilight the hour either side, dark at night (5.2: even most moonlit nights)', () => {
  const at = (h: number) => outdoorLight((h - 8) * 3600 + 24 * 3600);
  assert.deepEqual([4, 5, 6, 12, 18, 19, 20, 23].map(at), ['dark', 'dim', 'bright', 'bright', 'bright', 'dim', 'dark', 'dark']);
});

test('the light in a dungeon area (original table): the entrance dim, rooms 1 in 6 lit and 1 in 6 dim, the rest dark, the same for the same seed', () => {
  const map = generateDungeon(7, 'delve', [3]);
  assert.equal(areaLight(map, 'r0'), 'dim');
  const levels = Array.from({ length: 300 }, (_, seed) => generateDungeon(seed, 'delve', [3])).flatMap((m) => Object.keys(m.nodes).filter((id) => id !== 'r0').map((id) => areaLight(m, id)));
  const share = (l: string) => levels.filter((x) => x === l).length / levels.length;
  assert.ok(Math.abs(share('bright') - 1 / 6) < 0.04 && Math.abs(share('dim') - 1 / 6) < 0.04, `${share('bright')} ${share('dim')}`);
  assert.deepEqual(Object.keys(map.nodes).map((id) => areaLight(map, id)), Object.keys(map.nodes).map((id) => areaLight(generateDungeon(7, 'delve', [3]), id)));
  const explore = startExplore(3, [1]);
  assert.equal(areaLight(explore, 'e'), 'dim');
  assert.equal(areaLight({ ...explore, nodes: { ...explore.nodes, p: { ...explore.nodes.e, id: 'p', type: 'passage' } } }, 'p'), 'dark', 'passages are dark');
});
