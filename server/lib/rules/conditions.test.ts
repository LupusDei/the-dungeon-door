import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONDITIONS as FROM_COMBAT } from './combatant.ts';
import { CONDITIONS, conditionsOf, endOnLongRest, hasCondition, letTimePass, withCondition } from './conditions.ts';
import { longRest } from './rests.ts';
import { parseCharacterSheet } from './sheet.ts';
import { SAMPLE } from './sheet.fixture.ts';

const poisoned = { condition: 'poisoned' as const, until: { kind: 'time' as const, left: 3600 } };
const netted = { condition: 'restrained' as const, until: { kind: 'escape' as const, ability: 'str' as const, skill: 'athletics', dc: 10 } };

test('one list of the 5.2 conditions, shared with combat', () => {
  assert.equal(CONDITIONS, FROM_COMBAT);
});

test('a hero carries conditions with how they end: after a time, at a long rest, on a save, or by breaking free', () => {
  assert.deepEqual(conditionsOf(SAMPLE), []);
  const s = withCondition(withCondition(SAMPLE, poisoned), netted);
  assert.deepEqual(conditionsOf(s), [poisoned, netted]);
  assert.equal(hasCondition(s, 'poisoned'), true);
  assert.equal(hasCondition(s, 'blinded'), false);
  assert.deepEqual(parseCharacterSheet(s), s, 'the sheet keeps them');
  assert.deepEqual(conditionsOf(withCondition(s, { ...poisoned, until: { kind: 'time', left: 60 } })), [netted, { ...poisoned, until: { kind: 'time', left: 60 } }], 'a new one replaces the old');
});

test('time wears timed conditions off; the others stay', () => {
  const s = withCondition(withCondition(SAMPLE, poisoned), netted);
  const later = letTimePass(s, 600);
  assert.deepEqual(conditionsOf(later.sheet), [{ ...poisoned, until: { kind: 'time', left: 3000 } }, netted]);
  assert.deepEqual(later.ended, []);
  const gone = letTimePass(s, 3600);
  assert.deepEqual([conditionsOf(gone.sheet), gone.ended], [[netted], ['poisoned']]);
});

test('a long rest ends the conditions that last until one (and is part of the 5.2 long rest)', () => {
  const tired = withCondition(withCondition(SAMPLE, { condition: 'frightened', until: { kind: 'long-rest' } }), poisoned);
  assert.deepEqual(conditionsOf(endOnLongRest(tired)), [poisoned]);
  assert.deepEqual(conditionsOf(longRest(tired)), [poisoned]);
});
