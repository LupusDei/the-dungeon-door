/** A finished level-1 sheet for tests: Bryn, a dwarf fighter soldier. */
import type { CharacterSheet } from './sheet.ts';

export const SAMPLE: CharacterSheet = {
  version: 1, name: 'Bryn', level: 1, xp: 0, classId: 'fighter', speciesId: 'dwarf', backgroundId: 'soldier', subclassId: null,
  size: 'Medium', speed: 30,
  abilityScores: { str: 17, dex: 14, con: 14, int: 12, wis: 10, cha: 8 }, abilityRolls: null,
  proficiencyBonus: 2, hpRolls: [10], hitDiceSpent: 0, exhaustion: 0, resourcesUsed: {}, maxHp: 13, hp: 13, armorClass: 16,
  savingThrows: ['str', 'con'], skills: ['athletics', 'intimidation', 'perception', 'survival'], otherProficiencies: ['all-armor', 'shields', 'simple-weapons', 'martial-weapons'],
  saveBonuses: { str: 5, dex: 2, con: 4, int: 1, wis: 0, cha: -1 }, skillBonuses: { athletics: 5 }, passivePerception: 12,
  equipment: [{ id: 'chain-mail', name: 'Chain Mail', count: 1 }], gp: 4, pendingChoices: [],
  traits: ['dwarven-toughness'], feat: 'Savage Attacker', feats: [], features: ['Fighting Style', 'Second Wind', 'Weapon Mastery'], spellcasting: null,
};
