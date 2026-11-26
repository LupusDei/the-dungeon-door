import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateDungeon } from './dungeon.ts';
import { dungeonTables } from './dungeonTables.ts';
import { buildEncounter } from './encounter.ts';
import { expand, unexplored, startExplore } from './explore.ts';
import { habitat, kindIdOf } from './habitats.ts';
import { seededRng } from './rng.ts';

const kindIds = () => dungeonTables().kinds.rows.map((r) => r.value.id);

test('each dungeon kind has its own monsters: a crypt has its dead, never a mule, a pony or a shark', () => {
  const crypt = habitat('crypt');
  assert.ok(crypt.includes('skeleton') && crypt.includes('zombie'));
  for (const id of kindIds()) {
    for (const outOfPlace of ['mule', 'pony', 'draft-horse', 'camel', 'reef-shark', 'merfolk-skirmisher', 'eagle']) assert.ok(!habitat(id).includes(outOfPlace), `${outOfPlace} in ${id}`);
  }
  assert.ok(!crypt.includes('goblin-warrior') && habitat('stronghold').includes('goblin-warrior'));
});

test('a dungeon kind is found by its name too', () => {
  assert.deepEqual(kindIds().map((id) => kindIdOf(dungeonTables().kinds.rows.find((r) => r.value.id === id)!.value.name)), kindIds());
});

test('every kind can field a fight for any party, at any level and difficulty', () => {
  for (const id of kindIds()) {
    for (const size of [1, 3, 6]) {
      for (const level of [1, 2, 3, 5, 10, 20]) {
        for (const difficulty of ['low', 'moderate', 'high'] as const) {
          assert.ok(buildEncounter(seededRng(level), Array<number>(size).fill(level), difficulty, habitat(id)).monsters.length > 0);
        }
      }
    }
  }
});

test('the monsters of every room, mapped or explored, belong to its dungeon, two kinds at most', () => {
  const check = (kind: string, monsters: string[]) => {
    const home = habitat(kindIdOf(kind));
    assert.ok(monsters.every((m) => home.includes(m)), `${kind}: ${monsters.join()}`);
    assert.ok(new Set(monsters).size <= 2, monsters.join());
  };
  for (let seed = 1; seed <= 300; seed++) {
    const d = generateDungeon(seed, 'standard', [1, 1, 1]);
    for (const n of Object.values(d.nodes)) if (n.contents?.encounter) check(d.kind, n.contents.encounter.monsters);
  }
  for (let seed = 1; seed <= 40; seed++) {
    let d = startExplore(seed, [2, 2]);
    for (let step = 0; step < 15 && unexplored(d).length; step++) d = expand(d, ...unexplored(d)[0]);
    for (const n of Object.values(d.nodes)) if (n.contents?.encounter) check(d.kind, n.contents.encounter.monsters);
  }
});
