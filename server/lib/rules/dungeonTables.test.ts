import assert from 'node:assert/strict';
import { test } from 'node:test';
import exploreJson from '../../data/srd/extras/exploreGenerator.json' with { type: 'json' };
import { dungeonTables, rollOn, rollTable } from './dungeonTables.ts';
import { scriptedRng } from './rng.ts';

const t = dungeonTables();

test('a roll table maps each face to its row, single faces and lists alike', () => {
  const table = rollTable(6, [{ roll: [1, 2], value: 'a' }, { roll: 3, value: 'b' }, { min: 4, max: 6, value: 'c' }]);
  assert.deepEqual([1, 2, 3, 4, 6].map((f) => rollOn(scriptedRng([f]), table)), ['a', 'a', 'b', 'c', 'c']);
});

test('a roll table must cover every face once, in order', () => {
  assert.throws(() => rollTable(6, [{ roll: [1, 2], value: 'a' }, { roll: [4, 5, 6], value: 'b' }]), /rows must cover 1 to 6 in order; 3 is missing/);
  assert.throws(() => rollTable(6, [{ roll: [1, 2, 3], value: 'a' }]), /rows must cover 1 to 6 in order; 4 is missing/);
  assert.throws(() => rollTable(4, [{ roll: [1, 2, 3, 4, 5], value: 'a' }]), /a d4 has no 5/);
});

test('the fixed-map sizes are 5, 7 and 9 rooms', () => {
  assert.deepEqual(t.sizes.short, { rooms: 5, path: 2, branches: 1, loops: 0 });
  assert.deepEqual(t.sizes.standard, { rooms: 7, path: 3, branches: 2, loops: 1 });
  assert.deepEqual(t.sizes.delve, { rooms: 9, path: 4, branches: 3, loops: 2 });
});

test('the CC0 map tables load: kinds, ways between rooms, room sizes and purposes, traps, dressing', () => {
  assert.deepEqual(rollOn(scriptedRng([1]), t.kinds), { id: 'crypt', name: 'Crypt' });
  assert.equal(rollOn(scriptedRng([10]), t.connections), 'blocked-way');
  assert.equal(rollOn(scriptedRng([1]), t.roomSizes).id, 'cramped');
  assert.equal(t.purposes.crypt.at(-1), 'True sarcophagus (goal)');
  assert.equal(rollOn(scriptedRng([4]), t.traps), 'pits');
  assert.equal(typeof rollOn(scriptedRng([8]), t.dressing), 'string');
});

test('OSE stocking: 1-2 empty, 3-4 monster, 5 special, 6 trap, each with its chance of treasure in six', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((f) => rollOn(scriptedRng([f]), t.contents)), [
    { kind: 'empty', treasureIn6: 1 }, { kind: 'empty', treasureIn6: 1 }, { kind: 'monster', treasureIn6: 3 },
    { kind: 'monster', treasureIn6: 3 }, { kind: 'special', treasureIn6: 0 }, { kind: 'trap', treasureIn6: 2 },
  ]);
  assert.ok(t.specials.includes('Alarms'));
});

test('OSE treasure amounts parse into a chance, dice and a multiplier, by dungeon level', () => {
  assert.deepEqual(t.treasure[0], {
    levels: [1],
    silver: { chance: 100, dice: '1d6', multiplier: 100 }, gold: { chance: 50, dice: '1d6', multiplier: 10 },
    gems: { chance: 5, dice: '1d6', multiplier: 1 }, jewellery: { chance: 2, dice: '1d6', multiplier: 1 },
    magicItem: { chance: 2, dice: '1', multiplier: 1 },
  });
  assert.deepEqual(t.treasure[2].silver, { chance: 100, dice: '1d6', multiplier: 1000 });
});

test('the explore tables are original CC0 and cover every face', () => {
  assert.equal(exploreJson.meta.license, 'CC0-1.0');
  assert.match(exploreJson.meta.notes, /No table, wording, die size or probability was copied/);
  assert.deepEqual(rollOn(scriptedRng([30]), t.explore.beyond), { result: 'onward', exits: ['ahead'] });
  assert.deepEqual(rollOn(scriptedRng([31]), t.explore.beyond), { result: 'door', exits: [] });
  assert.deepEqual(rollOn(scriptedRng([50]), t.explore.beyond), { result: 'fork', exits: ['left', 'right'] });
  assert.deepEqual(rollOn(scriptedRng([100]), t.explore.beyond), { result: 'dead-end', exits: [] });
  assert.equal(rollOn(scriptedRng([5]), t.explore.behindDoor), 'onward');
  assert.deepEqual([1, 2, 5, 7, 8].map((f) => rollOn(scriptedRng([f]), t.explore.roomExits)), [0, 1, 2, 3, 4]);
  assert.deepEqual([1, 2, 3].map((d) => t.explore.difficulty(d)), ['low', 'moderate', 'high']);
  assert.equal(t.explore.difficulty(7), 'high');
});
