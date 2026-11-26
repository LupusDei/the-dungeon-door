import assert from 'node:assert/strict';
import { test } from 'node:test';
import { damageHero } from './dying.ts';
import { SAMPLE } from './sheet.fixture.ts';

test('damage outside combat: HP falls to 0 at the least, and the hero is dying', () => {
  assert.equal(damageHero(SAMPLE, 5).hp, SAMPLE.hp - 5);
  assert.deepEqual([damageHero(SAMPLE, SAMPLE.hp).hp, damageHero(SAMPLE, SAMPLE.hp).dead], [0, undefined]);
  assert.equal(damageHero(SAMPLE, 0), SAMPLE);
});

test('massive damage (5.2): damage left over at 0 HP that reaches the hero\'s maximum kills outright', () => {
  assert.equal(damageHero(SAMPLE, SAMPLE.hp + SAMPLE.maxHp - 1).dead, undefined);
  assert.deepEqual([damageHero(SAMPLE, SAMPLE.hp + SAMPLE.maxHp).hp, damageHero(SAMPLE, SAMPLE.hp + SAMPLE.maxHp).dead], [0, true]);
  const down = { ...SAMPLE, hp: 0 };
  assert.equal(damageHero(down, SAMPLE.maxHp - 1).dead, undefined);
  assert.equal(damageHero(down, SAMPLE.maxHp).dead, true);
});
