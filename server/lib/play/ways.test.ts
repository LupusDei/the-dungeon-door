import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DungeonNode, Exit } from '../rules/dungeon.ts';
import { enter, startDungeon } from './delve.ts';
import type { DungeonState } from './state.ts';
import { areaName, wayLabel } from './ways.ts';

const area = (id: string, exits: Exit[], o: Partial<DungeonNode> = {}): DungeonNode =>
  ({ id, type: 'room', name: 'Long hall (40 x 20 ft.)', depth: 1, size: null, purpose: null, contents: null, exits, ...o });
const at = (nodes: DungeonNode[], visited: string[]): DungeonState => ({
  version: 1, at: nodes[0].id, visited, cleared: [],
  map: { version: 1, mode: 'fixed', seed: 1, kind: 'crypt', levels: [1], entrance: nodes[0].id, goal: null, nodes: Object.fromEntries(nodes.map((n) => [n.id, n])) },
});

test('an area is called by what it is for, else by its name without the size', () => {
  assert.equal(areaName(area('r1', [], { purpose: 'Narthex' })), 'Narthex');
  assert.equal(areaName(area('r1', [], { purpose: ' ' })), 'Long hall');
  assert.equal(areaName(area('r1', [], { name: 'Dead end' })), 'Dead end');
  assert.equal(areaName(area('r1', [], { name: '(odd)' })), '(odd)');
});

test('a way on is named by its connection, a way to somewhere the party has been by that place, never by an exit id', () => {
  const here = area('r0', [{ id: 'r1', connection: 'locked-door', to: 'r1' }, { id: 'r2', connection: 'open-passage', to: 'r0-r2' }, { id: 'x1', connection: 'stairs', to: null }]);
  const corridor = area('r0-r2', [{ id: 'r0', connection: 'open-passage', to: 'r0' }, { id: 'r2', connection: 'open-passage', to: 'r2' }], { type: 'corridor', name: 'Passage' });
  const d = at([here, area('r1', [], { purpose: 'Crypt' }), corridor, area('r2', [], { purpose: 'Narthex' })], ['r0', 'r2']);
  assert.equal(wayLabel(d, 'r1'), 'Go on (locked door)', 'a room not yet seen (on a fixed map) is not named');
  assert.equal(wayLabel(d, 'r2'), 'Back to Narthex (open passage)', 'past the corridor, the room the party has been in');
  assert.equal(wayLabel(d, 'x1'), 'Go on (stairs)', 'unexplored');
  assert.equal(wayLabel(at([area('r0', [{ id: 'r1', connection: 'open-passage', to: 'r1' }]), area('r1', [], { name: 'Bend in the passage' })], ['r0', 'r1']), 'r1'), 'Back to Bend in the passage (open passage)');
});

test('ways alike from one area are told apart; an unknown exit, or no dungeon, is just "Go on"', () => {
  const passages = Array.from({ length: 11 }, (_, i): Exit => ({ id: `x${i + 1}`, connection: 'open-passage', to: null }));
  const d = at([area('e', [...passages, { id: 'back', connection: 'wooden-door', to: 'e' }])], ['e']);
  assert.equal(wayLabel(d, 'x1'), 'Go on (first open passage)');
  assert.equal(wayLabel(d, 'x3'), 'Go on (third open passage)');
  assert.equal(wayLabel(d, 'x10'), 'Go on (tenth open passage)');
  assert.equal(wayLabel(d, 'x11'), 'Go on (another open passage)');
  assert.equal(wayLabel(d, 'back'), 'Back to Long hall (wooden door)', 'one of a kind: no ordinal');
  assert.equal(wayLabel(d, 'nowhere'), 'Go on');
  assert.equal(wayLabel(null, 'x1'), 'Go on');
  assert.equal(wayLabel({ ...d, at: 'gone' }, 'x1'), 'Go on');
});

test('in generated dungeons, fixed and explore, every way from every area visited has its own label with no exit id in it', () => {
  for (const mode of ['fixed', 'explore'] as const) for (let seed = 1; seed <= 30; seed++) {
    let d = startDungeon(mode, seed, [1, 1], 6);
    for (let step = 0; step < 4; step++) {
      const exits = d.map.nodes[d.at].exits;
      const labels = exits.map((x) => wayLabel(d, x.id));
      assert.equal(new Set(labels).size, labels.length, `${mode} ${seed}: ${labels.join(' | ')}`);
      for (const l of labels) assert.ok(!exits.some((x) => l.includes(`(${x.id})`)) && !/\b[rx]\d+\b|\./.test(l), `${mode} ${seed}: ${l}`);
      d = enter(d, exits[0].id)!.dungeon;
      if (d.map.nodes[d.at].type === 'corridor') d = enter(d, exits[0].id)!.dungeon;
    }
  }
});
