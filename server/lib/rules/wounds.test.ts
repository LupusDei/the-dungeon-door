import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bodyOf, fillOf, vigorOf, woundOf, WOUND_RUNGS } from './wounds.ts';

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
  assert.deepEqual(words('undead'), ['Whole', 'Torn', 'Gouged', 'Crumbling', 'Falling apart', 'Coming undone', 'Destroyed']);
  assert.deepEqual(words('construct'), ['Intact', 'Scuffed', 'Dented', 'Cracked', 'Breaking', 'Failing', 'Destroyed']);
  assert.deepEqual(words('ooze'), ['Whole', 'Rippling', 'Seeping', 'Shrinking', 'Sloughing', 'Dissolving', 'Destroyed']);
});

test('a monster’s body from its SRD type', () => {
  assert.deepEqual(['Undead', 'construct', 'Ooze', 'humanoid (goblinoid)', 'beast'].map(bodyOf), ['undead', 'construct', 'ooze', 'flesh', 'flesh']);
});

test('a foe\u2019s gauge is fuzzy: a fill from 0 to 1 inside its wound\u2019s band, never rising as it is hurt, the same for the same state, and not its share of hit points', () => {
  const BAND: Record<string, [number, number]> = { Unhurt: [1, 1], Scratched: [0.75, 1], Bleeding: [0.5, 0.75], Bloodied: [0.25, 0.5], Staggering: [0.1, 0.25], Gasping: [0, 0.1], Dead: [0, 0] };
  const offShare: number[] = [];
  for (const maxHp of [7, 11, 22, 40, 136]) for (let fight = 0; fight < 25; fight++) {
    const salt = `fight ${fight}|foe-${maxHp}`;
    let last = 1;
    for (let hp = maxHp; hp >= 0; hp--) {
      const fill = fillOf(hp, maxHp, salt);
      const [lo, hi] = BAND[woundOf({ hp, maxHp })];
      assert.ok(fill >= lo && fill <= hi, `${hp}/${maxHp} ${woundOf({ hp, maxHp })}: ${fill}`);
      assert.ok(fill <= last, `${hp}/${maxHp}: ${fill} after ${last}`);
      assert.equal(fill, fillOf(hp, maxHp, salt), 'stable');
      assert.equal(fill, Math.round(fill * 1000) / 1000, 'three decimals');
      offShare.push(fill - hp / maxHp);
      last = fill;
    }
    assert.ok(fillOf(1, maxHp, salt) > 0, 'a living foe never shows an empty gauge');
  }
  assert.ok(offShare.filter((d) => Math.abs(d) > 0.02).length > offShare.length / 3, 'mostly off its true share');
  assert.ok(offShare.filter((d) => d > 0.02).length > offShare.length / 10, 'sometimes fuller than its true share');
  assert.ok(offShare.filter((d) => d < -0.02).length > offShare.length / 10, 'sometimes emptier than its true share');
  const fills = new Set(Array.from({ length: 20 }, (_, f) => fillOf(13, 40, `fight ${f}`)));
  assert.ok(fills.size > 10, 'the same wound looks different from fight to fight');
});
