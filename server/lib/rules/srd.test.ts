import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { parseTable, srd } from './srd.ts';

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
