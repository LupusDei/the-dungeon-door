import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type CharacterSheet, parseCharacterSheet } from './sheet.ts';

export const SAMPLE: CharacterSheet = {
  version: 1, name: 'Bryn', level: 1, classId: 'fighter', speciesId: 'dwarf', backgroundId: 'soldier',
  size: 'Medium', speed: 30,
  abilityScores: { str: 17, dex: 14, con: 14, int: 12, wis: 10, cha: 8 }, abilityRolls: null,
  proficiencyBonus: 2, maxHp: 13, hp: 13, armorClass: 16,
  savingThrows: ['str', 'con'], skills: ['athletics', 'intimidation', 'perception', 'survival'], otherProficiencies: ['all-armor'],
  saveBonuses: { str: 5, dex: 2, con: 4, int: 1, wis: 0, cha: -1 }, skillBonuses: { athletics: 5 }, passivePerception: 12,
  equipment: [{ id: 'chain-mail', name: 'Chain Mail', count: 1 }], gp: 4, pendingChoices: [],
  traits: ['dwarven-toughness'], feat: 'Savage Attacker', spellcasting: null,
};

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
