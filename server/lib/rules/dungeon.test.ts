import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateDungeon, layout, magicItemPool, restock, rollTreasure, stockRoom } from './dungeon.ts';
import { temperedBudget } from './encounter.ts';
import { monster } from './monsters.ts';
import { dungeonTables } from './dungeonTables.ts';
import { scriptedRng, seededRng } from './rng.ts';

const party = { levels: [1, 1, 1, 1], depth: 1, difficulty: 'moderate' as const };

test('an empty room gets only dressing, unless its 1-in-6 treasure comes up', () => {
  const room = stockRoom(scriptedRng([1, 2, 5]), party);
  assert.deepEqual(room, { kind: 'empty', encounter: null, trap: null, special: null, treasure: null, dressing: 'A draft from somewhere you cannot see' });
});

test('a 1 on the treasure die finds treasure in an empty room', () => {
  const room = stockRoom(scriptedRng([2, 1, 1, 1, 100, 100, 100, 100, 5]), party);
  assert.deepEqual(room.treasure, { sp: 100, gp: 0, gems: 0, jewellery: 0, magicItem: null });
});

test('a trap room names an SRD trap or hazard; a special room an OSE special, never with treasure', () => {
  const trap = stockRoom(scriptedRng([6, 4, 3, 1]), party);
  assert.deepEqual([trap.kind, trap.trap, trap.treasure], ['trap', 'hidden-pit', null]);
  const special = stockRoom(scriptedRng([5, 1, 1]), party);
  assert.deepEqual([special.kind, special.special, special.treasure], ['special', 'Alarms', null]);
});

test('a monster room has an encounter sized to the party and difficulty', () => {
  for (let seed = 0; seed < 20; seed++) {
    const room = stockRoom(seededRng(seed), party);
    if (room.kind === 'monster') {
      assert.ok(room.encounter!.monsters.length > 0);
      assert.equal(room.encounter!.difficulty, 'moderate');
      assert.ok(room.encounter!.xp <= 300);
    } else assert.equal(room.encounter, null);
  }
});

test('treasure comes from the OSE band for the dungeon level: silver always, the rest by chance', () => {
  const t = rollTreasure(scriptedRng([1, 3, 50, 4, 51, 6, 3, 2, 3]), 1);
  assert.deepEqual(t, { sp: 300, gp: 40, gems: 0, jewellery: 0, magicItem: null });
  const rich = rollTreasure(scriptedRng([1, 6, 1, 6, 1, 2, 1, 3, 1, 1]), 1);
  assert.deepEqual([rich.sp, rich.gp, rich.gems, rich.jewellery, typeof rich.magicItem], [600, 60, 2, 3, 'string']);
  assert.equal(rollTreasure(seededRng(1), 30).sp % 5000, 0, 'deeper than the table uses its last band');
});

test('magic items are common and uncommon near the top, rare ones join from level 4', () => {
  assert.ok(magicItemPool(1).length > 0);
  assert.ok(magicItemPool(4).length > magicItemPool(3).length);
});

test('a fixed map has 5, 7 or 9 rooms: one entrance, one goal, a path between them, branches and loops', () => {
  for (const [size, rooms, loops] of [['short', 5, 0], ['standard', 7, 1], ['delve', 9, 2]] as const) {
    const d = generateDungeon(42, size, [2, 2, 2]);
    const nodes = Object.values(d.nodes).filter((n) => n.type === 'room');
    assert.equal(nodes.length, rooms, size);
    const edges = nodes.reduce((n, r) => n + r.exits.length, 0) / 2;
    assert.equal(edges, rooms - 1 + loops, `${size}: a tree plus ${loops} loops (a corridor is still one way)`);
    assert.ok(Object.values(d.nodes).every((r) => r.exits.every((e) => d.nodes[e.to!].exits.some((back) => back.to === r.id))), 'every way goes both ways');
    assert.equal(d.mode, 'fixed');
    assert.equal(d.nodes[d.entrance].purpose, 'Threshold');
    assert.equal(d.nodes[d.entrance].contents!.kind, 'empty');
    const goal = d.nodes[d.goal!];
    assert.deepEqual([goal.contents!.kind, goal.contents!.treasure !== null, goal.contents!.encounter!.difficulty], ['monster', true, 'high']);
  }
});

test('the goal is at the end of the path from the entrance', () => {
  const d = generateDungeon(7, 'delve', [3]);
  const distance = new Map([[d.entrance, 0]]);
  const queue = [d.entrance];
  while (queue.length) {
    const id = queue.shift()!;
    for (const e of d.nodes[id].exits) if (!distance.has(e.to!)) { distance.set(e.to!, distance.get(id)! + 1); queue.push(e.to!); }
  }
  assert.equal([...distance.keys()].filter((id) => d.nodes[id].type === 'room').length, 9, 'every room can be reached');
  assert.ok(distance.get(d.goal!)! >= 2, 'the goal is not next to the entrance');
});

test('a fixed map is the same for the same seed, plain JSON, and differs across seeds', () => {
  const d = generateDungeon(5, 'standard', [1, 2]);
  assert.deepEqual(generateDungeon(5, 'standard', [1, 2]), d);
  assert.deepEqual(JSON.parse(JSON.stringify(d)), d);
  assert.notDeepEqual(generateDungeon(6, 'standard', [1, 2]), d);
});

test('a fixed map lays out the path first, branches off the path, then loops between rooms not yet linked', () => {
  const attached = { short: new Set<string>(), standard: new Set<string>() };
  for (let seed = 0; seed < 30; seed++) {
    for (const size of ['short', 'standard'] as const) {
      const { ids, goal, edges } = layout(seededRng(seed), size);
      const path = ids.slice(0, ids.indexOf(goal) + 1);
      assert.deepEqual(edges.slice(0, path.length - 1), path.slice(1).map((id, i) => [path[i], id]));
      for (const [anchor] of edges.slice(path.length - 1, ids.length - 1)) attached[size].add(anchor);
      const keys = edges.map(([a, b]) => [a, b].sort().join());
      assert.equal(new Set(keys).size, keys.length, 'no way is doubled');
      assert.ok(edges.every(([a, b]) => a !== b), 'no room loops to itself');
    }
  }
  assert.deepEqual([...attached.short].sort(), ['r0', 'r1', 'r2']);
  assert.deepEqual([...attached.standard].sort(), ['r1', 'r2', 'r3']);
});

test('fixed rooms start one level deep for level-1 heroes, and are purposeful: the goal takes the kind\'s last purpose, the rest the others', () => {
  const { kinds, purposes } = dungeonTables();
  const used = new Set<string>();
  for (let seed = 0; seed < 20; seed++) {
    const d = generateDungeon(seed, 'delve', [1]);
    const all = purposes[kinds.rows.find((r) => r.value.name === d.kind)!.value.id];
    assert.equal(d.version, 1);
    for (const n of Object.values(d.nodes)) {
      assert.equal(n.depth, 1);
      if (n.type !== 'room') continue;
      if (n.id === d.goal) assert.equal(n.purpose, all[all.length - 1]);
      else if (n.id !== d.entrance) assert.ok(all.slice(0, -1).includes(n.purpose!), n.purpose!), used.add(`${d.kind}:${all.indexOf(n.purpose!)}`);
    }
  }
  assert.ok([...used].some((u) => u.endsWith(':0')), 'the first purpose is used');
  assert.ok([...used].some((u) => !u.endsWith(':0')), 'and the others');
});

test('a fixed map starts at the party’s level: every area that deep, its fights and treasure for that level', () => {
  for (let seed = 0; seed < 30; seed++) {
    const d = generateDungeon(seed, 'standard', [5, 5, 4]);
    assert.equal(d.level, 4);
    for (const n of Object.values(d.nodes)) {
      assert.equal(n.depth, 4, n.id);
      const e = n.contents?.encounter;
      if (e) assert.equal(e.budget, temperedBudget([4, 4, 4], e.difficulty), n.id);
      if (e) assert.ok(e.monsters.every((m) => monster(m).cr <= 4), e.monsters.join());
    }
  }
  assert.equal(generateDungeon(1, 'short', [1, 2]).level, 1);
});

test('a room restocked a level deeper: same kind, its fight rebuilt and its treasure rolled for the new level; the same every time', () => {
  const d = generateDungeon(3, 'delve', [1, 1, 1, 1]);
  const guarded = Object.values(d.nodes).find((n) => n.contents?.encounter && n.id !== d.goal)!;
  const again = restock(d, guarded, 6);
  assert.deepEqual(restock(d, guarded, 6), again);
  assert.equal(again.depth, 6);
  assert.equal(again.contents!.kind, guarded.contents!.kind);
  assert.equal(again.contents!.encounter!.difficulty, guarded.contents!.encounter!.difficulty);
  assert.equal(again.contents!.encounter!.budget, temperedBudget([6, 6, 6, 6], guarded.contents!.encounter!.difficulty));
  assert.deepEqual([again.name, again.purpose, again.exits], [guarded.name, guarded.purpose, guarded.exits]);
  const rich = { ...guarded, contents: { ...guarded.contents!, treasure: { sp: 1, gp: 0, gems: 0, jewellery: 0, magicItem: null } } };
  assert.notDeepEqual(restock(d, rich, 6).contents!.treasure, rich.contents.treasure);
  const bare = { ...guarded, contents: { ...guarded.contents!, kind: 'empty' as const, encounter: null, treasure: null } };
  assert.deepEqual(restock(d, bare, 6).contents, bare.contents);
  assert.equal(restock(d, guarded, 1), guarded, 'no deeper: unchanged');
  const corridor = { ...guarded, contents: null };
  assert.deepEqual(restock(d, corridor, 6), { ...corridor, depth: 6 });
});

test('the goal room keeps its foes and its magic item a level deeper (the quest’s, play/quest.ts); its coin is rolled for the level', () => {
  const d = generateDungeon(42, 'short', [2, 2]);
  const goal = d.nodes[d.goal!];
  const deeper = restock(d, goal, 6);
  assert.deepEqual([deeper.depth, deeper.contents!.encounter], [6, goal.contents!.encounter]);
  const held = { ...goal, contents: { ...goal.contents!, treasure: { sp: 0, gp: 0, gems: 0, jewellery: 0, magicItem: 'Wand of Magic Missiles' } } };
  assert.equal(restock(d, held, 6).contents!.treasure!.magicItem, 'Wand of Magic Missiles', 'an item to recover is still there');
});
