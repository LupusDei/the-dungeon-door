import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SAMPLE } from './sheet.fixture.ts';
import { parseCharacterSheet } from './sheet.ts';


test('a sheet survives a trip through JSON and the parser unchanged', () => {
  assert.deepEqual(parseCharacterSheet(JSON.parse(JSON.stringify(SAMPLE))), SAMPLE);
});

test('a caster sheet keeps its spellcasting', () => {
  const caster = { ...SAMPLE, spellcasting: { ability: 'wis', saveDc: 13, attackBonus: 5, slots: [2, 0, 0, 0, 0, 0, 0, 0, 0], cantrips: ['guidance'], prepared: ['bless'], expended: [1, 0, 0, 0, 0, 0, 0, 0, 0], concentratingOn: 'bless' } };
  assert.deepEqual(parseCharacterSheet(caster), caster);
});

test('a sheet of another version is refused, naming the field', () => {
  assert.throws(() => parseCharacterSheet({ ...SAMPLE, version: 2 }), /version: /);
});

test('a sheet cannot have more hit points than its maximum', () => {
  assert.throws(() => parseCharacterSheet({ ...SAMPLE, hp: 14 }), /hp: hit points cannot exceed the maximum/);
  assert.equal(parseCharacterSheet({ ...SAMPLE, hp: 0 }).hp, 0);
});

test('a sheet with an ability score out of range is refused', () => {
  assert.throws(() => parseCharacterSheet({ ...SAMPLE, abilityScores: { ...SAMPLE.abilityScores, str: 31 } }), /abilityScores\.str/);
});

test('a sheet has a level from 1 to 20 and one hit die roll per level', () => {
  assert.equal(parseCharacterSheet({ ...SAMPLE, level: 20, hpRolls: Array(20).fill(5), hp: 1 }).level, 20);
  assert.throws(() => parseCharacterSheet({ ...SAMPLE, level: 21, hpRolls: Array(21).fill(5) }), /level: /);
  assert.throws(() => parseCharacterSheet({ ...SAMPLE, level: 0, hpRolls: [] }), /level: /);
  assert.throws(() => parseCharacterSheet({ ...SAMPLE, level: 2 }), /hpRolls: one hit die roll per level/);
  assert.throws(() => parseCharacterSheet({ ...SAMPLE, xp: -1 }), /xp: /);
});

test('a caster cannot have spent more slots than it has', () => {
  const casting = { ability: 'wis', saveDc: 13, attackBonus: 5, slots: [2, 0, 0, 0, 0, 0, 0, 0, 0], cantrips: [], prepared: [], expended: [3, 0, 0, 0, 0, 0, 0, 0, 0], concentratingOn: null };
  assert.throws(() => parseCharacterSheet({ ...SAMPLE, spellcasting: casting }), /spellcasting\.expended: no more slots can be spent than there are/);
});
