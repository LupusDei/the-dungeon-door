import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heroSheet } from '../characters.ts';
import { foeCap, temperedBudget } from '../rules/encounter.ts';
import { items } from '../rules/items.ts';
import { monster } from '../rules/monsters.ts';
import { derivedRng, seededRng } from '../rules/rng.ts';
import { startDungeon } from './delve.ts';
import type { PartyState } from './state.ts';
import { eventFor, legOf, meetOnTheRoad, planTrek, ROAD_MONSTERS, ROAD_POOLS, TREK_SCENES } from './trek.ts';

const fighter = heroSheet({ id: 'f', name: 'Bryn', race: 'human', characterClass: 'fighter' });
const party: PartyState = { version: 1, rng: 5, sheets: { p1: fighter, p2: { ...fighter, name: 'Ash' } } };

test('the trek is two stretches of road, each a d12 on the road table: 1–3 bandits, 4–6 varmints, 7–8 a band, 9–10 a vendor, 11–12 quiet', () => {
  assert.equal(TREK_SCENES, 2);
  assert.deepEqual(Array.from({ length: 12 }, (_, i) => eventFor(i + 1)),
    ['bandits', 'bandits', 'bandits', 'varmints', 'varmints', 'varmints', 'band', 'band', 'vendor', 'vendor', 'quiet', 'quiet']);
  const trek = planTrek(7, [1, 1], 1);
  assert.equal(trek.legs.length, 2);
  assert.equal(trek.leg, 0);
  assert.ok(trek.terrain.length > 0);
  assert.deepEqual(planTrek(7, [1, 1], 1), trek, 'the same seed, the same road');
  for (const leg of trek.legs) assert.equal(leg.event, eventFor(leg.roll));
});

test('foes on the road are a low SRD 5.2 encounter for the dungeon\u2019s starting level, from their own pool; bandits and bands carry treasure, beasts none', () => {
  for (let seed = 1; seed <= 40; seed++) for (const event of ['bandits', 'varmints', 'band'] as const) {
    const leg = legOf(derivedRng(seed, 'leg'), event, 0, [1, 1, 1, 1], 1);
    assert.ok(leg.monsters.length >= 1 && leg.monsters.length <= foeCap(4, 1), `${seed} ${event}: ${leg.monsters}`);
    assert.ok(leg.monsters.every((m) => ROAD_POOLS[event].includes(m)), `${event}: ${leg.monsters}`);
    assert.ok(leg.monsters.reduce((xp, m) => xp + monster(m).xp, 0) <= temperedBudget([1, 1, 1, 1], 'low'));
    assert.equal(leg.treasure === null, event === 'varmints');
    assert.deepEqual(leg.wares, []);
  }
  assert.ok(ROAD_POOLS.bandits.includes('bandit') && ROAD_POOLS.varmints.includes('wolf') && ROAD_POOLS.band.includes('goblin-warrior'));
  assert.deepEqual(ROAD_MONSTERS, [...ROAD_POOLS.bandits, ...ROAD_POOLS.varmints, ...ROAD_POOLS.band]);
});

test('a wandering vendor has a Potion of Healing and SRD gear, all at SRD prices; a quiet stretch has nothing', () => {
  const vendor = legOf(derivedRng(3, 'leg'), 'vendor', 9, [1, 1], 1);
  assert.equal(vendor.wares[0], 'potion-of-healing');
  assert.equal(new Set(vendor.wares).size, 5);
  assert.ok(vendor.wares.every((id) => items().get(id)!.cost > 0));
  assert.deepEqual([vendor.monsters, vendor.treasure, vendor.roll], [[], null, 9]);
  assert.deepEqual(legOf(derivedRng(3, 'leg'), 'quiet', 12, [1, 1], 1), { event: 'quiet', roll: 12, monsters: [], treasure: null, wares: [] });
});

test('on a stretch, foes are met: their attitude is rolled, and Hostile ones bar the way; a vendor or a quiet road is told', () => {
  const dungeon = startDungeon('fixed', 3, [1, 1], 4);
  const onRoad = (leg: ReturnType<typeof legOf>) => ({ ...dungeon, trek: { terrain: 'a forest road', leg: 0, legs: [leg, leg] } });
  const bandits = { event: 'bandits' as const, roll: 2, monsters: ['bandit', 'bandit'], treasure: null, wares: [] };
  const met = meetOnTheRoad(party, onRoad(bandits));
  assert.notEqual(met.party.rng, party.rng, 'the attitude is rolled');
  assert.deepEqual(met.dungeon.facing!.monsters, ['bandit', 'bandit']);
  assert.match(met.lines[0], /^On the road \(d12: 2\): bandits\. Bandit ×2: (hostile|indifferent|friendly) \(2d6: \d+\)\. They (bar the way|watch and wait)\.$/);
  assert.equal(met.lines[0].endsWith('bar the way.'), met.dungeon.facing!.attitude === 'hostile');
  const vendor = meetOnTheRoad(party, onRoad({ event: 'vendor', roll: 9, monsters: [], treasure: null, wares: ['potion-of-healing', 'rope'] }));
  assert.deepEqual([vendor.lines, vendor.dungeon.facing, vendor.party], [['On the road (d12: 9): a wandering vendor, selling Potion of Healing (50 gp), Rope (1 gp).'], undefined, party]);
  assert.deepEqual(meetOnTheRoad(party, onRoad({ event: 'quiet', roll: 11, monsters: [], treasure: null, wares: [] })).lines, ['On the road (d12: 11): a quiet stretch.']);
});

test('with no living hero to meet them, a stretch holds no foes', () => {
  assert.deepEqual(legOf(seededRng(5), 'bandits', 2, [], 1), { event: 'bandits', roll: 2, monsters: [], treasure: null, wares: [] });
});
