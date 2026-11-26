import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Combatant, heroCombatant, monsterCombatant } from './combatant.ts';
import { monster } from './monsters.ts';
import {
  addCondition, attackRoll, damageAfterDefenses, deathSave, heal, modeOf, removeCondition, rollD20, savingThrow, takeDamage,
} from './resolve.ts';
import { scriptedRng } from './rng.ts';
import { SAMPLE } from './sheet.fixture.ts';
import { RuleViolation } from './violation.ts';

const hero = (o: Partial<Combatant> = {}): Combatant => ({ ...heroCombatant('bryn', SAMPLE), ...o });
const goblin = (o: Partial<Combatant> = {}): Combatant => ({ ...monsterCombatant('gob', monster('goblin-warrior')), ...o });
const dice = (...faces: number[]) => scriptedRng(faces);

test('advantage and disadvantage cancel out', () => {
  assert.deepEqual([modeOf(false, false), modeOf(true, false), modeOf(false, true), modeOf(true, true)], ['normal', 'advantage', 'disadvantage', 'normal']);
});

test('a d20 test adds the bonus to the die, keeping the higher with advantage and the lower with disadvantage', () => {
  assert.deepEqual(rollD20(dice(12), 3, 'normal'), { natural: 12, rolls: [12], total: 15 });
  assert.deepEqual(rollD20(dice(4, 17), 3, 'advantage'), { natural: 17, rolls: [4, 17], total: 20 });
  assert.deepEqual(rollD20(dice(4, 17), 3, 'disadvantage'), { natural: 4, rolls: [4, 17], total: 7 });
});

test('a d20 already rolled (the vote) is the first die; the rng rolls only the second', () => {
  assert.deepEqual(rollD20(dice(), 2, 'normal', 19), { natural: 19, rolls: [19], total: 21 });
  assert.deepEqual(rollD20(dice(6), 2, 'advantage', 19), { natural: 19, rolls: [19, 6], total: 21 });
});

test('an attack that meets the AC hits and rolls damage', () => {
  const { result, target } = attackRoll(dice(10, 4), hero(), 'Unarmed Strike', goblin({ ac: 15 }), {});
  assert.deepEqual([result.roll.total, result.ac, result.hit, result.critical], [15, 15, true, false]);
  assert.equal(result.damage, 4);
  assert.equal(target.hp, 6);
});

test('an attack under the AC misses and does nothing', () => {
  const { result, target } = attackRoll(dice(9), hero(), 'Unarmed Strike', goblin(), {});
  assert.deepEqual([result.hit, result.damage, target.hp], [false, 0, 10]);
});

test('a natural 20 always hits and doubles the damage dice; a natural 1 always misses', () => {
  const chainMail = hero({ attacks: [{ name: 'Mace', bonus: 0, ranged: false, damage: [{ dice: '1d6+1', type: 'bludgeoning' }] }] });
  const crit = attackRoll(dice(3, 5), chainMail, 'Mace', goblin({ ac: 30 }), { natural: 20 }).result;
  assert.deepEqual([crit.hit, crit.critical, crit.damage], [true, true, 9]);
  assert.equal(attackRoll(dice(), hero(), 'Unarmed Strike', goblin({ ac: 2 }), { natural: 1 }).result.hit, false);
});

test('cover adds to AC, and total cover cannot be targeted', () => {
  assert.equal(attackRoll(dice(10), hero(), 'Unarmed Strike', goblin(), { cover: 'half' }).result.ac, 17);
  assert.equal(attackRoll(dice(10), hero(), 'Unarmed Strike', goblin(), { cover: 'three-quarters' }).result.ac, 20);
  assert.throws(() => attackRoll(dice(10), hero(), 'Unarmed Strike', goblin(), { cover: 'total' }), /total cover/);
});

test('conditions on the attacker and the target set advantage and disadvantage', () => {
  const N = 'normal', A = 'advantage', D = 'disadvantage';
  /** Which mode the roll used: one die is normal, two dice kept high is advantage, kept low disadvantage. */
  const modeUsed = (roll: { rolls: number[]; natural: number }) => (roll.rolls.length === 1 ? N : roll.natural === 15 ? A : D);
  const mode = (attacker: Partial<Combatant>, target: Partial<Combatant>, ranged = false, options = {}) => {
    const a = hero({ ...attacker, attacks: [{ name: 'Hit', bonus: 0, ranged, damage: [] }] });
    return modeUsed(attackRoll(dice(5, 15), a, 'Hit', goblin(target), options).result.roll);
  };
  assert.equal(mode({}, {}), N);
  for (const c of ['blinded', 'frightened', 'poisoned', 'prone', 'restrained'] as const) assert.equal(mode({ conditions: [c] }, {}), D, c);
  assert.equal(mode({ conditions: ['invisible'] }, {}), A);
  for (const c of ['blinded', 'paralyzed', 'petrified', 'restrained', 'stunned', 'unconscious'] as const) assert.equal(mode({}, { conditions: [c] }), A, c);
  assert.equal(mode({}, { conditions: ['invisible'] }), D);
  assert.equal(mode({}, { conditions: ['prone'] }), A, 'melee against prone has advantage');
  assert.equal(mode({}, { conditions: ['prone'] }, true), D, 'ranged against prone has disadvantage');
  assert.equal(mode({ conditions: ['blinded'] }, { conditions: ['blinded'] }), N, 'they cancel');
  assert.deepEqual([mode({}, {}, false, { advantage: true }), mode({}, {}, false, { disadvantage: true })], [A, D], 'the DM can grant either directly');
});

test('a melee hit on a paralyzed or unconscious target is a critical hit', () => {
  const r = attackRoll(dice(5, 2, 2, 2), hero({ attacks: [{ name: 'Axe', bonus: 10, ranged: false, damage: [{ dice: '1d4', type: 'slashing' }] }] }), 'Axe', goblin({ conditions: ['paralyzed'] }), {}).result;
  assert.deepEqual([r.hit, r.critical, r.damage], [true, true, 4]);
  const ranged = attackRoll(dice(5, 2, 2), hero({ attacks: [{ name: 'Bow', bonus: 10, ranged: true, damage: [{ dice: '1d4', type: 'piercing' }] }] }), 'Bow', goblin({ conditions: ['unconscious'] }), {}).result;
  assert.equal(ranged.critical, false);
});

test('extra damage that needs Advantage counts only with Advantage', () => {
  const g = goblin();
  assert.equal(attackRoll(dice(15, 3), g, 'Scimitar', hero(), {}).result.damage, 5);
  assert.equal(attackRoll(dice(2, 15, 3, 4), g, 'Scimitar', hero(), { advantage: true }).result.damage, 9);
});

test('only a combatant who is up and able to act can attack, and not the dead', () => {
  assert.throws(() => attackRoll(dice(10), hero({ status: 'dying' }), 'Unarmed Strike', goblin(), {}), /Bryn cannot act/);
  assert.throws(() => attackRoll(dice(10), hero({ conditions: ['stunned'] }), 'Unarmed Strike', goblin(), {}), /Bryn cannot act/);
  assert.throws(() => attackRoll(dice(10), hero(), 'Unarmed Strike', goblin({ status: 'dead' }), {}), /Goblin Warrior is already dead/);
  assert.throws(() => attackRoll(dice(10), hero(), 'Fireball', goblin(), {}), (e: unknown) => e instanceof RuleViolation && /Bryn has no attack Fireball/.test(e.message));
});

test('resistance halves damage (rounded down), vulnerability doubles it, immunity stops it', () => {
  const t = goblin({ resistances: ['fire'], vulnerabilities: ['cold'], immunities: ['poison'] });
  assert.deepEqual([damageAfterDefenses(t, 7, 'fire'), damageAfterDefenses(t, 7, 'cold'), damageAfterDefenses(t, 7, 'poison'), damageAfterDefenses(t, 7, 'acid')], [3, 14, 0, 7]);
});

test('a monster at 0 HP is dead', () => {
  assert.deepEqual([takeDamage(goblin(), 12, false).hp, takeDamage(goblin(), 12, false).status], [0, 'dead']);
  assert.equal(takeDamage(goblin(), 9, false).status, 'up');
});

test('a dead creature stays dead whatever strikes it, and a monster at 0 HP never starts dying (q-mwxx6wwz)', () => {
  const slain = takeDamage(goblin(), 12, false);
  assert.equal(takeDamage(slain, 5, false), slain, 'damage to the dead does nothing');
  assert.equal(takeDamage(slain, 5, true), slain);
  const deadHero = takeDamage(hero(), 26, false);
  assert.equal(takeDamage(deadHero, 3, false), deadHero);
  const lingering = goblin({ hp: 0, status: 'dying', deathSaves: { successes: 0, failures: 1 } });
  assert.deepEqual([takeDamage(lingering, 2, false).status, takeDamage(lingering, 2, false).deathSaves.failures], ['dead', 1], 'a foe left dying by the old rule dies at the next blow');
});

test('a hero at 0 HP falls unconscious and starts dying', () => {
  const down = takeDamage(hero(), 13, false);
  assert.deepEqual([down.hp, down.status, down.conditions], [0, 'dying', ['unconscious']]);
});

test('damage that leaves as much over as the hero’s maximum HP kills outright', () => {
  assert.equal(takeDamage(hero(), 26, false).status, 'dead');
  assert.equal(takeDamage(hero(), 25, false).status, 'dying');
});

test('damage to a dying hero is a failed death save, two on a critical hit, three is death', () => {
  const dying = takeDamage(hero(), 13, false);
  assert.deepEqual(takeDamage(dying, 1, false).deathSaves, { successes: 0, failures: 1 });
  assert.deepEqual(takeDamage(dying, 1, true).deathSaves, { successes: 0, failures: 2 });
  assert.equal(takeDamage(takeDamage(dying, 1, true), 1, false).status, 'dead');
  assert.equal(takeDamage(dying, 0, false).deathSaves.failures, 0, 'no damage, no failure');
  assert.equal(takeDamage({ ...dying, status: 'stable' }, 2, false).status, 'dying', 'a stable hero who is hit is dying again');
  assert.equal(takeDamage(dying, 13, false).status, 'dead', 'damage at 0 HP of at least the maximum kills');
});

test('death saves: 10 or more succeeds, three successes stabilize, a natural 1 is two failures, a natural 20 is back up with 1 HP', () => {
  const dying = takeDamage(hero(), 13, false);
  assert.deepEqual(deathSave(dice(10), dying).deathSaves, { successes: 1, failures: 0 });
  assert.deepEqual(deathSave(dice(9), dying).deathSaves, { successes: 0, failures: 1 });
  assert.deepEqual(deathSave(dice(1), dying).deathSaves, { successes: 0, failures: 2 });
  const stable = deathSave(dice(), { ...dying, deathSaves: { successes: 2, failures: 2 } }, 15);
  assert.deepEqual([stable.status, stable.deathSaves], ['stable', { successes: 0, failures: 0 }]);
  assert.equal(deathSave(dice(4), { ...dying, deathSaves: { successes: 2, failures: 2 } }).status, 'dead');
  const up = deathSave(dice(20), dying);
  assert.deepEqual([up.status, up.hp, up.conditions], ['up', 1, []]);
  assert.throws(() => deathSave(dice(10), hero()), /Bryn is not dying/);
});

test('healing restores HP up to the maximum and wakes a dying hero', () => {
  assert.equal(heal(hero({ hp: 5 }), 4).hp, 9);
  assert.equal(heal(hero({ hp: 12 }), 4).hp, 13);
  const woken = heal(takeDamage(hero(), 13, false), 3);
  assert.deepEqual([woken.hp, woken.status, woken.conditions, woken.deathSaves], [3, 'up', [], { successes: 0, failures: 0 }]);
  assert.throws(() => heal(hero({ status: 'dead', hp: 0 }), 3), /Bryn is dead/);
});

test('a saving throw adds the save bonus and meets or beats the DC', () => {
  assert.deepEqual(savingThrow(dice(9), hero(), 'con', 13, {}), { roll: { natural: 9, rolls: [9], total: 13 }, success: true });
  assert.equal(savingThrow(dice(8), hero(), 'con', 13, {}).success, false);
});

test('paralyzed, stunned, unconscious and petrified fail STR and DEX saves; restrained has disadvantage on DEX', () => {
  for (const c of ['paralyzed', 'stunned', 'unconscious', 'petrified'] as const) {
    assert.deepEqual(savingThrow(dice(), hero({ conditions: [c] }), 'dex', 5, {}), { roll: null, success: false });
  }
  assert.equal(savingThrow(dice(20), hero({ conditions: ['stunned'] }), 'wis', 5, {}).success, true);
  assert.equal(savingThrow(dice(3, 18), hero({ conditions: ['restrained'] }), 'dex', 10, {}).roll?.natural, 3);
  assert.equal(savingThrow(dice(3, 18), hero({ conditions: ['restrained'] }), 'str', 10, {}).roll?.natural, 3, 'only DEX: STR is normal');
});

test('the DM can grant advantage or disadvantage on a save', () => {
  assert.equal(savingThrow(dice(3, 18), hero(), 'wis', 10, { advantage: true }).roll?.natural, 18);
  assert.equal(savingThrow(dice(18, 3), hero(), 'wis', 10, { disadvantage: true }).roll?.natural, 3);
});

test('cover adds to DEX saves only', () => {
  assert.equal(savingThrow(dice(10), hero(), 'dex', 15, { cover: 'three-quarters' }).roll?.total, 17);
  assert.equal(savingThrow(dice(10), hero(), 'wis', 15, { cover: 'half' }).roll?.total, 10);
});

test('conditions are added once, not to the immune, and can be removed', () => {
  assert.deepEqual(addCondition(addCondition(hero(), 'prone'), 'prone').conditions, ['prone']);
  assert.deepEqual(addCondition(goblin({ conditionImmunities: ['poisoned'] }), 'poisoned').conditions, []);
  assert.deepEqual(removeCondition(hero({ conditions: ['prone', 'poisoned'] }), 'prone').conditions, ['poisoned']);
});
