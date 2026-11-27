import assert from 'node:assert/strict';
import { test } from 'node:test';
import { monsterCombatant } from './combatant.ts';
import { afterRepeatSave, canBeHeld, harmed, heldByConcentration, hold, HOLDING_SPELLS, holdsOn, release } from './holds.ts';
import { monster } from './monsters.ts';
import { takeDamage } from './resolve.ts';
import { scriptedRng } from './rng.ts';
import { resolveSpell } from './spellEffects.ts';
import { castSpell } from './spells.ts';
import { heroSheet } from '../characters.ts';
import { heroCombatant } from './combatant.ts';

const goblin = monsterCombatant('foe-1', monster('goblin-warrior'));
const bandit = monsterCombatant('foe-2', monster('bandit'));
const skeleton = monsterCombatant('foe-3', monster('skeleton'));

test('a hold brings its spell’s conditions, and says who cast it and how it ends', () => {
  const held = hold(goblin, 'sleep', 'p1', 13, 'wis');
  assert.deepEqual(held.conditions, ['incapacitated']);
  assert.deepEqual(holdsOn(held), [{ spellId: 'sleep', by: 'p1', conditions: ['incapacitated'], save: { ability: 'wis', dc: 13 }, brokenByHarm: true, deepens: ['unconscious'] }]);
  const laughing = hold(goblin, 'hideous-laughter', 'p1', 13, 'wis');
  assert.deepEqual(laughing.conditions, ['prone', 'incapacitated']);
  assert.equal(holdsOn(hold(goblin, 'hypnotic-pattern', 'p1', 13, 'wis'))[0].save, null, 'Hypnotic Pattern is not saved against again');
});

test('ending a hold lifts only the conditions it brought: one already there, or another hold’s, stays', () => {
  const prone = { ...goblin, conditions: ['prone' as const] };
  const laughing = hold(prone, 'hideous-laughter', 'p1', 13, 'wis');
  assert.deepEqual(holdsOn(laughing)[0].conditions, ['incapacitated'], 'it was prone already');
  assert.deepEqual(release(laughing, () => true).conditions, ['prone']);
  const both = hold(hold(goblin, 'sleep', 'p1', 13, 'wis'), 'hypnotic-pattern', 'p2', 14, 'wis');
  assert.deepEqual(both.conditions, ['incapacitated', 'charmed']);
  const woke = release(both, (h) => h.spellId === 'sleep');
  assert.deepEqual([woke.conditions, holdsOn(woke).map((h) => h.spellId)], [['incapacitated', 'charmed'], ['hypnotic-pattern']], 'the pattern still incapacitates');
  assert.equal(release(woke, () => true).holds, undefined, 'no holds: no field');
});

test('damage that leaves it standing wakes a sleeper; Hold Person is not broken by harm', () => {
  const sleeping = afterRepeatSave(hold(goblin, 'sleep', 'p1', 13, 'wis'), holdsOn(hold(goblin, 'sleep', 'p1', 13, 'wis'))[0], false);
  assert.deepEqual(sleeping.conditions, ['unconscious']);
  const hit = takeDamage(sleeping, 1, false);
  assert.deepEqual([hit.conditions, hit.holds], [[], undefined]);
  const paralyzed = hold(bandit, 'hold-person', 'p1', 13, 'wis');
  assert.deepEqual(takeDamage(paralyzed, 1, false).conditions, ['paralyzed']);
  assert.deepEqual(harmed(paralyzed), paralyzed);
});

test('the repeat save: a success ends the hold; a failure against Sleep is sleep (Unconscious, no more saves)', () => {
  const drowsy = hold(goblin, 'sleep', 'p1', 13, 'wis');
  const h = holdsOn(drowsy)[0];
  assert.deepEqual(afterRepeatSave(drowsy, h, true).conditions, []);
  const asleep = afterRepeatSave(drowsy, h, false);
  assert.deepEqual([asleep.conditions, holdsOn(asleep)[0].save, holdsOn(asleep)[0].deepens], [['unconscious'], null, undefined]);
  const paralyzed = hold(bandit, 'hold-person', 'p1', 13, 'wis');
  assert.deepEqual(afterRepeatSave(paralyzed, holdsOn(paralyzed)[0], false), paralyzed, 'Hold Person holds on a failure');
});

test('who can be held: Hold Person takes only a humanoid, Sleep no creature immune to Exhaustion', () => {
  assert.equal(canBeHeld(bandit, HOLDING_SPELLS['hold-person']), true);
  assert.equal(canBeHeld(goblin, HOLDING_SPELLS['hold-person']), false, 'a 2024 goblin is fey');
  assert.equal(canBeHeld(skeleton, HOLDING_SPELLS.sleep), false, 'undead do not sleep');
  assert.equal(canBeHeld(goblin, HOLDING_SPELLS.sleep), true);
});

test('a concentration spell’s hold ends when its caster no longer concentrates on it; another caster’s, or a non-concentration spell’s, stays', () => {
  const held = hold(hold(goblin, 'sleep', 'p1', 13, 'wis'), 'blindness-deafness', 'p1', 13, 'con');
  const concentration = (id: string) => id === 'sleep';
  assert.deepEqual(heldByConcentration(held, () => 'sleep', concentration), held);
  assert.deepEqual(heldByConcentration(held, () => null, concentration).conditions, ['blinded']);
  assert.deepEqual(heldByConcentration(held, () => undefined, concentration), held, 'a caster the party does not know of');
});

test('casting Sleep: each target saves (WIS); one that fails is Incapacitated; undead are unaffected without a roll', () => {
  const wizard = heroSheet({ id: 'w', name: 'Cleo', race: 'elf', characterClass: 'wizard' });
  const sheet = { ...wizard, spellcasting: { ...wizard.spellcasting!, prepared: [...wizard.spellcasting!.prepared, 'sleep'] } };
  const { cast } = castSpell(sheet, 'sleep');
  const caster = { combatant: heroCombatant('p1', sheet), saveDc: 13, attackBonus: 5, modifier: 3 };
  const { outcomes, targets } = resolveSpell(scriptedRng([2, 19]), caster, cast, [goblin, skeleton, { ...bandit, saveBonuses: { ...bandit.saveBonuses, wis: 0 } }]);
  assert.deepEqual(outcomes.map((o) => [o.target, o.save?.success, o.save?.roll === null, o.conditions]), [
    ['foe-1', false, false, ['incapacitated']], ['foe-3', true, true, undefined], ['foe-2', true, false, undefined],
  ]);
  assert.deepEqual(targets.map((t) => t.conditions), [['incapacitated'], [], []]);
  assert.equal(holdsOn(targets[0])[0].by, 'p1');
});
