import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildEncounter, candidates, composeEncounter, foeCap, temperedBudget, worthwhile } from './encounter.ts';
import type { Monster } from './monsters.ts';
import { scriptedRng } from './rng.ts';
import { encounterBudget, monster } from './monsters.ts';
import { seededRng } from './rng.ts';

test('an encounter spends no more than the party’s XP budget, and at least half of it', () => {
  for (let seed = 0; seed < 30; seed++) {
    const e = buildEncounter(seededRng(seed), [1, 1, 1, 1], 'moderate');
    assert.equal(e.budget, temperedBudget([1, 1, 1, 1], 'moderate'));
    assert.ok(e.xp <= e.budget && e.xp >= e.budget / 2, `seed ${seed}: ${e.xp} of ${e.budget}`);
    assert.equal(e.xp, e.monsters.reduce((sum, m) => sum + monster(m).xp, 0));
  }
});

test('an encounter is the same for the same seed and differs across seeds', () => {
  const a = buildEncounter(seededRng(4), [2, 2, 3], 'high');
  assert.deepEqual(buildEncounter(seededRng(4), [2, 2, 3], 'high'), a);
  const others = Array.from({ length: 5 }, (_, i) => buildEncounter(seededRng(100 + i), [2, 2, 3], 'high').monsters.join());
  assert.ok(others.some((m) => m !== a.monsters.join()));
});

test('monsters are never above the party’s highest level and always have an attack', () => {
  for (let seed = 0; seed < 30; seed++) {
    for (const id of buildEncounter(seededRng(seed), [3, 1], 'high').monsters) {
      assert.ok(monster(id).cr <= 3, id);
      assert.ok(monster(id).attacks.length > 0, id);
    }
  }
});

test('an encounter can be drawn from a given pool, and has no more foes than its cap', () => {
  const e = buildEncounter(seededRng(1), [5, 5, 5, 5], 'high', ['goblin-warrior']);
  assert.ok(e.monsters.every((id) => id === 'goblin-warrior'));
  assert.equal(e.monsters.length, 8);
  assert.equal(buildEncounter(seededRng(1), [1, 1, 1, 1], 'high', ['goblin-minion']).monsters.length, 2);
});

test('at levels 1 and 2 the 5.2 budget is halved (rounded down); from level 3 it is the table’s', () => {
  assert.equal(temperedBudget([1, 1, 1, 1], 'moderate'), 150);
  assert.equal(temperedBudget([2, 1], 'low'), 75);
  assert.equal(temperedBudget([3, 3], 'moderate'), encounterBudget([3, 3], 'moderate'));
});

test('the foes are capped by the party’s size: half of it at levels 1 and 2, all of it at 3 and 4, twice it from 5, never above eight', () => {
  assert.deepEqual([foeCap(1, 1), foeCap(4, 1), foeCap(5, 2), foeCap(4, 3), foeCap(4, 4), foeCap(3, 5), foeCap(6, 9)], [1, 2, 3, 4, 4, 6, 8]);
});

test('an encounter has at most two kinds of monster', () => {
  for (let seed = 0; seed < 100; seed++) {
    const e = buildEncounter(seededRng(seed), [5, 5, 5, 5, 5, 5], 'high');
    assert.ok(new Set(e.monsters).size <= 2, `seed ${seed}: ${e.monsters.join()}`);
  }
});

test('level-1 rooms are small: no more foes than half the party, none above CR 1', () => {
  for (let seed = 0; seed < 100; seed++) {
    const e = buildEncounter(seededRng(seed), [1, 1, 1, 1], 'moderate');
    assert.ok(e.monsters.length <= 2 && e.monsters.every((id) => monster(id).cr <= 1), `seed ${seed}: ${e.monsters.join()}`);
  }
});

test('a pool with nothing affordable is refused', () => {
  assert.throws(() => buildEncounter(seededRng(1), [1], 'low', ['aboleth']), /no monster in the pool fits a budget of 25 XP/);
});

const kind = (id: string, xp: number) => ({ ...monster('goblin-warrior'), id, xp }) as Monster;

test('candidates have an attack and a CR up to the party’s best level, inclusive', () => {
  assert.deepEqual(candidates([1], ['animated-armor', 'vampire-mist', 'aboleth']).map((m) => m.id), ['animated-armor']);
  assert.deepEqual(candidates([10], ['aboleth']).map((m) => m.id), ['aboleth']);
  assert.deepEqual(candidates([20], ['vampire-mist']), [], 'no attack, no candidate, at any level');
});

test('worthwhile monsters are worth 1/16 of the budget up to all of it; if none are, any will do', () => {
  const kinds = [kind('a', 9), kind('b', 10), kind('c', 160), kind('d', 161)];
  assert.deepEqual(worthwhile(kinds, 160).map((m) => m.id), ['b', 'c']);
  assert.deepEqual(worthwhile([kind('a', 9), kind('b', 10)], 160).map((m) => m.id), ['b']);
  assert.deepEqual(worthwhile([kind('a', 5)], 160).map((m) => m.id), ['a']);
});

test('composing repeats the last kind on a 1 and draws again on a 2, while anything fits', () => {
  const a = kind('a', 50), b = kind('b', 30);
  assert.deepEqual(composeEncounter(scriptedRng([1, 1]), 100, [a, b]), { budget: 100, xp: 100, monsters: ['a', 'a'] });
  assert.deepEqual(composeEncounter(scriptedRng([2, 2, 1]), 100, [a, b]), { budget: 100, xp: 80, monsters: ['b', 'a'] });
  assert.deepEqual(composeEncounter(scriptedRng([2, 1]), 100, [b, a]).monsters, ['a', 'a'], 'a repeat that spends exactly what is left');
  assert.deepEqual(composeEncounter(scriptedRng([1]), 100, [kind('x', 100)]).monsters, ['x'], 'a monster worth exactly the budget');
  const c = kind('c', 10);
  assert.deepEqual(composeEncounter(scriptedRng([3, 2, 1, 1, 1, 1, 1]), 100, [a, b, c]).monsters, ['c', 'a', 'c', 'c', 'c', 'c'], 'a third kind is never drawn: two kinds at most');
  assert.deepEqual(composeEncounter(scriptedRng([1, 1, 1]), 100, [c], 2).monsters, ['c', 'c'], 'no more than the cap');
});
