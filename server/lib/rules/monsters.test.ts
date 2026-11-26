import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DAMAGE_TYPES, encounterBudget, monster, monsters, xpForCr } from './monsters.ts';

test('a monster stat block loads with its AC, HP, CR, XP and attacks', () => {
  const goblin = monster('goblin-warrior');
  assert.deepEqual([goblin.name, goblin.ac, goblin.hp, goblin.hitDice, goblin.cr, goblin.xp, goblin.speed], ['Goblin Warrior', 15, 10, '3d6', 0.25, 50, 30]);
  assert.deepEqual(goblin.attacks[0], { name: 'Scimitar', bonus: 4, ranged: false, damage: [{ dice: '1d6+2', type: 'slashing' }, { dice: '1d4', type: 'slashing', advantageOnly: true }] });
  assert.deepEqual(monster('ankheg').attacks[0].damage.map((d) => d.advantageOnly), [undefined, undefined], 'advantage against a grappled target is not extra damage');
  assert.equal(goblin.attacks[1].ranged, true);
});

test('a monster save is its ability modifier, or its listed bonus when proficient', () => {
  const aboleth = monster('aboleth');
  assert.equal(aboleth.saveBonuses.str, 5);
  assert.equal(aboleth.saveBonuses.dex, 3);
  assert.equal(aboleth.saveBonuses.con, 6);
});

test('a monster carries its resistances, vulnerabilities and immunities', () => {
  const skeleton = monster('skeleton');
  assert.deepEqual(skeleton.vulnerabilities, ['bludgeoning']);
  assert.ok(skeleton.immunities.includes('poison'));
  assert.ok(skeleton.conditionImmunities.includes('poisoned'));
});

test('only real damage types are kept; descriptive text in the table is dropped', () => {
  for (const m of monsters().values()) for (const t of [...m.resistances, ...m.vulnerabilities, ...m.immunities]) assert.ok(DAMAGE_TYPES.includes(t), `${m.id}: ${t}`);
});

test('a monster with no actions has no attacks', () => {
  assert.deepEqual(monster('vampire-mist').attacks, []);
});

test('an unknown monster is refused', () => {
  assert.throws(() => monster('tarrasque-jr'), /there is no monster tarrasque-jr/);
});

test('XP by challenge rating comes from the SRD table, fractions included', () => {
  assert.deepEqual([0, 0.125, 0.25, 0.5, 1, 2].map(xpForCr), [10, 25, 50, 100, 200, 450]);
  assert.throws(() => xpForCr(0.3), /no challenge rating 0.3/);
});

test('the encounter budget adds up each character’s XP for the difficulty', () => {
  assert.equal(encounterBudget([1, 1, 1, 1], 'moderate'), 300);
  assert.equal(encounterBudget([1, 2], 'low'), 50 + 100);
  assert.equal(encounterBudget([3], 'high'), 400);
  assert.throws(() => encounterBudget([21], 'low'), /no encounter budget for level 21/);
});
