import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encounterBudget, monster } from '../rules/monsters.ts';
import { scriptedRng, seededRng } from '../rules/rng.ts';
import { CHECK_EVERY, checksDue, wanderingChecks, wanderingRoll } from './wandering.ts';

test('a check every half hour in a dungeon; the time left over carries to the next', () => {
  assert.equal(CHECK_EVERY, 1800);
  assert.deepEqual(checksDue(0, 600), { checks: 0, since: 600 });
  assert.deepEqual(checksDue(1200, 600), { checks: 1, since: 0 });
  assert.deepEqual(checksDue(1700, 3700), { checks: 3, since: 0 });
  assert.deepEqual(checksDue(100, 2000), { checks: 1, since: 300 });
});

test('the check is a d6: at or under the chance (1, more with noise or spoor) a low band for the party comes; otherwise nothing', () => {
  assert.equal(wanderingRoll(scriptedRng([2]), [3, 3], 1), null);
  const come = wanderingRoll(seededRng(4), [3, 3], 6)!;
  assert.ok(come.monsters.length > 0);
  assert.ok(come.monsters.reduce((xp, id) => xp + monster(id).xp, 0) <= encounterBudget([3, 3], 'low'));
  assert.match(come.line, /^Wandering monsters \(d6: [1-6]\): .+\.$/);
  assert.equal(wanderingRoll(scriptedRng([2, 1, 1, 1, 1, 1, 1, 1, 1]), [3, 3], 2)!.line.startsWith('Wandering monsters (d6: 2)'), true);
  const rolls = Array.from({ length: 600 }, (_, i) => wanderingRoll(seededRng(i), [1], 1)).filter((w) => w !== null).length / 600;
  assert.ok(Math.abs(rolls - 1 / 6) < 0.05, String(rolls));
});

test('several checks stop at the first band; noise brings one even when none is due, at 2 in 6', () => {
  assert.equal(wanderingChecks(scriptedRng([3, 4, 5]), [1], 3, false), null);
  assert.equal(wanderingChecks(scriptedRng([]), [1], 0, false), null);
  assert.equal(wanderingChecks(scriptedRng([3]), [1], 0, true), null);
  assert.ok(wanderingChecks(scriptedRng([2, ...Array(20).fill(1)]), [1], 0, true));
  assert.equal(wanderingChecks(scriptedRng([2, 2]), [1], 2, false), null, 'without noise a 2 is not enough');
  assert.ok(wanderingChecks(scriptedRng([4, 1, ...Array(20).fill(1)]), [1], 2, false), 'the second check');
  assert.equal(wanderingChecks(scriptedRng([2, ...Array(20).fill(1)]), [1], 2, true)!.line.startsWith('Wandering monsters (d6: 2)'), true, 'only the first check is 2 in 6');
});
