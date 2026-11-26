import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ABILITIES,
  abilityModifier,
  applyBackgroundBoost,
  assignScores,
  pointBuyCost,
  roll4d6DropLowest,
  rollAbilityScores,
  scoresFor,
  STANDARD_ARRAY,
} from './abilities.ts';
import { scriptedRng, seededRng } from './rng.ts';
import { RuleViolation } from './violation.ts';

const COSTS = new Map([[8, 0], [9, 1], [10, 2], [11, 3], [12, 4], [13, 5], [14, 7], [15, 9]]);
const ORDER = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
const flat = (n: number) => ({ str: n, dex: n, con: n, int: n, wis: n, cha: n });

test('the modifier is half the distance from 10, rounded down', () => {
  assert.deepEqual([1, 3, 8, 9, 10, 11, 12, 15, 20, 30].map(abilityModifier), [-5, -4, -1, -1, 0, 0, 1, 2, 5, 10]);
});

test('the standard array is 15, 14, 13, 12, 10, 8', () => {
  assert.deepEqual(STANDARD_ARRAY, [15, 14, 13, 12, 10, 8]);
});

test('assigning scores puts each value on the ability in the same position', () => {
  assert.deepEqual(assignScores(STANDARD_ARRAY, ['cha', 'con', 'dex', 'wis', 'int', 'str']), {
    cha: 15, con: 14, dex: 13, wis: 12, int: 10, str: 8,
  });
});

test('assigning scores needs each ability exactly once', () => {
  assert.throws(() => assignScores(STANDARD_ARRAY, ['str', 'str', 'con', 'int', 'wis', 'cha']), RuleViolation);
  assert.throws(() => assignScores(STANDARD_ARRAY, ['str', 'dex', 'con', 'int', 'wis']), /each of the six abilities exactly once/);
});

test('point buy adds up the cost of each score', () => {
  assert.equal(pointBuyCost(flat(8), COSTS), 0);
  assert.equal(pointBuyCost({ str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 8 }, COSTS), 27);
  assert.equal(pointBuyCost({ str: 14, dex: 13, con: 12, int: 11, wis: 10, cha: 9 }, COSTS), 22);
});

test('point buy refuses a score the cost table does not have', () => {
  assert.throws(() => pointBuyCost({ ...flat(8), str: 16 }, COSTS), /point buy scores run from 8 to 15; str is 16/);
  assert.throws(() => pointBuyCost({ ...flat(8), wis: 7 }, COSTS), /wis is 7/);
});

test('4d6 drop the lowest adds the three highest dice', () => {
  assert.equal(roll4d6DropLowest(scriptedRng([6, 1, 5, 4])), 15);
  assert.equal(roll4d6DropLowest(scriptedRng([2, 2, 2, 2])), 6);
  assert.equal(roll4d6DropLowest(scriptedRng([1, 6, 6, 6])), 18);
});

test('rolling ability scores makes six scores of 3 to 18, the same for the same seed', () => {
  const scores = rollAbilityScores(seededRng(3));
  assert.equal(scores.length, 6);
  assert.ok(scores.every((s) => s >= 3 && s <= 18));
  assert.deepEqual(rollAbilityScores(seededRng(3)), scores);
});

test('the standard-array method assigns the array', () => {
  const r = scoresFor({ kind: 'standardArray', order: [...ORDER] }, seededRng(1), COSTS);
  assert.deepEqual(r, { scores: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 }, rolls: null });
});

test('the point-buy method takes the scores when they cost at most 27', () => {
  const scores = { str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 8 };
  assert.deepEqual(scoresFor({ kind: 'pointBuy', scores }, seededRng(1), COSTS), { scores, rolls: null });
});

test('the point-buy method refuses more than 27 points', () => {
  const scores = { str: 15, dex: 15, con: 15, int: 9, wis: 8, cha: 8 };
  assert.throws(() => scoresFor({ kind: 'pointBuy', scores }, seededRng(1), COSTS), /point buy costs 28; the budget is 27/);
});

test('the rolled method rolls six scores and assigns them, keeping the rolls', () => {
  const rolls = rollAbilityScores(seededRng(11));
  const r = scoresFor({ kind: 'rolled', order: [...ORDER].reverse() }, seededRng(11), COSTS);
  assert.deepEqual(r.rolls, rolls);
  assert.equal(r.scores.cha, rolls[0]);
  assert.equal(r.scores.str, rolls[5]);
});

test('a background boost of +2/+1 raises two of the background abilities', () => {
  const s = applyBackgroundBoost(flat(10), ['int', 'wis', 'cha'], { kind: 'twoOne', plusTwo: 'wis', plusOne: 'cha' });
  assert.deepEqual(s, { ...flat(10), wis: 12, cha: 11 });
});

test('a background boost of +1/+1/+1 raises all three background abilities', () => {
  const s = applyBackgroundBoost(flat(10), ['int', 'wis', 'cha'], { kind: 'oneOneOne' });
  assert.deepEqual(s, { ...flat(10), int: 11, wis: 11, cha: 11 });
});

test('a background boost must use the background abilities, two different ones', () => {
  const allowed = ['int', 'wis', 'cha'] as const;
  assert.throws(() => applyBackgroundBoost(flat(10), allowed, { kind: 'twoOne', plusTwo: 'str', plusOne: 'cha' }), /str is not one of this background's abilities \(int, wis, cha\)/);
  assert.throws(() => applyBackgroundBoost(flat(10), allowed, { kind: 'twoOne', plusTwo: 'wis', plusOne: 'str' }), /str is not one of/);
  assert.throws(() => applyBackgroundBoost(flat(10), allowed, { kind: 'twoOne', plusTwo: 'wis', plusOne: 'wis' }), /two different abilities/);
});

test('a background boost cannot raise a score above 20', () => {
  assert.deepEqual(applyBackgroundBoost(flat(18), ['str', 'dex', 'con'], { kind: 'twoOne', plusTwo: 'str', plusOne: 'dex' }).str, 20);
  assert.throws(() => applyBackgroundBoost(flat(19), ['str', 'dex', 'con'], { kind: 'twoOne', plusTwo: 'str', plusOne: 'dex' }), /str would be 21; the most is 20/);
});

test('the six abilities, in sheet order', () => {
  assert.deepEqual(ABILITIES, ['str', 'dex', 'con', 'int', 'wis', 'cha']);
});
