import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateDungeon } from './dungeon.ts';
import { currentTraps, isTrap, trapAt } from './traps.ts';

test('an SRD 5.2 example trap at its own levels', () => {
  assert.deepEqual(trapAt('collapsing-roof', 1), {
    id: 'collapsing-roof', name: 'Collapsing Roof', severity: 'deadly',
    detect: { ability: 'wis', skill: 'perception', dc: 11 }, disarm: null,
    avoid: 'Once detected, the trip wire can be easily cut or avoided (no ability check required).',
    targets: 'all', save: { ability: 'dex', dc: 13 }, damage: [{ dice: '2d10', type: 'bludgeoning' }], halfOnSave: true, condition: null, escape: null,
  });
  assert.deepEqual(trapAt('poisoned-needle', 4).disarm, { ability: 'dex', skill: 'sleight-of-hand', dc: 15, failureTriggers: true });
});

test('At Higher Levels: the tier for the party\'s level scales the save DC, damage and escape DC', () => {
  const tier = (id: string, level: number) => { const t = trapAt(id, level); return [t.save?.dc, t.damage.map((d) => d.dice).join('+')]; };
  assert.deepEqual([tier('collapsing-roof', 4), tier('collapsing-roof', 5), tier('collapsing-roof', 10), tier('collapsing-roof', 11), tier('collapsing-roof', 17)],
    [[13, '2d10'], [15, '4d10'], [15, '4d10'], [17, '10d10'], [19, '18d10']]);
  assert.deepEqual(tier('fire-casting-statue', 16), [15, '10d10'], 'only the damage scales');
  assert.deepEqual(tier('spiked-pit', 20), [undefined, '12d6+13d8']);
  assert.deepEqual(trapAt('poisoned-darts', 11).damage, [{ dice: '4d6', type: 'poison', times: '1d3' }]);
  assert.deepEqual(trapAt('falling-net', 2).escape, { ability: 'str', skill: 'athletics', dc: 10 });
  const net = trapAt('falling-net', 6);
  assert.deepEqual([net.save, net.escape, net.condition, net.damage], [{ ability: 'dex', dc: 12 }, { ability: 'str', skill: 'athletics', dc: 12 }, 'Restrained', []]);
});

test('maps rolled before Phase 3 name 5.1 traps: they become their 5.2 counterparts', () => {
  assert.deepEqual(['pits', 'poison-darts', 'poison-needle', 'fire-breathing-statue', 'sphere-of-annihilation'].map((id) => trapAt(id, 1).id),
    ['hidden-pit', 'poisoned-darts', 'poisoned-needle', 'fire-casting-statue', 'spiked-pit']);
});

test('the Rolling Stone is a trap for levels 11 and up; below that the party meets a Collapsing Roof', () => {
  assert.equal(trapAt('rolling-stone', 10).id, 'collapsing-roof');
  assert.equal(trapAt('rolling-sphere', 10).id, 'collapsing-roof');
  assert.deepEqual([trapAt('rolling-stone', 11).id, trapAt('rolling-stone', 11).condition, trapAt('rolling-stone', 20).save], ['rolling-stone', 'Prone', { ability: 'dex', dc: 15 }]);
});

test('traps and hazards are told apart; an unknown trap is refused', () => {
  assert.deepEqual(['hidden-pit', 'pits', 'falling', 'burning'].map(isTrap), [true, true, false, false]);
  assert.throws(() => trapAt('falling', 1), /unknown trap: falling/);
});

test('a stored map with 5.1 trap ids gets their 5.2 ids; a map without any is the same map', () => {
  const map = generateDungeon(7, 'delve', [3]);
  const room = Object.values(map.nodes).find((n) => n.contents !== null)!;
  const bare = { ...room, id: 'bare', contents: null };
  const old = { ...map, nodes: { ...map.nodes, bare, [room.id]: { ...room, contents: { ...room.contents!, trap: 'poison-needle' } } } };
  const fixed = currentTraps(old);
  assert.equal(fixed.nodes[room.id].contents!.trap, 'poisoned-needle');
  assert.equal(fixed.nodes.bare, bare, 'an area with no contents is left alone');
  assert.deepEqual({ ...fixed.nodes[room.id], contents: { ...fixed.nodes[room.id].contents!, trap: 'poison-needle' } }, old.nodes[room.id]);
  const current = { ...map, nodes: { ...map.nodes, [room.id]: { ...room, contents: { ...room.contents!, trap: 'hidden-pit' } } } };
  assert.equal(currentTraps(current), current);
  assert.equal(currentTraps(map), map);
});
