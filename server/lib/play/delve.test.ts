import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SAMPLE } from '../rules/sheet.fixture.ts';
import { temperedBudget } from '../rules/encounter.ts';
import { arrival, claimTreasure, clearRoom, dungeonLevel, enter, mapSize, partyLevel, startDungeon } from './delve.ts';
import type { DungeonState, PartyState } from './state.ts';

test('a fixed dungeon is a whole map, sized by the adventure; explore mode starts with the entrance only', () => {
  const fixed = startDungeon('fixed', 3, [1, 1], 4);
  assert.deepEqual([fixed.version, fixed.map.mode, fixed.at, fixed.visited, fixed.cleared], [1, 'fixed', 'r0', ['r0'], ['r0']]);
  assert.equal(Object.values(fixed.map.nodes).filter((n) => n.type === 'room').length, 5);
  const explore = startDungeon('explore', 3, [1, 1], 4);
  assert.deepEqual([explore.map.mode, Object.keys(explore.map.nodes).length, explore.at], ['explore', 1, explore.map.entrance]);
  assert.deepEqual([mapSize(2), mapSize(4), mapSize(5), mapSize(6), mapSize(7), mapSize(8)], ['short', 'short', 'standard', 'standard', 'delve', 'delve']);
});

test('taking an exit moves the party, remembers where it has been, and refuses an exit that is not here', () => {
  const d = startDungeon('fixed', 3, [1, 1], 4);
  const moved = enter(d, 'r1')!;
  assert.deepEqual([moved.dungeon.at, moved.dungeon.visited, moved.node.id], ['r1', ['r0', 'r1'], 'r1']);
  assert.deepEqual(enter(moved.dungeon, 'r0')!.dungeon.visited, ['r0', 'r1'], 'no repeats');
  assert.equal(enter(d, 'r3'), null);
  const explore = startDungeon('explore', 3, [1, 1], 4);
  const exit = explore.map.nodes[explore.at].exits[0].id;
  const opened = enter(explore, exit)!;
  assert.equal(opened.dungeon.at, `${explore.at}.${exit}`);
  assert.equal(Object.keys(opened.dungeon.map.nodes).length, 2, 'explore mode rolls the area beyond');
});

test('arriving in a room that is not cleared: its monsters are a fight, its trap goes off, its treasure loot', () => {
  const d = startDungeon('fixed', 3, [1, 1], 4);
  const rooms = Object.values(d.map.nodes).filter((n) => n.contents);
  const guarded = rooms.find((n) => n.contents!.encounter)!;
  assert.deepEqual(arrival(d, guarded).fight, guarded.contents!.encounter!.monsters);
  const r1 = d.map.nodes.r1;
  const boars = arrival(d, { ...r1, contents: { ...r1.contents!, kind: 'monster', encounter: { difficulty: 'moderate', budget: 75, xp: 75, monsters: ['boar'] }, trap: null, treasure: null } });
  assert.deepEqual([boars.fight, boars.trap, boars.treasure], [['boar'], null, null]);
  const coins = { sp: 600, gp: 0, gems: 0, jewellery: 0, magicItem: null };
  const loot = arrival(d, { ...r1, contents: { ...r1.contents!, kind: 'empty', encounter: null, trap: null, treasure: coins } });
  assert.deepEqual([loot.fight, loot.treasure!.sp], [null, 600]);
  assert.deepEqual(arrival(clearRoom(d, 'r1'), d.map.nodes.r1), { fight: null, trap: null, treasure: null });
  const trapped = { ...d.map.nodes.r4, contents: { ...d.map.nodes.r4.contents!, kind: 'trap' as const, trap: 'pits', treasure: null } };
  assert.deepEqual(arrival(d, trapped).trap, 'pits');
});

test('traps scale by the party\'s average level, rounded down', () => {
  assert.deepEqual([partyLevel([1, 3]), partyLevel([5, 4]), partyLevel([5, 6]), partyLevel([17, 20])], [2, 4, 5, 18]);
});

test('treasure: the coins are shared out as gold; gems, jewellery and the magic item go into packs', () => {
  const party: PartyState = { version: 1, rng: 1, sheets: { p1: { ...SAMPLE, gp: 1 }, p2: { ...SAMPLE, name: 'Cleo', gp: 0 } } };
  const { party: rich, lines } = claimTreasure(party, { sp: 25, gp: 10, gems: 2, jewellery: 1, magicItem: 'Potion of Healing' });
  assert.deepEqual([rich.sheets.p1.gp, rich.sheets.p2.gp], [7.25, 6.25]);
  assert.deepEqual(lines, [
    'Treasure: 12.5 gp in coin (6.25 each), 2 gems, 1 piece of jewellery, Potion of Healing.',
    'Cleo takes 2 Gemstone, Piece of Jewellery.', 'Bryn takes Potion of Healing.',
  ]);
  assert.deepEqual(rich.sheets.p2.equipment.slice(1).map((e) => [e.id, e.count]), [['gemstone', 2], ['jewellery', 1]]);
  assert.deepEqual(claimTreasure(party, { sp: 0, gp: 0, gems: 0, jewellery: 0, magicItem: 'Spoon of Destiny' }).lines, ['Treasure: 0 gp in coin (0 each), Spoon of Destiny.'], 'an item the SRD does not list is only named');
  assert.deepEqual(claimTreasure(party, { sp: 0, gp: 4, gems: 0, jewellery: 0, magicItem: null }).lines, ['Treasure: 4 gp in coin (2 each).']);
});

test('a cleared room is remembered once', () => {
  const d: DungeonState = startDungeon('fixed', 3, [1], 4);
  assert.deepEqual(clearRoom(clearRoom(d, 'r1'), 'r1').cleared, ['r0', 'r1']);
});

const doorsIn = (d: DungeonState) => d.map.nodes[d.at].exits.filter((x) => x.connection.endsWith('-door'));

test('the dungeon starts at the party’s level; a game from before dungeon levels reads its map’s level, or 1', () => {
  assert.equal(dungeonLevel(startDungeon('fixed', 3, [1, 1], 4)), 1);
  assert.equal(dungeonLevel(startDungeon('explore', 3, [4, 5, 3], 4)), 4);
  const old = startDungeon('fixed', 3, [1, 1], 4);
  const { level: _, ...map } = old.map;
  assert.equal(dungeonLevel({ ...old, map }), 1);
});

test('through a new door, a seeded chance (1 in 4) that the dungeon goes a level deeper: the room beyond is restocked for it and the change recorded', () => {
  const tried = Array.from({ length: 200 }, (_, seed) => startDungeon('fixed', seed + 1, [2, 2, 2], 6))
    .map((d) => ({ d, door: doorsIn(d).find((x) => d.map.nodes[x.to!].type === 'room') }))
    .filter(({ door }) => door !== undefined)
    .map(({ d, door }) => ({ d, door: door!, moved: enter(d, door!.id)! }));
  const deeper = tried.filter((t) => dungeonLevel(t.moved.dungeon) === 3);
  assert.ok(deeper.length > tried.length * 0.15 && deeper.length < tried.length * 0.35, `${deeper.length} of ${tried.length}`);
  assert.ok(tried.every((t) => [2, 3].includes(dungeonLevel(t.moved.dungeon))));
  for (const { d, door, moved } of deeper) {
    assert.equal(moved.node.depth, 3);
    assert.deepEqual(moved.dungeon.deepened, [{ at: moved.node.id, level: 3 }]);
    assert.deepEqual(enter(d, door.id), moved, 'the same every time');
    const e = moved.node.contents?.encounter;
    if (e) assert.equal(e.budget, temperedBudget([3, 3, 3], e.difficulty));
  }
  for (const { moved } of deeper) {
    for (const x of moved.node.exits) assert.ok(dungeonLevel(enter(moved.dungeon, x.id)!.dungeon) >= 3, 'never shallower again');
  }
});

test('no roll through an open passage, into a fixed map’s corridor, or back into a room already seen', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const d = startDungeon('fixed', seed, [1, 1], 6);
    for (const x of d.map.nodes[d.at].exits) {
      const moved = enter(d, x.id)!;
      const into = d.map.nodes[x.to!];
      if (!x.connection.endsWith('-door') || into.type === 'corridor') assert.equal(dungeonLevel(moved.dungeon), 1, `${seed} ${x.id}`);
    }
    for (const x of doorsIn(d)) {
      const seen = { ...d, visited: [...d.visited, x.to!] };
      assert.equal(dungeonLevel(enter(seen, x.id)!.dungeon), 1, `${seed} ${x.id}: seen before`);
    }
  }
});

test('in an explore dungeon the area beyond a door that goes deeper is rolled at the new level', () => {
  let found = 0;
  for (let seed = 1; seed <= 300 && found < 5; seed++) {
    const d = startDungeon('explore', seed, [1, 1, 1], 6);
    const door = doorsIn(d)[0];
    if (!door) continue;
    const moved = enter(d, door.id)!;
    if (dungeonLevel(moved.dungeon) === 1) continue;
    found++;
    assert.equal(moved.node.depth, 2);
  }
  assert.ok(found > 0);
});
