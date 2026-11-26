import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bodyOf, vigorOf, woundOf, WOUND_RUNGS } from './wounds.ts';

test('vigor: six rungs from unhurt to dead, by the share of hit points left (Bloodied at half or less, as in the 2024 rules)', () => {
  const at = (hp: number) => vigorOf(hp, 40);
  assert.equal(WOUND_RUNGS, 6);
  assert.deepEqual([40, 39, 31, 30, 21, 20, 11, 10, 5, 4, 1, 0, -3].map(at), [6, 5, 5, 4, 4, 3, 3, 2, 2, 1, 1, 0, 0]);
  assert.equal(vigorOf(50, 40), 6, 'over the maximum is unhurt');
  assert.equal(vigorOf(1, 1), 6);
});

test('the wound word, for flesh, the undead, constructs and oozes', () => {
  const words = (body?: Parameters<typeof woundOf>[0]['body']) => [40, 35, 25, 20, 8, 3, 0].map((hp) => woundOf({ hp, maxHp: 40, body }));
  assert.deepEqual(words(), ['Unhurt', 'Scratched', 'Bleeding', 'Bloodied', 'Staggering', 'Gasping', 'Dead']);
  assert.deepEqual(words('flesh'), words());
  assert.deepEqual(words('undead'), ['Whole', 'Torn', 'Rent', 'Crumbling', 'Falling apart', 'Coming undone', 'Destroyed']);
  assert.deepEqual(words('construct'), ['Intact', 'Scuffed', 'Dented', 'Cracked', 'Breaking', 'Failing', 'Destroyed']);
  assert.deepEqual(words('ooze'), ['Whole', 'Rippling', 'Seeping', 'Shrinking', 'Sloughing', 'Dissolving', 'Destroyed']);
});

test('a monster’s body from its SRD type', () => {
  assert.deepEqual(['Undead', 'construct', 'Ooze', 'humanoid (goblinoid)', 'beast'].map(bodyOf), ['undead', 'construct', 'ooze', 'flesh', 'flesh']);
});
