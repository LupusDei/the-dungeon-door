import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canCast, DIAMOND, revive, TEMPLE_RAISE_DEAD } from './revive.ts';
import { SAMPLE } from './sheet.fixture.ts';
import type { CharacterSheet } from './sheet.ts';
import { RuleViolation } from './violation.ts';

const priest = (slots: number[], prepared = ['revivify', 'raise-dead']): CharacterSheet => ({
  ...SAMPLE, name: 'Mira',
  spellcasting: { ability: 'wis', saveDc: 13, attackBonus: 5, cantrips: [], prepared, slots, expended: slots.map(() => 0), concentratingOn: null },
});

test('Revivify needs it prepared and a 3rd-level slot or higher; Raise Dead a 5th; the caster standing', () => {
  assert.equal(canCast(priest([4, 3, 2, 0, 0, 0, 0, 0, 0]), 'revivify'), true);
  assert.equal(canCast(priest([4, 3, 0, 1, 0, 0, 0, 0, 0]), 'revivify'), true, 'a higher slot will do');
  assert.equal(canCast(priest([4, 3, 0, 0, 0, 0, 0, 0, 0]), 'revivify'), false);
  assert.equal(canCast(priest([4, 3, 3, 3, 0, 0, 0, 0, 0]), 'raise-dead'), false);
  assert.equal(canCast(priest([4, 3, 3, 3, 2, 0, 0, 0, 0]), 'raise-dead'), true);
  assert.equal(canCast(priest([4, 3, 2, 0, 0, 0, 0, 0, 0], ['cure-wounds']), 'revivify'), false, 'not prepared');
  assert.equal(canCast(SAMPLE, 'revivify'), false, 'no spellcasting');
  assert.equal(canCast({ ...priest([4, 3, 2, 0, 0, 0, 0, 0, 0]), hp: 0 }, 'revivify'), false, 'down');
  assert.equal(canCast({ ...priest([4, 3, 2, 0, 0, 0, 0, 0, 0]), dead: true }, 'revivify'), false, 'dead');
  const spent = priest([4, 3, 2, 0, 0, 0, 0, 0, 0]);
  assert.equal(canCast({ ...spent, spellcasting: { ...spent.spellcasting!, expended: [0, 0, 2, 0, 0, 0, 0, 0, 0] } }, 'revivify'), false, 'slots spent');
});

test('revived: 1 HP and no longer dead; Raise Dead leaves -4 on D20 Tests, Revivify nothing', () => {
  const dead = { ...SAMPLE, hp: 0, dead: true };
  const quick = revive(dead, 'revivify');
  assert.deepEqual([quick.hp, Object.hasOwn(quick, 'dead'), Object.hasOwn(quick, 'revivalPenalty')], [1, false, false]);
  assert.equal(revive(dead, 'raise-dead').revivalPenalty, 4);
  assert.throws(() => revive(SAMPLE, 'revivify'), (e: unknown) => e instanceof RuleViolation && /Bryn is not dead/.test(e.message));
  assert.deepEqual([DIAMOND.revivify, DIAMOND['raise-dead'], TEMPLE_RAISE_DEAD], [300, 500, 2500]);
});
