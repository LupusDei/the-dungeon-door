import assert from 'node:assert/strict';
import { test } from 'node:test';
import { averageDice, parseDice, rollDice } from './dice.ts';
import { scriptedRng } from './rng.ts';

test('dice text parses into count, sides and a flat bonus', () => {
  assert.deepEqual(parseDice('2d6+5'), { count: 2, sides: 6, bonus: 5 });
  assert.deepEqual(parseDice('20d10 + 40'), { count: 20, sides: 10, bonus: 40 });
  assert.deepEqual(parseDice('1d4'), { count: 1, sides: 4, bonus: 0 });
  assert.deepEqual(parseDice('d20'), { count: 1, sides: 20, bonus: 0 });
  assert.deepEqual(parseDice('1d8-1'), { count: 1, sides: 8, bonus: -1 });
  assert.deepEqual(parseDice('5'), { count: 0, sides: 0, bonus: 5 });
});

test('text that is not dice is refused', () => {
  assert.throws(() => parseDice('two goblins'), /not dice: two goblins/);
  assert.throws(() => parseDice(''), /not dice/);
});

test('rolling adds the faces and the bonus', () => {
  assert.deepEqual(rollDice(scriptedRng([3, 6]), parseDice('2d6+5')), { total: 14, faces: [3, 6] });
  assert.deepEqual(rollDice(scriptedRng([]), parseDice('5')), { total: 5, faces: [] });
});

test('a critical hit rolls the dice twice but adds the bonus once', () => {
  assert.deepEqual(rollDice(scriptedRng([3, 6, 1, 2]), parseDice('2d6+5'), { critical: true }), { total: 17, faces: [3, 6, 1, 2] });
});

test('a total never goes below zero', () => {
  assert.equal(rollDice(scriptedRng([1]), parseDice('1d4-3')).total, 0);
});

test('the average is the SRD fixed value, rounded down', () => {
  assert.equal(averageDice(parseDice('2d6+5')), 12);
  assert.equal(averageDice(parseDice('3d6')), 10);
  assert.equal(averageDice(parseDice('1d4')), 2);
});
