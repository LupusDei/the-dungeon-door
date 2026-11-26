import assert from 'node:assert/strict';
import { test } from 'node:test';
import { atLevel, DEEPER_IN_100, deeper, MAX_DUNGEON_LEVEL, startingLevel } from './depth.ts';
import { scriptedRng, seededRng } from './rng.ts';

test('a dungeon starts at the party’s average level, rounded down, at least 1 and at most 20', () => {
  assert.deepEqual([startingLevel([1, 1, 1, 1]), startingLevel([1, 2]), startingLevel([3, 4, 4]), startingLevel([5]), startingLevel([20, 20])], [1, 1, 3, 5, 20]);
  assert.equal(startingLevel([]), 1, 'no one to average: level 1');
});

test('through a door, a d100 at or under 25 takes the dungeon a level deeper, never past 20', () => {
  assert.equal(DEEPER_IN_100, 25);
  assert.equal(MAX_DUNGEON_LEVEL, 20);
  assert.equal(deeper(scriptedRng([25]), 1), 2);
  assert.equal(deeper(scriptedRng([26]), 1), 1);
  assert.equal(deeper(scriptedRng([1]), 20), 20);
  const rate = Array.from({ length: 2000 }, (_, i) => deeper(seededRng(i), 3)).filter((l) => l === 4).length / 2000;
  assert.ok(Math.abs(rate - 0.25) < 0.03, String(rate));
});

test('an encounter for the party is built as if each hero were at the dungeon’s level', () => {
  assert.deepEqual(atLevel(3, 2), [2, 2, 2]);
  assert.deepEqual(atLevel(0, 4), [4], 'at least one');
});
