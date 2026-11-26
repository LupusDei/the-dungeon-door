import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addCorridors, CORRIDORS, CORRIDOR_CONTENTS, corridorContents } from './corridors.ts';
import { generateDungeon } from './dungeon.ts';
import { dungeonTables } from './dungeonTables.ts';
import { seededRng } from './rng.ts';

const maps = Array.from({ length: 200 }, (_, seed) => generateDungeon(seed, 'standard', [2]));
const rooms = (m: ReturnType<typeof generateDungeon>) => Object.values(m.nodes).filter((n) => n.type === 'room');
const corridors = (m: ReturnType<typeof generateDungeon>) => Object.values(m.nodes).filter((n) => n.type === 'corridor');

test('the corridor table (original, CC0): d12, a third of ways are rooms opening on each other', () => {
  assert.equal(CORRIDORS.sides, 12);
  assert.deepEqual(CORRIDORS.rows.map((r) => [r.min, r.max, r.value]), [
    [1, 4, null], [5, 8, 'Passage'], [9, 10, 'Winding passage'], [11, 11, 'Junction (side passages lead off into the dark)'], [12, 12, 'Short stair'],
  ]);
  assert.deepEqual(CORRIDOR_CONTENTS.rows.map((r) => [r.min, r.max, r.value]), [[1, 13, 'empty'], [14, 17, 'trap'], [18, 20, 'spoor']]);
});

test('corridors never count as rooms: a standard map still has its 7 rooms, plus corridors between some', () => {
  for (const m of maps) assert.equal(rooms(m).length, 7);
  const share = maps.flatMap(corridors).length / maps.flatMap((m) => Object.values(m.nodes)).length;
  assert.ok(share > 0.3 && share < 0.6, String(share));
});

test('a corridor sits between two rooms: their exits keep the room ids as names and lead into it; it leads on to both', () => {
  for (const m of maps.slice(0, 40)) for (const c of corridors(m)) {
    const [a, b] = c.exits.map((x) => x.to!);
    assert.deepEqual(c.exits.map((x) => x.id), [a, b]);
    assert.deepEqual(m.nodes[a].exits.find((x) => x.id === b)!.to, c.id);
    assert.deepEqual(m.nodes[b].exits.find((x) => x.id === a)!.to, c.id);
    assert.equal(c.id, `${a}-${b}`);
    assert.deepEqual([c.contents!.encounter, c.contents!.treasure, c.size, c.purpose], [null, null, null, null], 'no encounters or treasure in a corridor');
    assert.ok(CORRIDORS.rows.some((r) => r.value === c.name));
  }
});

test('the same seed gives the same corridors, and the rooms are the ones the map had without them', () => {
  assert.deepEqual(generateDungeon(11, 'delve', [3]), generateDungeon(11, 'delve', [3]));
  const m = generateDungeon(11, 'delve', [3]);
  const bare = { ...m, nodes: Object.fromEntries(rooms(m).map((n) => [n.id, { ...n, exits: n.exits.map((x) => ({ ...x, to: x.id })) }])) };
  assert.deepEqual(addCorridors(bare), m);
});

test('what a corridor holds: mostly nothing; a trap or hazard from the dungeon table; or a wandering monster\'s spoor', () => {
  const held = Array.from({ length: 400 }, (_, i) => corridorContents(seededRng(i)));
  const kinds = (k: string) => held.filter((c) => (k === 'spoor' ? c.special === 'spoor' : c.kind === k)).length / held.length;
  assert.ok(Math.abs(kinds('trap') - 0.2) < 0.06 && Math.abs(kinds('spoor') - 0.15) < 0.06, `${kinds('trap')} ${kinds('spoor')}`);
  const traps = new Set(dungeonTables().traps.rows.map((r) => r.value));
  for (const c of held) {
    assert.equal(c.kind === 'trap', c.trap !== null);
    if (c.trap) assert.ok(traps.has(c.trap), c.trap);
    assert.ok(c.dressing.length > 0);
  }
});
