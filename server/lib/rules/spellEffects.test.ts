import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heroCombatant, monsterCombatant } from './combatant.ts';
import { monster } from './monsters.ts';
import { scriptedRng } from './rng.ts';
import { SAMPLE } from './sheet.fixture.ts';
import { areaCatch, type Caster, casterOf, concentrationCheck, resolveSpell, targetsInRadius } from './spellEffects.ts';
import type { Cast } from './spells.ts';
import { RuleViolation } from './violation.ts';

const goblin = (id = 'g1') => monsterCombatant(id, monster('goblin-warrior'));
const bryn = heroCombatant('bryn', SAMPLE);
const caster: Caster = { combatant: { ...bryn, id: 'vex', name: 'Vex' }, saveDc: 13, attackBonus: 5, modifier: 3 };
const cast = (spellId: string, o: Partial<Cast> = {}): Cast =>
  ({ spellId, slotLevel: 0, damageDice: null, beams: 1, healingDice: null, endedConcentration: null, ...o });
const violation = (message: RegExp) => (e: unknown) => e instanceof RuleViolation && message.test(e.message);

test('a caster is its combatant plus its spell save DC, attack bonus and spellcasting modifier', () => {
  const sheet = { ...SAMPLE, proficiencyBonus: 3, spellcasting: { ability: 'int' as const, saveDc: 15, attackBonus: 7, slots: [4, 3, 2, 0, 0, 0, 0, 0, 0], cantrips: [], prepared: [], expended: [0, 0, 0, 0, 0, 0, 0, 0, 0], concentratingOn: null } };
  assert.deepEqual(casterOf(sheet, bryn), { combatant: bryn, saveDc: 15, attackBonus: 7, modifier: 4 });
  assert.throws(() => casterOf(SAMPLE, bryn), violation(/Bryn casts no spells/));
});

test('a spell attack is an attack roll with the spell attack bonus and the spell\'s damage', () => {
  const { outcomes, targets } = resolveSpell(scriptedRng([10, 7]), caster, cast('fire-bolt', { damageDice: '1d10' }), [goblin()]);
  assert.deepEqual([outcomes[0].attack!.roll.total, outcomes[0].attack!.ac, outcomes[0].attack!.hit, outcomes[0].damage], [15, 15, true, 7]);
  assert.equal(targets[0].hp, 3);
  const miss = resolveSpell(scriptedRng([9]), caster, cast('fire-bolt', { damageDice: '1d10' }), [goblin()]);
  assert.deepEqual([miss.outcomes[0].attack!.hit, miss.outcomes[0].damage, miss.targets[0].hp], [false, 0, 10]);
  const voted = resolveSpell(scriptedRng([4, 4]), caster, cast('fire-bolt', { damageDice: '1d10' }), [goblin()], { attack: { natural: 20 } });
  assert.deepEqual([voted.outcomes[0].attack!.critical, voted.outcomes[0].damage], [true, 4 + 4], 'a voter\'s natural 20 crits: the dice double');
});

test('each beam is its own attack; beams may share a target, which takes them in turn', () => {
  const blast = cast('eldritch-blast', { damageDice: '1d10', beams: 2 });
  const { outcomes, targets } = resolveSpell(scriptedRng([15, 4, 15, 3]), caster, blast, [goblin(), goblin()]);
  assert.deepEqual(outcomes.map((o) => o.damage), [4, 3]);
  assert.deepEqual(targets.map((t) => [t.id, t.hp]), [['g1', 3]]);
  assert.throws(() => resolveSpell(scriptedRng([]), caster, blast, [goblin()]), violation(/Eldritch Blast makes 2 attacks: give 2 targets/));
  assert.throws(() => resolveSpell(scriptedRng([]), caster, cast('fire-bolt', { damageDice: '1d10' }), []), violation(/Fire Bolt makes 1 attack: give 1 target$/));
});

test('a ranged spell attack has disadvantage against a prone target; a melee one has advantage', () => {
  const prone = { ...goblin(), conditions: ['prone' as const] };
  assert.equal(resolveSpell(scriptedRng([18, 3, 5]), caster, cast('fire-bolt', { damageDice: '1d10' }), [prone]).outcomes[0].attack!.hit, false);
  assert.equal(resolveSpell(scriptedRng([3, 18, 5]), caster, cast('shocking-grasp', { damageDice: '1d8' }), [prone]).outcomes[0].attack!.hit, true);
});

test('a save spell rolls its damage once; each target saves for half, or none when the spell says so', () => {
  const fireball = cast('fireball', { slotLevel: 3, damageDice: '8d6' });
  const { outcomes, targets } = resolveSpell(scriptedRng([3, 3, 3, 3, 3, 3, 3, 3, 5, 11]), caster, fireball, [goblin('g1'), goblin('g2')]);
  assert.deepEqual(outcomes.map((o) => [o.target, o.save!.success, o.damage]), [['g1', false, 24], ['g2', true, 12]]);
  assert.deepEqual(targets.map((t) => [t.id, t.status]), [['g1', 'dead'], ['g2', 'dead']]);
  const flame = resolveSpell(scriptedRng([6, 11]), caster, cast('sacred-flame', { damageDice: '1d8' }), [goblin()]);
  assert.deepEqual([flame.outcomes[0].save!.success, flame.outcomes[0].damage], [true, 0]);
  const resisted = resolveSpell(scriptedRng([6, 1]), caster, cast('sacred-flame', { damageDice: '1d8' }), [{ ...goblin(), resistances: ['radiant'] }]);
  assert.equal(resisted.outcomes[0].damage, 3, 'resistance halves it');
  const dying = { ...bryn, hp: 0, status: 'dying' as const, conditions: ['unconscious' as const] };
  const hit = resolveSpell(scriptedRng([6, 1]), caster, cast('sacred-flame', { damageDice: '1d8' }), [dying]);
  assert.deepEqual(hit.targets[0].deathSaves, { successes: 0, failures: 1 }, 'damage to a dying hero is one failed death save, not a crit');
});

test('a save spell without damage reports who saved, for the DM to apply its effect', () => {
  const { outcomes, targets } = resolveSpell(scriptedRng([2, 20]), caster, cast('hold-person', { slotLevel: 2 }), [bryn, { ...bryn, id: 'b2' }]);
  assert.deepEqual(outcomes.map((o) => [o.target, o.save!.success, o.damage]), [['bryn', false, 0], ['b2', true, 0]]);
  assert.deepEqual(targets.map((t) => t.hp), [13, 13]);
});

test('a healing spell rolls once and adds the spellcasting modifier to each target', () => {
  const hurt = { ...bryn, hp: 2 };
  const { outcomes, targets } = resolveSpell(scriptedRng([3, 4]), caster, cast('cure-wounds', { slotLevel: 1, healingDice: '2d8' }), [hurt]);
  assert.deepEqual([outcomes[0].healed, targets[0].hp], [10, 12]);
  assert.equal(resolveSpell(scriptedRng([8, 8]), caster, cast('cure-wounds', { healingDice: '2d8' }), [hurt]).targets[0].hp, 13, 'not above the maximum');
});

test('a spell with nothing to roll changes nothing; its effect is for the DM', () => {
  const { outcomes, targets } = resolveSpell(scriptedRng([]), caster, cast('bless', { slotLevel: 1 }), [bryn]);
  assert.deepEqual([outcomes, targets], [[{ target: 'bryn', attack: null, save: null, damage: 0, healed: 0 }], [bryn]]);
});

test('concentration holds on a Constitution save against half the damage, from 10 to 30', () => {
  const held = concentrationCheck(scriptedRng([6]), bryn, 12);
  assert.deepEqual([held.dc, held.roll!.total, held.success], [10, 10, true]);
  const lost = concentrationCheck(scriptedRng([6]), bryn, 22);
  assert.deepEqual([lost.dc, lost.success], [11, false]);
  const voted = concentrationCheck(scriptedRng([]), bryn, 80, { natural: 20 });
  assert.deepEqual([voted.dc, voted.success], [30, false], 'DC 30: a natural 20 is no automatic success on a save');
  const down = concentrationCheck(scriptedRng([]), { ...bryn, status: 'dying' }, 1);
  assert.deepEqual([down.roll, down.success], [null, false], 'a hero who drops loses concentration');
});

test('a sphere, cylinder or emanation takes everyone within its radius on the 5-foot grid', () => {
  const positions = [{ id: 'a', x: 4, y: 0 }, { id: 'b', x: 5, y: 0 }, { id: 'c', x: -3, y: 4 }, { id: 'd', x: 0, y: 0 }, { id: 'e', x: 4, y: -5 }, { id: 'f', x: 5, y: 2 }];
  assert.deepEqual(targetsInRadius({ shape: 'Sphere', feet: 20 }, { x: 0, y: 0 }, positions), ['a', 'c', 'd']);
  assert.deepEqual(targetsInRadius({ shape: 'Emanation', feet: 5 }, { x: 5, y: 1 }, positions), ['a', 'b', 'f']);
  assert.deepEqual(targetsInRadius({ shape: 'Cylinder', feet: 25 }, { x: 0, y: 0 }, positions), ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.throws(() => targetsInRadius({ shape: 'Cone', feet: 15 }, { x: 0, y: 0 }, positions), violation(/give the targets of a Cone yourself/));
});

test('how many foes an unplaced area catches: 1 + radius/5 (sphere, cylinder, emanation), 1 + size/10 (cone, cube), 1 + length/30 (line)', () => {
  const caught = (shape: Parameters<typeof areaCatch>[0]['shape'], feet: number) => areaCatch({ shape, feet });
  assert.deepEqual([caught('Sphere', 20), caught('Sphere', 5), caught('Cylinder', 10), caught('Emanation', 14)], [5, 2, 3, 3]);
  assert.deepEqual([caught('Cone', 15), caught('Cone', 60), caught('Cube', 10), caught('Cube', 9)], [2, 7, 2, 1]);
  assert.deepEqual([caught('Line', 100), caught('Line', 29)], [4, 1]);
});

test('Magic Missile’s darts never miss and allow no save: each deals its own 1d4 + 1 force, split among targets as given', () => {
  const missile = cast('magic-missile', { slotLevel: 1, damageDice: '1d4+1', beams: 3 });
  const { outcomes, targets } = resolveSpell(scriptedRng([4, 1, 3]), caster, missile, [goblin('g1'), goblin('g1'), goblin('g2')]);
  assert.deepEqual(outcomes.map((o) => [o.target, o.attack, o.save, o.damage]), [['g1', null, null, 5], ['g1', null, null, 2], ['g2', null, null, 4]]);
  assert.deepEqual(targets.map((t) => [t.id, t.hp]), [['g1', 3], ['g2', 6]]);
  assert.throws(() => resolveSpell(scriptedRng([]), caster, missile, [goblin()]), violation(/Magic Missile makes 3 darts: give 3 targets/));
  const ghost = { ...goblin('g3'), immunities: ['force'] };
  assert.deepEqual(resolveSpell(scriptedRng([4]), caster, cast('magic-missile', { slotLevel: 1, damageDice: '1d4+1', beams: 1 }), [ghost]).outcomes[0].damage, 0, 'defenses still apply');
});
