import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Dungeon } from './dungeon.ts';
import { dungeonTables } from './dungeonTables.ts';
import { expand, startExplore, unexplored } from './explore.ts';
import { RuleViolation } from './violation.ts';

/** Explore every open exit breadth-first, up to `steps` expansions. */
function wander(d: Dungeon, steps: number, order: (open: [string, string][]) => [string, string][] = (o) => o): Dungeon {
  for (let i = 0; i < steps; i++) {
    const open = order(unexplored(d));
    if (open.length === 0) break;
    d = expand(d, ...open[0]);
  }
  return d;
}

test('exploring starts at an empty entrance room with one to three unexplored ways on', () => {
  for (let seed = 0; seed < 30; seed++) {
    const d = startExplore(seed, [1, 1]);
    const e = d.nodes[d.entrance];
    assert.deepEqual([d.mode, d.goal, e.type, e.purpose, e.contents!.kind, e.depth], ['explore', null, 'room', 'Threshold', 'empty', 1]);
    assert.ok(e.exits.length >= 1 && e.exits.length <= 3);
    assert.ok(e.exits.every((x) => x.to === null));
    assert.deepEqual(e.exits.map((x) => x.id), ['x1', 'x2', 'x3'].slice(0, e.exits.length));
    assert.equal(d.version, 1);
    assert.deepEqual(unexplored(d), e.exits.map((x) => [d.entrance, x.id]));
  }
});

test('expanding an exit adds the area beyond it, with a way back', () => {
  const d0 = startExplore(1, [1]);
  const [nodeId, exitId] = unexplored(d0)[0];
  const d1 = expand(d0, nodeId, exitId);
  const child = d1.nodes[`${nodeId}.${exitId}`];
  assert.equal(d1.nodes[nodeId].exits.find((x) => x.id === exitId)!.to, child.id);
  assert.deepEqual(child.exits.find((x) => x.id === 'back'), { id: 'back', connection: d0.nodes[nodeId].exits[0].connection, to: nodeId });
  assert.equal(d0.nodes[nodeId].exits[0].to, null, 'the old dungeon is left as it was');
});

test('expanding an explored exit changes nothing', () => {
  const d1 = expand(startExplore(2, [1]), 'e', unexplored(startExplore(2, [1]))[0][1]);
  const exitId = unexplored(startExplore(2, [1]))[0][1];
  assert.equal(expand(d1, 'e', exitId), d1);
});

test('an unknown area or exit is a rule violation', () => {
  const d = startExplore(3, [1]);
  assert.throws(() => expand(d, 'nowhere', 'x1'), new RuleViolation('there is no area nowhere'));
  assert.throws(() => expand(d, 'e', 'up'), new RuleViolation('there is no exit up from e'));
});

test('the same seed and choices give the same dungeon, whatever order areas are explored in', () => {
  const forward = wander(startExplore(11, [2, 2]), 40);
  const backward = wander(startExplore(11, [2, 2]), 40, (o) => [...o].reverse());
  const shared = Object.keys(forward.nodes).filter((id) => id in backward.nodes);
  assert.ok(shared.length > 3);
  for (const id of shared) {
    const strip = (n: Dungeon['nodes'][string]) => ({ ...n, exits: n.exits.map((x) => x.id) });
    assert.deepEqual(strip(backward.nodes[id]), strip(forward.nodes[id]), id);
  }
  assert.deepEqual(wander(startExplore(11, [2, 2]), 40), forward);
});

test('an explored dungeon is plain JSON and keeps expanding after a round trip', () => {
  const d = wander(startExplore(12, [1]), 15);
  const copy = JSON.parse(JSON.stringify(d)) as Dungeon;
  assert.deepEqual(copy, d);
  assert.deepEqual(wander(copy, 10), wander(d, 10));
});

test('a long walk finds rooms, passages, stairs down to deeper levels and dead ends', () => {
  let d = startExplore(5, [3, 3, 3]);
  d = wander(d, 400);
  const nodes = Object.values(d.nodes);
  const types = new Set(nodes.map((n) => n.type));
  assert.deepEqual([...types].sort(), ['dead-end', 'passage', 'room', 'stairs']);
  assert.ok(nodes.some((n) => n.depth > 1));
  for (const n of nodes) {
    if (n.type === 'room') assert.ok(n.contents && n.size && n.purpose, n.id);
    else assert.deepEqual([n.contents, n.size, n.purpose], [null, null, null], n.id);
    if (n.type === 'dead-end') assert.deepEqual(n.exits.map((x) => x.id), ['back']);
    if (n.type === 'stairs') assert.ok(n.exits.some((x) => x.id === 'down' && x.connection === 'stairs'));
    const parent = n.id.slice(0, n.id.lastIndexOf('.'));
    const via = parent ? d.nodes[parent].exits.find((x) => x.to === n.id) : undefined;
    if (via) assert.equal(n.depth, d.nodes[parent].depth + (via.connection === 'stairs' ? 1 : 0), n.id);
  }
});

test('room monsters get harder deeper down', () => {
  const d = wander(startExplore(5, [3, 3, 3]), 400);
  for (const n of Object.values(d.nodes)) {
    const encounter = n.contents?.encounter;
    if (encounter) assert.equal(encounter.difficulty, ['low', 'moderate', 'high'][Math.min(n.depth, 3) - 1], n.id);
  }
});

test('the dungeon never closes off: the first way on from every area on the main line always continues', () => {
  for (let seed = 0; seed < 30; seed++) {
    let d = startExplore(seed, [1]);
    let at = d.entrance;
    for (let step = 0; step < 60; step++) {
      const next = d.nodes[at].exits.find((x) => x.id !== 'back');
      assert.ok(next, `seed ${seed}: ${at} has no way on`);
      d = expand(d, at, next.id);
      at = next.to ?? `${at}.${next.id}`;
    }
  }
});

const wayOn = (d: Dungeon, id: string) => d.nodes[id].exits.find((x) => x.id !== 'back');
const parentOf = (id: string) => id.slice(0, id.lastIndexOf('.'));
const onMainLine = (d: Dungeon, id: string): boolean =>
  !id.includes('.') || (onMainLine(d, parentOf(id)) && wayOn(d, parentOf(id))!.to === id);

test('off the main line ways can close: dead ends and rooms with no way on, even down a first way on', () => {
  const d = wander(startExplore(2, [2]), 300);
  const closed = Object.values(d.nodes).filter((n) => n.id !== d.entrance && !wayOn(d, n.id));
  assert.ok(closed.some((n) => n.type === 'room'), 'a room with only the way back');
  assert.ok(closed.some((n) => n.type === 'dead-end' && onMainLine(d, parentOf(n.id))), 'a side way off the main line');
  assert.ok(closed.some((n) => !onMainLine(d, parentOf(n.id)) && wayOn(d, parentOf(n.id))!.to === n.id), 'a first way on from off the main line');
  assert.ok(closed.every((n) => !onMainLine(d, n.id)));
});

test('behind a door is a room or a passage going on', () => {
  const d = wander(startExplore(4, [2]), 300);
  const behindDoors = Object.values(d.nodes).filter((n) => n.exits[0]?.id === 'back' && n.exits[0].connection.endsWith('-door'));
  assert.ok(behindDoors.length > 10);
  for (const n of behindDoors) assert.ok(n.type === 'room' || n.name === 'Passage', `${n.id}: ${n.name}`);
  assert.ok(behindDoors.some((n) => n.type === 'room') && behindDoors.some((n) => n.type === 'passage'));
});

test('rooms take every purpose of the dungeon kind but the goal\'s', () => {
  const d = wander(startExplore(8, [2]), 400);
  const { kinds, purposes } = dungeonTables();
  const all = purposes[kinds.rows.find((r) => r.value.name === d.kind)!.value.id];
  const used = new Set(Object.values(d.nodes).filter((n) => n.id !== d.entrance && n.type === 'room').map((n) => n.purpose));
  assert.deepEqual([...used].sort(), all.slice(0, -1).sort());
});
