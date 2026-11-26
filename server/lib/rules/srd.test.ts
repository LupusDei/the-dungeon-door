import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { once, parseTable, srd } from './srd.ts';

const data = srd();

test('the SRD has the twelve classes with their hit dice and saving throws', () => {
  assert.equal(data.classes.size, 12);
  const fighter = data.classes.get('fighter')!;
  assert.equal(fighter.hitDie, 10);
  assert.deepEqual(fighter.saves, ['str', 'con']);
  assert.ok(fighter.proficiencies.includes('all-armor'));
});

test('a class lists its proficiency choices as groups of ids', () => {
  const [skills] = data.classes.get('fighter')!.choices;
  assert.equal(skills.choose, 2);
  assert.equal(skills.from.length, 9);
  assert.ok(skills.from.includes('skill-athletics'));
  assert.equal(data.classes.get('bard')!.choices.length, 2);
});

test('a class lists its starting equipment options as items, gold and choices still to make', () => {
  const options = data.classes.get('fighter')!.equipment;
  assert.equal(options.length, 3);
  assert.deepEqual(options[0].items.find((i) => i.id === 'javelin'), { id: 'javelin', name: 'Javelin', count: 8 });
  assert.equal(options[0].gp, 4);
  assert.deepEqual(options[2], { items: [], gp: 155, pending: [] });
  assert.deepEqual(data.classes.get('monk')!.equipment[0].pending, ['Artisan’s Tools or Musical Instrument']);
});

test('a background gives three abilities, its proficiencies, a feat and equipment', () => {
  const soldier = data.backgrounds.get('soldier')!;
  assert.deepEqual(soldier.abilities, ['str', 'dex', 'con']);
  assert.ok(soldier.proficiencies.includes('skill-athletics'));
  assert.equal(soldier.feat, 'Savage Attacker');
  assert.deepEqual(soldier.equipment[0].pending, ['one of Gaming Sets']);
  assert.equal(soldier.equipment[1].gp, 50);
});

test('a species gives its sizes, speed and traits', () => {
  assert.deepEqual(data.species.get('tiefling')!.sizes, ['Small', 'Medium']);
  const goliath = data.species.get('goliath')!;
  assert.deepEqual([goliath.sizes, goliath.speed], [['Medium'], 35]);
  assert.ok(data.species.get('dwarf')!.traits.includes('dwarven-toughness'));
});

test('armor says how it sets AC', () => {
  assert.deepEqual(data.armor.get('chain-mail'), {
    id: 'chain-mail', name: 'Chain Mail', category: 'heavy', base: 16, dexBonus: false, maxDexBonus: 0, strengthMinimum: 13, stealthDisadvantage: true,
  });
  assert.equal(data.armor.get('leather-armor')!.maxDexBonus, null);
  assert.equal(data.armor.get('shield')!.category, 'shield');
});

test('weapons carry their damage, properties and range', () => {
  const longbow = data.weapons.get('longbow')!;
  assert.deepEqual(
    [longbow.category, longbow.range, longbow.damage, longbow.damageType, longbow.normalRange, longbow.longRange],
    ['martial', 'ranged', '1d8', 'piercing', 150, 600],
  );
  assert.equal(data.weapons.get('longsword')!.versatileDamage, '1d10');
  assert.equal(data.weapons.get('dagger')!.versatileDamage, null);
  assert.deepEqual([data.weapons.get('morningstar')!.normalRange, data.weapons.get('morningstar')!.longRange], [5, null]);
});

test('each skill belongs to an ability', () => {
  assert.equal(data.skills.size, 18);
  assert.equal(data.skills.get('stealth'), 'dex');
  assert.equal(data.skills.get('religion'), 'int');
});

test('spells know their level and which classes have them', () => {
  const missile = data.spells.get('magic-missile')!;
  assert.equal(missile.level, 1);
  assert.ok(missile.classes.includes('wizard'));
  assert.ok([...data.spells.values()].some((s) => s.level === 0 && s.classes.includes('cleric')));
});

test('a casting class has cantrips, prepared spells and slots by level; others have none', () => {
  assert.deepEqual(data.spellcasting.get('cleric')!.byLevel[0], { cantrips: 3, prepared: 4, slots: [2, 0, 0, 0, 0, 0, 0, 0, 0] });
  assert.equal(data.spellcasting.get('fighter'), undefined);
});

test('point buy costs come from the SRD table', () => {
  assert.equal(data.pointCosts.get(8), 0);
  assert.equal(data.pointCosts.get(15), 9);
  assert.equal(data.pointCosts.get(16), undefined);
});

test('a malformed table fails when it is loaded, naming the table', () => {
  const schema = z.object({ hitDie: z.number() });
  assert.throws(() => parseTable('classes', schema, { records: [{ hitDie: 'd8' }] }), /SRD table classes is malformed: records\.0\.hitDie/);
  assert.deepEqual(parseTable('classes', schema, { records: [{ hitDie: 8 }] }), [{ hitDie: 8 }]);
});

test('the tables are parsed once and shared', () => {
  assert.equal(srd(), data);
});

test('once runs its loader on the first call only', () => {
  let calls = 0;
  const value = once(() => ++calls);
  assert.deepEqual([value(), value(), calls], [1, 1, 1]);
});

test('the advancement table: XP thresholds and proficiency bonus for levels 1 to 20', () => {
  const { advancement } = srd();
  assert.equal(advancement.length, 20);
  assert.deepEqual(advancement[0], { level: 1, xp: 0, proficiencyBonus: 2 });
  assert.deepEqual(advancement[4], { level: 5, xp: 6500, proficiencyBonus: 3 });
  assert.deepEqual(advancement[19], { level: 20, xp: 355000, proficiencyBonus: 6 });
});

test('classes carry their features by level, their subclasses and the level a subclass is chosen', () => {
  const fighter = srd().classes.get('fighter')!;
  assert.equal(fighter.levels.length, 20);
  assert.ok(fighter.levels[0].features.some((f) => f.name === 'Second Wind'));
  assert.deepEqual(fighter.levels[3].features.map((f) => f.id), ['fighter-ability-score-improvement']);
  assert.deepEqual([fighter.subclasses, fighter.subclassLevel], [['champion'], 3]);
  const champion = srd().subclasses.get('champion')!;
  assert.deepEqual([champion.classId, champion.features[0]], ['fighter', { name: 'Improved Critical', level: 3 }]);
});

test('feats: type, level, ability prerequisite and the ability increase they grant', () => {
  const { feats } = srd();
  assert.deepEqual(feats.get('grappler'), {
    id: 'grappler', name: 'Grappler', type: 'general', minLevel: 4,
    prerequisite: { abilities: ['str', 'dex'], minimum: 13 }, increase: { from: ['str', 'dex'], max: 20 }, needsSpellcasting: false,
  });
  assert.deepEqual(feats.get('boon-of-fate')!.increase, { from: ['str', 'dex', 'con', 'int', 'wis', 'cha'], max: 30 });
  assert.deepEqual(feats.get('boon-of-spell-recall')!.increase, { from: ['int', 'wis', 'cha'], max: 30 });
  assert.equal(feats.get('boon-of-spell-recall')!.needsSpellcasting, true);
  assert.deepEqual([feats.get('alert')!.minLevel, feats.get('alert')!.increase, feats.get('alert')!.prerequisite], [1, null, null]);
});

test('every epic boon and Grappler grant a +1 the engine can read', () => {
  const granting = [...srd().feats.values()].filter((f) => f.type === 'epic-boon' || f.id === 'grappler');
  assert.equal(granting.length, 8);
  for (const feat of granting) assert.ok(feat.increase && feat.increase.from.length > 0 && feat.increase.from.every(Boolean), feat.id);
  assert.deepEqual(srd().feats.get('boon-of-irresistible-offense')!.increase!.from, ['str', 'dex']);
});

test('spells carry their mechanics: attack or save, damage, upcasting, healing, area, concentration', () => {
  const { spells } = srd();
  assert.deepEqual(spells.get('fireball'), {
    id: 'fireball', name: 'Fireball', level: 3, classes: ['sorcerer', 'wizard'], concentration: false,
    attack: null, save: 'dex', halfOnSave: true, damage: { dice: '8d6', type: 'fire' }, upcastDice: '1d6',
    healing: null, area: { shape: 'Sphere', feet: 20 },
  });
  const bolt = spells.get('fire-bolt')!;
  assert.deepEqual([bolt.attack, bolt.save, bolt.damage, bolt.upcastDice, bolt.area], ['ranged', null, { dice: '1d10', type: 'fire' }, null, null]);
  assert.deepEqual(spells.get('shatter')!.upcastDice, '1d8', 'read from the description when the higher-level field is empty');
  assert.equal(spells.get('ice-knife')!.upcastDice, null, 'its extra d6s belong to a second, cold part');
  assert.deepEqual(spells.get('cure-wounds')!.healing, { dice: '2d8', upcastDice: '2d8' });
  assert.deepEqual([spells.get('bless')!.concentration, spells.get('bless')!.damage], [true, null]);
  assert.equal(spells.get('hold-person')!.save, 'wis');
  assert.equal(spells.get('hold-person')!.halfOnSave, false);
});

test('cantrips scale with character level: more dice, or more beams', () => {
  const { cantripScaling } = srd();
  assert.deepEqual(cantripScaling.get('fire-bolt'), [{ level: 5, dice: '2d10', beams: null }, { level: 11, dice: '3d10', beams: null }, { level: 17, dice: '4d10', beams: null }]);
  assert.deepEqual(cantripScaling.get('eldritch-blast')!.map((s) => s.beams), [2, 3, 4]);
  assert.deepEqual(cantripScaling.get('spare-the-dying'), [], 'non-damage upgrades are left to the DM');
});
