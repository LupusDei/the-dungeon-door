import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SAMPLE } from './sheet.fixture.ts';
import { parseCharacterSheet } from './sheet.ts';


test('a sheet survives a trip through JSON and the parser unchanged', () => {
  assert.deepEqual(parseCharacterSheet(JSON.parse(JSON.stringify(SAMPLE))), SAMPLE);
});

test('a caster sheet keeps its spellcasting', () => {
  const caster = { ...SAMPLE, spellcasting: { ability: 'wis', saveDc: 13, attackBonus: 5, slots: [2, 0, 0, 0, 0, 0, 0, 0, 0], cantrips: ['guidance'], prepared: ['bless'] } };
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
