import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RACES } from '../catalog.ts';
import { abilityModifier } from './abilities.ts';
import { armorClass, buildCharacter, type CharacterChoices, quickChoices, rederive } from './character.ts';
import { scriptedRng, seededRng } from './rng.ts';
import { srd } from './srd.ts';
import { RuleViolation } from './violation.ts';

const rng = () => seededRng(1);

const BRYN: CharacterChoices = {
  name: 'Bryn', classId: 'fighter', speciesId: 'dwarf', backgroundId: 'soldier',
  abilities: { kind: 'standardArray', order: ['str', 'con', 'dex', 'wis', 'int', 'cha'] },
  boost: { kind: 'twoOne', plusTwo: 'str', plusOne: 'con' },
  classChoices: [['skill-perception', 'skill-survival']],
  classEquipment: 0, backgroundEquipment: 0,
};

const MIRA: CharacterChoices = {
  name: 'Mira', classId: 'cleric', speciesId: 'human', backgroundId: 'acolyte',
  abilities: { kind: 'standardArray', order: ['wis', 'con', 'str', 'dex', 'cha', 'int'] },
  boost: { kind: 'twoOne', plusTwo: 'wis', plusOne: 'cha' },
  classChoices: [['skill-medicine', 'skill-history']],
  classEquipment: 0, backgroundEquipment: 1,
  cantrips: ['guidance', 'sacred-flame', 'light'], prepared: ['bless', 'cure-wounds', 'healing-word', 'shield-of-faith'],
};

test('a dwarf fighter soldier gets the level-1 numbers the SRD gives', () => {
  const s = buildCharacter(BRYN, rng());
  assert.deepEqual(s.abilityScores, { str: 17, con: 15, dex: 13, wis: 12, int: 10, cha: 8 });
  assert.equal(s.proficiencyBonus, 2);
  assert.equal(s.maxHp, 13, 'd10 + CON 2 + Dwarven Toughness 1');
  assert.equal(s.hp, 13);
  assert.equal(s.armorClass, 16, 'chain mail');
  assert.equal(s.speed, 30);
  assert.equal(s.size, 'Medium');
  assert.deepEqual(s.savingThrows, ['str', 'con']);
  assert.deepEqual(s.saveBonuses, { str: 5, dex: 1, con: 4, int: 0, wis: 1, cha: -1 });
  assert.deepEqual(s.skills, ['athletics', 'intimidation', 'perception', 'survival']);
  assert.equal(s.skillBonuses.athletics, 5);
  assert.equal(s.skillBonuses.stealth, 1);
  assert.equal(s.passivePerception, 13);
  assert.equal(s.spellcasting, null);
  assert.equal(s.feat, 'Savage Attacker');
  assert.ok(s.traits.includes('darkvision-120'));
});

test('a new hero starts at level 1 with no XP, its level-1 class features and its hit die as level 1 HP', () => {
  const s = buildCharacter(BRYN, rng());
  assert.deepEqual([s.level, s.xp, s.subclassId, s.feats, s.hpRolls], [1, 0, null, [], [10]]);
  assert.deepEqual([s.hitDiceSpent, s.exhaustion, s.resourcesUsed], [0, 0, {}]);
  assert.deepEqual(s.features, ['Fighting Style', 'Second Wind', 'Weapon Mastery']);
});

test('rederive recomputes every number from level, scores and hit die rolls', () => {
  const mira = buildCharacter(MIRA, rng());
  const scores = { ...mira.abilityScores, wis: mira.abilityScores.wis + 2, con: 15, dex: 14 };
  const s = rederive({ ...mira, level: 5, hpRolls: [8, 5, 1, 8, 4], abilityScores: scores }, srd());
  assert.equal(s.proficiencyBonus, 3);
  assert.equal(s.maxHp, 8 + 5 + 1 + 8 + 4 + 5 * 2, 'each level adds its roll + CON 2');
  assert.equal(s.saveBonuses.wis, abilityModifier(scores.wis) + 3);
  assert.equal(s.saveBonuses.str, abilityModifier(scores.str), 'not proficient: no bonus');
  assert.equal(s.skillBonuses.medicine, abilityModifier(scores.wis) + 3);
  assert.equal(s.passivePerception, 10 + abilityModifier(scores.wis));
  assert.equal(rederive({ ...s, exhaustion: 2 }, srd()).passivePerception, s.passivePerception - 4, 'exhaustion: -2 a level, as on any d20 test (5.2)');
  assert.equal(rederive({ ...s, exhaustion: 2 }, srd()).speed, s.speed, 'the sheet\u2019s speed is the hero\u2019s own');
  assert.equal(s.armorClass, mira.armorClass + 1, 'DEX 14 in chain shirt (max +2) or scale mail');
  assert.deepEqual(s.spellcasting, { ...mira.spellcasting!, saveDc: 8 + 3 + abilityModifier(scores.wis), attackBonus: 3 + abilityModifier(scores.wis), slots: [4, 3, 2, 0, 0, 0, 0, 0, 0] });
});

test('rederive keeps spent slots; a warlock\'s spent pact slots rise with the pact slot level', () => {
  const mira = buildCharacter(MIRA, rng());
  const spent = rederive({ ...mira, level: 3, hpRolls: [8, 5, 5], spellcasting: { ...mira.spellcasting!, expended: [2, 0, 0, 0, 0, 0, 0, 0, 0] } }, srd());
  assert.deepEqual(spent.spellcasting!.expended, [2, 0, 0, 0, 0, 0, 0, 0, 0]);
  const warlock = { ...mira, classId: 'warlock', level: 2, hpRolls: [8, 5], spellcasting: { ...mira.spellcasting!, ability: 'cha' as const, slots: [2, 0, 0, 0, 0, 0, 0, 0, 0], expended: [1, 0, 0, 0, 0, 0, 0, 0, 0] } };
  assert.deepEqual(rederive({ ...warlock, level: 3, hpRolls: [8, 5, 5] }, srd()).spellcasting!.expended, [0, 1, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(rederive({ ...warlock, spellcasting: { ...warlock.spellcasting, expended: [2, 0, 0, 0, 0, 0, 0, 0, 0] }, level: 1, hpRolls: [8] }, srd()).spellcasting!.expended, [1, 0, 0, 0, 0, 0, 0, 0, 0], 'never more than the slots');
});

test('each level gives at least 1 hit point, and Dwarven Toughness adds 1 a level', () => {
  const bryn = buildCharacter(BRYN, rng());
  const frail = rederive({ ...bryn, level: 3, hpRolls: [10, 1, 1], abilityScores: { ...bryn.abilityScores, con: 3 }, traits: [] }, srd());
  assert.equal(frail.maxHp, 10 - 4 + 1 + 1);
  assert.equal(rederive({ ...bryn, level: 2, hpRolls: [10, 6] }, srd()).maxHp, 10 + 6 + 2 * (2 + 1));
});

test('equipment from the class and background options is pooled, with their gold', () => {
  const s = buildCharacter(BRYN, rng());
  assert.ok(s.equipment.some((i) => i.id === 'chain-mail'));
  assert.ok(s.equipment.some((i) => i.id === 'spear'));
  assert.equal(s.gp, 18);
  assert.deepEqual(s.pendingChoices, ['one of Gaming Sets']);
  assert.ok(s.otherProficiencies.includes('all-armor'));
});

test('the same item from two options is counted once with both counts', () => {
  const s = buildCharacter({ ...BRYN, classId: 'rogue', backgroundId: 'criminal', boost: { kind: 'oneOneOne' }, classChoices: [['skill-acrobatics', 'skill-perception', 'skill-deception', 'skill-insight']] }, rng());
  assert.deepEqual(s.equipment.filter((i) => i.id === 'dagger'), [{ id: 'dagger', name: 'Dagger', count: 4 }]);
});

test('taking the gold instead of the gear leaves the hero unarmored', () => {
  const s = buildCharacter({ ...BRYN, classEquipment: 2, backgroundEquipment: 1 }, rng());
  assert.deepEqual(s.equipment, []);
  assert.equal(s.gp, 205);
  assert.equal(s.armorClass, 11);
});

test('a cleric gets armor, shield and level-1 spellcasting', () => {
  const s = buildCharacter(MIRA, rng());
  assert.equal(s.armorClass, 16, 'chain shirt 13 + DEX 1 + shield 2');
  assert.equal(s.maxHp, 10);
  assert.deepEqual(s.spellcasting, {
    ability: 'wis', saveDc: 13, attackBonus: 5, slots: [2, 0, 0, 0, 0, 0, 0, 0, 0],
    cantrips: ['guidance', 'sacred-flame', 'light'], prepared: ['bless', 'cure-wounds', 'healing-word', 'shield-of-faith'],
    expended: [0, 0, 0, 0, 0, 0, 0, 0, 0], concentratingOn: null,
  });
});

test('a monk and a barbarian use Unarmored Defense', () => {
  const monk = buildCharacter({
    name: 'Ash', classId: 'monk', speciesId: 'elf', backgroundId: 'criminal',
    abilities: { kind: 'standardArray', order: ['dex', 'wis', 'con', 'str', 'int', 'cha'] },
    boost: { kind: 'twoOne', plusTwo: 'dex', plusOne: 'con' },
    classChoices: [['skill-acrobatics', 'skill-insight'], ['alchemists-supplies']],
    classEquipment: 1, backgroundEquipment: 1,
  }, rng());
  assert.equal(monk.armorClass, 15, '10 + DEX 3 + WIS 2');
  assert.ok(monk.otherProficiencies.includes('alchemists-supplies'));
  const barbarian = buildCharacter({ ...BRYN, classId: 'barbarian', classChoices: [['skill-perception', 'skill-survival']], classEquipment: 1 }, rng());
  assert.equal(barbarian.armorClass, 13, '10 + DEX 1 + CON 2');
  assert.equal(barbarian.maxHp, 15, 'd12 + CON 2 + Dwarven Toughness 1');
});

test('AC ignores armor and shields the hero is not proficient with', () => {
  const data = srd();
  const scores = { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10 };
  const kit = [{ id: 'chain-mail', name: 'Chain Mail', count: 1 }, { id: 'shield', name: 'Shield', count: 1 }];
  assert.equal(armorClass('wizard', scores, ['simple-weapons'], kit, data), 12);
  assert.equal(armorClass('fighter', scores, ['all-armor', 'shields'], kit, data), 18);
  assert.equal(armorClass('cleric', scores, ['light-armor', 'medium-armor'], [{ id: 'half-plate-armor', name: 'Half Plate', count: 1 }, { id: 'leather-armor', name: 'Leather', count: 1 }], data), 17);
  assert.equal(armorClass('rogue', { ...scores, dex: 20 }, ['light-armor'], [{ id: 'studded-leather-armor', name: 'Studded', count: 1 }], data), 17);
  assert.equal(armorClass('rogue', { ...scores, dex: 20 }, ['light-armor', 'medium-armor'], [{ id: 'breastplate', name: 'Breastplate', count: 1 }], data), 16);
  assert.equal(armorClass('fighter', scores, ['all-armor', 'shields'], [kit[1]], data), 14, 'a shield alone: 10 + DEX 2 + 2');
  assert.equal(armorClass('barbarian', { ...scores, con: 14 }, ['shields'], [kit[1]], data), 16, 'Unarmored Defense with a shield');
  assert.equal(armorClass('monk', { ...scores, wis: 16 }, [], [{ id: 'shield', name: 'Shield', count: 1 }], data), 15, 'a monk is not proficient with shields');
});

test('a Tiefling chooses Small or Medium; other species have their size', () => {
  const tiefling = { ...BRYN, speciesId: 'tiefling' };
  assert.equal(buildCharacter({ ...tiefling, size: 'Small' }, rng()).size, 'Small');
  assert.throws(() => buildCharacter(tiefling, rng()), /choose a size: Small or Medium/);
  assert.throws(() => buildCharacter({ ...tiefling, size: 'Large' }, rng()), /choose a size: Small or Medium/);
  assert.throws(() => buildCharacter({ ...BRYN, size: 'Small' }, rng()), /a Dwarf is Medium/);
  assert.equal(buildCharacter({ ...BRYN, size: 'Medium' }, rng()).size, 'Medium');
});

const refuses = (changes: Partial<CharacterChoices>, message: RegExp, base = BRYN) =>
  assert.throws(() => buildCharacter({ ...base, ...changes }, rng()), (e: unknown) => e instanceof RuleViolation && message.test(e.message));

test('unknown classes, species and backgrounds are refused', () => {
  refuses({ classId: 'necromancer' }, /no class necromancer/);
  refuses({ speciesId: 'half-orc' }, /no species half-orc/);
  refuses({ backgroundId: 'pirate' }, /no background pirate/);
});

test('the forge offers exactly the SRD 5.2 species, so every hero can be built', () => {
  assert.deepEqual(RACES.map((r) => r.id).sort(), [...srd().species.keys()].sort());
  for (const race of RACES) assert.equal(race.name, srd().species.get(race.id)!.name, race.id);
  for (const race of RACES) assert.equal(buildCharacter({ ...BRYN, speciesId: race.id, size: srd().species.get(race.id)!.sizes[0] }, rng()).speciesId, race.id);
});

test('class skill choices must come from the list, in the right number, without repeats', () => {
  refuses({ classChoices: [['skill-arcana', 'skill-survival']] }, /skill-arcana is not a Fighter choice/);
  refuses({ classChoices: [['skill-survival']] }, /choose 2 for Fighter choice 1/);
  refuses({ classChoices: [] }, /Fighter has 1 proficiency choice/);
  refuses({ classChoices: [['skill-survival', 'skill-survival']] }, /skill-survival is chosen twice/);
  refuses({ classChoices: [['skill-athletics', 'skill-survival']] }, /skill-athletics is chosen twice/);
});

test('equipment options must exist', () => {
  refuses({ classEquipment: 3 }, /Fighter has equipment options A to C/);
  refuses({ backgroundEquipment: -1 }, /Soldier has equipment options A to B/);
});

test('casters must pick the right number of spells from their own list', () => {
  refuses({ cantrips: ['guidance', 'light'] }, /choose 3 cantrips/, MIRA);
  refuses({ cantrips: ['guidance', 'light', 'fire-bolt'] }, /fire-bolt is not a Cleric cantrip/, MIRA);
  refuses({ prepared: ['bless', 'bless', 'cure-wounds', 'healing-word'] }, /bless is chosen twice/, MIRA);
  refuses({ prepared: ['bless', 'cure-wounds', 'healing-word', 'magic-missile'] }, /magic-missile is not a Cleric level-1 spell/, MIRA);
  refuses({ prepared: ['bless', 'cure-wounds', 'healing-word', 'guidance'] }, /guidance is not a Cleric level-1 spell/, MIRA);
  refuses({ prepared: undefined }, /choose 4 prepared spells/, MIRA);
  refuses({ cantrips: ['guidance', 'light', 'wish-for-a-pony'] }, /wish-for-a-pony is not a Cleric cantrip/, MIRA);
  refuses({ cantrips: ['light'] }, /Fighter casts no spells/);
  refuses({ prepared: ['bless'] }, /Fighter casts no spells/);
});

test('the background increase is added after point buy, the standard array and rolled scores', () => {
  const boost = { kind: 'twoOne' as const, plusTwo: 'str' as const, plusOne: 'dex' as const };
  const bought = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };
  const raised = { str: 17, dex: 15, con: 13, int: 12, wis: 10, cha: 8 };
  assert.deepEqual(buildCharacter({ ...BRYN, abilities: { kind: 'pointBuy', scores: bought }, boost }, rng()).abilityScores, raised);
  assert.deepEqual(buildCharacter({ ...BRYN, abilities: { kind: 'standardArray', order: ['str', 'dex', 'con', 'int', 'wis', 'cha'] }, boost }, rng()).abilityScores, raised);
  const rolled = buildCharacter({ ...BRYN, abilities: { kind: 'rolled', order: ['str', 'dex', 'con', 'int', 'wis', 'cha'] }, boost }, seededRng(4));
  const rolls = rolled.abilityRolls!;
  assert.deepEqual(rolled.abilityScores, { str: rolls[0] + 2, dex: rolls[1] + 1, con: rolls[2], int: rolls[3], wis: rolls[4], cha: rolls[5] });
  const spread = buildCharacter({ ...BRYN, abilities: { kind: 'pointBuy', scores: bought }, boost: { kind: 'oneOneOne' } }, rng());
  assert.deepEqual([spread.abilityScores.str, spread.abilityScores.dex, spread.abilityScores.con, spread.abilityScores.int], [16, 15, 14, 12]);
  const atCap = buildCharacter({
    ...BRYN, abilities: { kind: 'rolled', order: ['str', 'dex', 'con', 'int', 'wis', 'cha'] }, boost,
  }, scriptedRng([...Array(4).fill(6), ...Array(20).fill(1)]));
  assert.deepEqual([atCap.abilityRolls![0], atCap.abilityScores.str], [18, 20], 'an 18 plus the background\'s +2 is 20, the most');
});

test('a rolled hero records the rolls and is the same for the same seed', () => {
  const choices: CharacterChoices = { ...BRYN, abilities: { kind: 'rolled', order: ['str', 'con', 'dex', 'wis', 'int', 'cha'] }, boost: { kind: 'oneOneOne' } };
  const a = buildCharacter(choices, seededRng(5));
  assert.equal(a.abilityRolls?.length, 6);
  assert.deepEqual(buildCharacter(choices, seededRng(5)), a);
});

test('quick choices make a legal hero for every class, species and background', () => {
  const data = srd();
  let seed = 0;
  for (const classId of data.classes.keys()) for (const speciesId of data.species.keys()) for (const backgroundId of data.backgrounds.keys()) {
    const choices = quickChoices(seededRng(seed++), { name: 'Test', classId, speciesId, backgroundId });
    const sheet = buildCharacter(choices, seededRng(seed));
    assert.deepEqual([sheet.classId, sheet.speciesId, sheet.backgroundId], [classId, speciesId, backgroundId]);
  }
});

test('quick choices take the gear, not the gold', () => {
  const sheet = buildCharacter(quickChoices(seededRng(2), { name: 'Quill', classId: 'wizard', backgroundId: 'sage' }), rng());
  assert.equal(sheet.gp, 13, 'wizard option A 5 gp + sage option A 8 gp');
  assert.ok(sheet.equipment.some((i) => i.id === 'spellbook'));
});

test('quick choices refuse an id that is given but unknown, even an empty one', () => {
  assert.throws(() => quickChoices(rng(), { name: 'X', classId: '' }), /there is no class $/);
  assert.throws(() => quickChoices(rng(), { name: 'X', speciesId: '' }), /there is no species $/);
  assert.throws(() => quickChoices(rng(), { name: 'X', backgroundId: '' }), /there is no background $/);
});

test('quick choices fill in what was left out, the same way for the same seed', () => {
  const a = quickChoices(seededRng(8), { name: 'Pip' });
  assert.deepEqual(quickChoices(seededRng(8), { name: 'Pip' }), a);
  assert.notDeepEqual(quickChoices(seededRng(9), { name: 'Pip' }), a);
  assert.ok(srd().classes.has(a.classId));
  const sheet = buildCharacter(a, rng());
  assert.equal(sheet.abilityScores[srd().classes.get(a.classId)!.primary[0]] >= 15, true, 'the best score goes to the class’s primary ability');
});

test('a class’s primary abilities come from the SRD: Strength for a fighter, Dexterity and Wisdom for a monk', () => {
  const primary = (id: string) => srd().classes.get(id)!.primary;
  assert.deepEqual([primary('fighter'), primary('monk'), primary('wizard'), primary('paladin')], [['str'], ['dex', 'wis'], ['int'], ['str', 'cha']]);
});

test('quick choices put the best scores in the class’s primary abilities, then Constitution, and the +2 where the background allows', () => {
  for (const cls of srd().classes.values()) {
    for (let seed = 0; seed < 12; seed++) {
      const choices = quickChoices(seededRng(seed), { name: 'Test', classId: cls.id });
      assert.equal(choices.abilities.kind, 'standardArray');
      const order = (choices.abilities as { order: string[] }).order;
      assert.deepEqual(order.slice(0, cls.primary.length + 1), [...cls.primary, 'con'], cls.id);
      const background = srd().backgrounds.get(choices.backgroundId)!;
      const boost = choices.boost as { plusTwo: string; plusOne: string };
      if (background.abilities.includes(cls.primary[0])) assert.equal(boost.plusTwo, cls.primary[0], `${cls.id} ${background.id}`);
      if (background.abilities.includes('con') && boost.plusTwo !== 'con') assert.equal(boost.plusOne, 'con', `${cls.id} ${background.id}`);
    }
  }
});

test('a hero who can cast a healing spell at level 1 has one prepared: Cure Wounds, else Healing Word', () => {
  for (const classId of ['cleric', 'bard', 'druid', 'paladin', 'ranger']) {
    for (let seed = 0; seed < 12; seed++) {
      const prepared = quickChoices(seededRng(seed), { name: 'Test', classId }).prepared;
      assert.ok(prepared!.includes('cure-wounds'), `${classId}: ${prepared!.join()}`);
      assert.equal(new Set(prepared).size, prepared!.length);
    }
  }
  assert.ok(!quickChoices(seededRng(1), { name: 'Test', classId: 'wizard' }).prepared!.some((p) => p === 'cure-wounds' || p === 'healing-word'));
  for (const classId of ['wizard', 'sorcerer']) {
    for (let seed = 0; seed < 5; seed++) assert.equal(quickChoices(seededRng(seed), { name: 'Test', classId }).prepared![0], 'magic-missile', `a new ${classId} prepares Magic Missile first`);
  }
});
