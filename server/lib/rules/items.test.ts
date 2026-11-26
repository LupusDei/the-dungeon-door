import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HEALING_POTIONS, item, items } from './items.ts';

test('every SRD 5.2 item has a price in GP and a weight in pounds', () => {
  assert.deepEqual(item('longsword'), { id: 'longsword', name: 'Longsword', kind: 'weapon', cost: 15, weight: 3, consumable: false });
  assert.deepEqual(item('chain-mail'), { id: 'chain-mail', name: 'Chain Mail', kind: 'armor', cost: 75, weight: 55, consumable: false });
  assert.deepEqual(item('candle'), { id: 'candle', name: 'Candle', kind: 'gear', cost: 0.01, weight: 0, consumable: false });
  assert.equal(item('pouch').cost, 0.5);
  assert.deepEqual(item('thieves-tools'), { id: 'thieves-tools', name: "Thieves' Tools", kind: 'tool', cost: 25, weight: 1, consumable: false, ability: 'dex' });
});

test('a pack weighs what the SRD 5.2 gear table says', () => {
  const pack = item('burglars-pack');
  assert.deepEqual([pack.kind, pack.cost, pack.weight], ['pack', 16, 42]);
  assert.equal(item('entertainers-pack').weight, 58.5);
});

test('magic items are valued by rarity (5.2), consumables at half; an item of varying rarity has no price', () => {
  assert.deepEqual(item('adamantine-armor'), { id: 'adamantine-armor', name: 'Adamantine Armor', kind: 'magic', cost: 400, weight: 0, consumable: false, rarity: 'Uncommon' });
  assert.equal(item('potions-of-healing').cost, 0);
  assert.equal(items().get('bag-of-holding')!.kind, 'magic');
});

test('the four Potions of Healing: what they heal, what they cost', () => {
  assert.deepEqual(HEALING_POTIONS, { 'potion-of-healing': '2d4+2', 'potion-of-greater-healing': '4d4+4', 'potion-of-superior-healing': '8d4+8', 'potion-of-supreme-healing': '10d4+20' });
  assert.deepEqual(item('potion-of-healing'), { id: 'potion-of-healing', name: 'Potion of Healing', kind: 'gear', cost: 50, weight: 0.5, consumable: true });
  assert.deepEqual(['potion-of-greater-healing', 'potion-of-superior-healing', 'potion-of-supreme-healing'].map((id) => item(id).cost), [200, 2000, 20000]);
  assert.equal(item('potion-of-supreme-healing').rarity, 'Very Rare');
});

test('treasure: gemstones and jewellery (original values, CC0: the SRD has no gem tables)', () => {
  assert.deepEqual(item('gemstone'), { id: 'gemstone', name: 'Gemstone', kind: 'treasure', cost: 50, weight: 0, consumable: false });
  assert.deepEqual(item('jewellery'), { id: 'jewellery', name: 'Piece of Jewellery', kind: 'treasure', cost: 100, weight: 1, consumable: false });
});

test('an unknown item is refused', () => {
  assert.throws(() => item('vorpal-spoon'), /unknown item: vorpal-spoon/);
});
