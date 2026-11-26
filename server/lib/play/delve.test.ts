import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SAMPLE } from '../rules/sheet.fixture.ts';
import { arrival, claimTreasure, clearRoom, enter, mapSize, partyLevel, startDungeon } from './delve.ts';
import type { DungeonState, PartyState } from './state.ts';

test('a fixed dungeon is a whole map, sized by the adventure; explore mode starts with the entrance only', () => {
  const fixed = startDungeon('fixed', 3, [1, 1], 4);
  assert.deepEqual([fixed.version, fixed.map.mode, fixed.at, fixed.visited, fixed.cleared], [1, 'fixed', 'r0', ['r0'], ['r0']]);
  assert.equal(Object.keys(fixed.map.nodes).length, 5);
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
  const boars = arrival(d, d.map.nodes.r1);
  assert.deepEqual(boars.fight, ['boar', 'boar', 'boar']);
  assert.deepEqual([boars.trap, boars.treasure], [null, null]);
  const loot = arrival(d, d.map.nodes.r4);
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
