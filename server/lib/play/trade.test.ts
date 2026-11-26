import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addItem } from '../rules/inventory.ts';
import { SAMPLE } from '../rules/sheet.fixture.ts';
import { buyItems, itemIdOf, sellItems, stow, usePotion } from './trade.ts';
import type { PartyState } from './state.ts';

const party = (p1: Partial<typeof SAMPLE>, p2: Partial<typeof SAMPLE>): PartyState =>
  ({ version: 1, rng: 7, sheets: { p1: { ...SAMPLE, ...p1 }, p2: { ...SAMPLE, name: 'Cleo', ...p2 } } });

test('found items go to the living hero with the most room to carry them', () => {
  const p = party({ gp: 0 }, { gp: 0, abilityScores: { ...SAMPLE.abilityScores, str: 8 } });
  const { party: after, lines } = stow(p, ['gemstone', 'gemstone', 'bag-of-holding']);
  assert.deepEqual(after.sheets.p1.equipment.slice(1), [{ id: 'gemstone', name: 'Gemstone', count: 2 }, { id: 'bag-of-holding', name: 'Bag of Holding', count: 1 }]);
  assert.deepEqual(lines, ['Bryn takes 2 Gemstone, Bag of Holding.']);
  const dead = stow(party({ dead: true }, {}), ['gemstone']).party;
  assert.deepEqual([dead.sheets.p1.equipment.length, dead.sheets.p2.equipment.at(-1)!.id], [1, 'gemstone']);
  assert.deepEqual(stow(p, []).lines, []);
});

test('what nobody can carry is left behind', () => {
  const weak = { abilityScores: { ...SAMPLE.abilityScores, str: 1 }, equipment: [], gp: 0 };
  const { party: after, lines } = stow(party(weak, weak), ['plate-armor', 'gemstone']);
  assert.deepEqual(lines, ['Bryn takes Gemstone.', 'Left behind (too heavy): Plate Armor.'], 'a tie goes to the first hero');
  assert.equal(after.sheets.p1.equipment.length + after.sheets.p2.equipment.length, 1);
});

test('a magic item named in a treasure hoard is found by name or id', () => {
  assert.equal(itemIdOf('Bag of Holding'), 'bag-of-holding');
  assert.equal(itemIdOf('bag-of-holding'), 'bag-of-holding');
  assert.equal(itemIdOf('The Spoon of Destiny'), null);
});

test('buying: each item is bought by the richest hero who can pay for it', () => {
  const { party: after, lines } = buyItems(party({ gp: 60 }, { gp: 55 }), ['potion-of-healing', 'potion-of-healing', 'potion-of-healing', 'potions-of-healing']);
  assert.deepEqual([after.sheets.p1.gp, after.sheets.p2.gp], [10, 5]);
  assert.deepEqual(lines, [
    'Bryn buys Potion of Healing for 50 GP.', 'Cleo buys Potion of Healing for 50 GP.',
    'Nobody can afford Potion of Healing (50 GP).', 'Potions of Healing is not for sale.',
  ]);
});

test('selling: every living hero sells all they hold of each item, gear at half, treasure at full value', () => {
  const p = party({ gp: 0, equipment: [{ id: 'gemstone', name: 'Gemstone', count: 2 }] }, { gp: 0, equipment: [{ id: 'longsword', name: 'Longsword', count: 1 }] });
  const { party: after, lines } = sellItems(p, ['gemstone', 'longsword', 'torch']);
  assert.deepEqual([after.sheets.p1.gp, after.sheets.p2.gp, after.sheets.p1.equipment, after.sheets.p2.equipment], [100, 7.5, [], []]);
  assert.deepEqual(lines, ['Bryn sells 2 Gemstone for 100 GP.', 'Cleo sells 1 Longsword for 7.5 GP.', 'Nobody has Torch to sell.']);
});

test('a potion goes to the most hurt hero (a hero at 0 HP first), from their own pack if they have one', () => {
  const p = party({ hp: 3, equipment: [] }, { hp: 0, equipment: [] });
  const stocked = { ...p, sheets: { ...p.sheets, p1: addItem(p.sheets.p1, 'potion-of-healing', 1) } };
  const { party: after, lines } = usePotion(stocked, 'potion-of-healing');
  assert.equal(after.sheets.p1.equipment.length, 0);
  assert.ok(after.sheets.p2.hp >= 4 && after.sheets.p2.hp <= 10);
  assert.deepEqual(lines, [`Bryn gives Cleo a Potion of Healing: ${after.sheets.p2.hp} HP back.`]);
  assert.notEqual(after.rng, stocked.rng);
  const own = { ...p, sheets: { p1: addItem({ ...p.sheets.p1, hp: 1 }, 'potion-of-healing'), p2: addItem({ ...p.sheets.p2, hp: 12 }, 'potion-of-healing') } };
  assert.deepEqual(usePotion(own, 'potion-of-healing').lines.map((l) => l.split(':')[0]), ['Bryn drinks a Potion of Healing']);
  assert.deepEqual(usePotion(p, 'potion-of-healing').lines, ['Nobody has a Potion of Healing.']);
  assert.deepEqual(usePotion(stocked, 'torch').lines, ['Torch cannot be drunk.']);
  const fine = party({ equipment: [{ id: 'potion-of-healing', name: 'Potion of Healing', count: 1 }] }, {});
  assert.deepEqual(usePotion(fine, 'potion-of-healing').lines, ['Nobody needs healing.']);
});

test('"most hurt" is the lowest share of maximum HP, and the first hero on a tie', () => {
  const potion = [{ id: 'potion-of-healing', name: 'Potion of Healing', count: 1 }];
  const drinker = (p1: Partial<typeof SAMPLE>, p2: Partial<typeof SAMPLE>) => usePotion(party({ ...p1, equipment: potion }, p2), 'potion-of-healing').lines[0];
  assert.match(drinker({ hp: 5, maxHp: 50 }, { hp: 3, maxHp: 6 }), /^Bryn drinks/);
  assert.match(drinker({ hp: 6, maxHp: 12 }, { hp: 3, maxHp: 6 }), /^Bryn drinks/);
  assert.match(drinker({ hp: 6, maxHp: 12 }, { hp: 2, maxHp: 6 }), /^Bryn gives Cleo/);
});
