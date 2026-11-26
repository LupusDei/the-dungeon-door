import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import conditionsJson from '../../data/srd/5.2/conditions.json' with { type: 'json' };
import { buildCharacter, quickChoices } from './character.ts';
import { CONDITIONS, heroCombatant, monsterCombatant } from './combatant.ts';
import { monster } from './monsters.ts';
import { seededRng } from './rng.ts';
import { parseTable } from './srd.ts';
import { SAMPLE } from './sheet.fixture.ts';

test('the conditions are exactly the SRD conditions', () => {
  const srdConditions = parseTable('conditions', z.object({ index: z.string() }), conditionsJson).map((c) => c.index);
  assert.deepEqual([...CONDITIONS], srdConditions);
});

test('a hero enters combat with its sheet numbers', () => {
  const hero = heroCombatant('p1', SAMPLE);
  assert.deepEqual(
    [hero.id, hero.name, hero.side, hero.ac, hero.hp, hero.maxHp, hero.initiative, hero.status, hero.xp],
    ['p1', 'Bryn', 'party', 16, 13, 13, 2, 'up', 0],
  );
  assert.deepEqual(hero.saveBonuses, SAMPLE.saveBonuses);
  assert.deepEqual(hero.deathSaves, { successes: 0, failures: 0 });
});

test('a hero attacks with each weapon it carries: STR for melee, DEX for ranged, the better for finesse', () => {
  const sheet = { ...SAMPLE, equipment: [
    { id: 'greatsword', name: 'Greatsword', count: 1 },
    { id: 'longbow', name: 'Longbow', count: 1 },
    { id: 'rapier', name: 'Rapier', count: 1 },
    { id: 'rope', name: 'Rope', count: 1 },
  ] };
  const [greatsword, longbow, rapier] = heroCombatant('p1', sheet).attacks;
  assert.deepEqual(greatsword, { name: 'Greatsword', bonus: 5, ranged: false, damage: [{ dice: '2d6+3', type: 'slashing' }] });
  assert.deepEqual(longbow, { name: 'Longbow', bonus: 4, ranged: true, damage: [{ dice: '1d8+2', type: 'piercing' }] });
  assert.equal(rapier.bonus, 5, 'finesse uses STR 17 over DEX 14');
  assert.equal(heroCombatant('p1', sheet).attacks.length, 3, 'rope is not a weapon');
});

test('a weapon the hero is not proficient with adds no proficiency bonus', () => {
  const wizard = { ...SAMPLE, otherProficiencies: ['simple-weapons', 'scimitars'], equipment: [
    { id: 'longsword', name: 'Longsword', count: 1 }, { id: 'scimitar', name: 'Scimitar', count: 1 }, { id: 'dagger', name: 'Dagger', count: 2 },
  ] };
  assert.deepEqual(heroCombatant('p1', wizard).attacks.map((a) => a.bonus), [3, 5, 5]);
});

test('a hero with no weapon has an Unarmed Strike', () => {
  const unarmed = heroCombatant('p1', { ...SAMPLE, equipment: [] }).attacks;
  assert.deepEqual(unarmed, [{ name: 'Unarmed Strike', bonus: 5, ranged: false, damage: [{ dice: '4', type: 'bludgeoning' }] }]);
  const weak = heroCombatant('p1', { ...SAMPLE, equipment: [], abilityScores: { ...SAMPLE.abilityScores, str: 8 } }).attacks[0];
  assert.deepEqual(weak.damage, [{ dice: '0', type: 'bludgeoning' }]);
});

test('a damage bonus of zero or less is written the SRD way', () => {
  const dagger = [{ id: 'dagger', name: 'Dagger', count: 1 }];
  const at = (str: number, dex: number) => heroCombatant('p', { ...SAMPLE, equipment: dagger, abilityScores: { ...SAMPLE.abilityScores, str, dex } }).attacks[0].damage[0].dice;
  assert.equal(at(10, 10), '1d4');
  assert.equal(at(8, 8), '1d4-1');
  assert.equal(at(12, 8), '1d4+1');
  assert.deepEqual(heroCombatant('p', { ...SAMPLE, equipment: dagger }).attacks.map((a) => a.name), ['Dagger'], 'one weapon, no Unarmed Strike');
});

test('a monster enters combat with its stat block', () => {
  const goblin = monsterCombatant('g1', monster('goblin-warrior'));
  assert.deepEqual(
    [goblin.id, goblin.name, goblin.side, goblin.ac, goblin.hp, goblin.maxHp, goblin.initiative, goblin.xp],
    ['g1', 'Goblin Warrior', 'foes', 15, 10, 10, 2, 50],
  );
  assert.equal(goblin.attacks[0].name, 'Scimitar');
  assert.deepEqual(monsterCombatant('s1', monster('skeleton')).vulnerabilities, ['bludgeoning']);
});

test('any generated hero can enter combat', () => {
  for (let seed = 0; seed < 40; seed++) {
    const hero = heroCombatant(`p${seed}`, buildCharacter(quickChoices(seededRng(seed), { name: 'Q' }), seededRng(seed)));
    assert.ok(hero.attacks.length > 0);
  }
});
