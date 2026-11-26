import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heroCombatant } from './combatant.ts';
import { heroResistances, resisted } from './defenses.ts';
import { SAMPLE } from './sheet.fixture.ts';

test('a hero resists what the species grants: dwarven resilience (poison), draconic and fiendish lineage resistances', () => {
  assert.deepEqual(heroResistances({ ...SAMPLE, traits: [] }), []);
  assert.deepEqual(heroResistances({ ...SAMPLE, traits: ['dwarven-resilience', 'stonecunning'] }), ['poison']);
  assert.deepEqual(heroResistances({ ...SAMPLE, traits: ['draconic-damage-resistance-cold'] }), ['cold']);
  assert.deepEqual(heroResistances({ ...SAMPLE, traits: ['lineage-resistance-fire', 'lineage-spell-fire-bolt'] }), ['fire']);
});

test('resisted damage is halved, rounded down; other types are untouched', () => {
  const dwarf = { ...SAMPLE, traits: ['dwarven-resilience'] };
  assert.deepEqual([resisted(dwarf, 7, 'poison'), resisted(dwarf, 7, 'fire'), resisted(SAMPLE, 7, 'poison')], [3, 7, 7]);
});

test('the hero fights with those resistances', () => {
  assert.deepEqual(heroCombatant('p1', { ...SAMPLE, traits: ['dwarven-resilience'] }).resistances, ['poison']);
});
