import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addItem, buy, held, load, removeItem, sell, unpacked, useItem } from './inventory.ts';
import { scriptedRng } from './rng.ts';
import { SAMPLE } from './sheet.fixture.ts';

const bryn = { ...SAMPLE, gp: 100, equipment: [{ id: 'chain-mail', name: 'Chain Mail', count: 1 }] };

test('5.2 carrying capacity: Strength × 15 lb for a Medium hero; coins weigh 1 lb per 50', () => {
  assert.deepEqual(load(bryn), { carried: 57, capacity: 255, dragLimit: 510, dragging: false });
  assert.deepEqual(load({ ...bryn, size: 'Tiny' }).capacity, 127.5);
  assert.deepEqual(load({ ...bryn, size: 'Large' }).capacity, 510);
  assert.equal(load({ ...bryn, equipment: [{ id: 'mystery-box', name: 'Mystery Box', count: 3 }], gp: 0 }).carried, 0, 'an item the SRD does not list weighs nothing');
});

test('over capacity a hero is dragging (Speed 5 ft); past twice capacity they cannot take more', () => {
  const heavy = addItem(bryn, 'plate-armor', 4);
  assert.deepEqual([load(heavy).carried, load(heavy).dragging], [317, true]);
  assert.throws(() => addItem(heavy, 'plate-armor', 4), /too heavy for Bryn/);
});

test('items stack by id, with the SRD name', () => {
  const more = addItem(addItem(bryn, 'torch'), 'torch', 2);
  assert.deepEqual(more.equipment.at(-1), { id: 'torch', name: 'Torch', count: 3 });
  assert.deepEqual(removeItem(more, 'torch', 3).equipment, bryn.equipment);
  assert.deepEqual(removeItem(more, 'torch').equipment.at(-1), { id: 'torch', name: 'Torch', count: 2 });
  assert.throws(() => removeItem(more, 'torch', 4), /Bryn does not have 4 Torch/);
  assert.throws(() => removeItem(bryn, 'rope'), /Bryn does not have 1 Rope/);
});

test('buying at SRD prices; selling at half (treasure at full value)', () => {
  const bought = buy(bryn, 'longsword', 2);
  assert.deepEqual([bought.gp, bought.equipment.at(-1)], [70, { id: 'longsword', name: 'Longsword', count: 2 }]);
  assert.throws(() => buy(bryn, 'plate-armor'), /Bryn cannot afford Plate Armor \(1500 GP\)/);
  assert.throws(() => buy(bryn, 'potions-of-healing'), /Potions of Healing is not for sale/);
  assert.equal(sell(bought, 'longsword').gp, 77.5);
  assert.equal(buy(bryn, 'candle', 3).gp, 99.97);
  const rich = sell(addItem(bryn, 'gemstone', 2), 'gemstone', 2);
  assert.deepEqual([rich.gp, rich.equipment], [200, bryn.equipment]);
  assert.throws(() => sell(bryn, 'longsword'), /does not have/);
});

test('drinking a Potion of Healing: 2d4 + 2 HP, never above the maximum; the potion is used up', () => {
  const hurt = addItem({ ...bryn, hp: 2 }, 'potion-of-healing', 2);
  const { sheet, healed } = useItem(scriptedRng([1, 3]), hurt, 'potion-of-healing');
  assert.deepEqual([healed, sheet.hp, sheet.equipment.at(-1)!.count], [6, 8, 1]);
  const full = useItem(scriptedRng(Array(10).fill(1)), addItem({ ...bryn, hp: 10 }, 'potion-of-supreme-healing'), 'potion-of-supreme-healing');
  assert.deepEqual([full.healed, full.sheet.hp], [3, 13]);
  assert.throws(() => useItem(scriptedRng([]), addItem(bryn, 'torch'), 'torch'), /Torch cannot be used that way/);
  assert.throws(() => useItem(scriptedRng([]), bryn, 'potion-of-healing'), /does not have/);
  assert.throws(() => useItem(scriptedRng([]), addItem({ ...bryn, dead: true }, 'potion-of-healing'), 'potion-of-healing'), /Bryn is dead/);
});

test('the limits are inclusive: exactly at capacity is not dragging, exactly at the drag limit can still be carried', () => {
  const weak = { ...bryn, abilityScores: { ...bryn.abilityScores, str: 10 }, gp: 0, equipment: [] };
  assert.equal(load(addItem(weak, 'torch', 150)).dragging, false);
  assert.equal(load(addItem(weak, 'torch', 151)).dragging, true);
  assert.equal(load(addItem(weak, 'torch', 300)).carried, 300);
  assert.throws(() => addItem(weak, 'torch', 301), /too heavy/);
});

test('the price is the cost times the count, and exactly enough coin is enough', () => {
  assert.throws(() => buy(bryn, 'battleaxe', 11), /cannot afford Battleaxe \(110 GP\)/);
  assert.equal(buy(bryn, 'battleaxe', 10).gp, 0);
});

test('a pack is opened: its contents stacked in its place, with what the hero already had; no pack, the same sheet', () => {
  const packed = { ...SAMPLE, equipment: [{ id: 'torch', name: 'Torch', count: 2 }, { id: 'dungeoneer-pack', name: 'Dungeoneer\u2019s Pack', count: 1 }] };
  const opened = unpacked(packed);
  assert.equal(held(opened, 'dungeoneer-pack'), 0);
  assert.equal(held(opened, 'torch'), 12, 'two plus the pack\u2019s ten');
  assert.deepEqual(['rations', 'waterskin', 'oil', 'crowbar'].map((id) => held(opened, id)), [10, 1, 2, 1]);
  assert.equal(opened.equipment.find((e) => e.id === 'rations')!.name, 'Rations');
  const two = unpacked({ ...SAMPLE, equipment: [{ id: 'explorers-pack', name: 'Explorer\u2019s Pack', count: 2 }] });
  assert.equal(held(two, 'rations'), 20, 'two packs, twice the contents');
  const plain = { ...SAMPLE, equipment: [{ id: 'torch', name: 'Torch', count: 2 }] };
  assert.equal(unpacked(plain), plain);
});

test('a pack added comes opened', () => {
  const bare = { ...SAMPLE, equipment: [] };
  const got = addItem(bare, 'dungeoneer-pack');
  assert.equal(held(got, 'dungeoneer-pack'), 0);
  assert.equal(held(got, 'torch'), 10);
  assert.equal(held(addItem(bare, 'dungeoneer-pack', 2), 'torch'), 20);
});
