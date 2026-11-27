import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heroSheet } from '../characters.ts';
import { checkBonus } from '../rules/checks.ts';
import { dieForAction, dieForCheck, dieFormula, rollPending } from './dice.ts';

const fighter = heroSheet({ id: 'f', name: 'Bryn', race: 'human', characterClass: 'fighter' });
const wizard = heroSheet({ id: 'w', name: 'Cleo', race: 'elf', characterClass: 'wizard' });

test('the formula is the d20 the player is about to throw', () => {
  assert.equal(dieFormula(5), 'd20+5');
  assert.equal(dieFormula(0), 'd20');
  assert.equal(dieFormula(-1), 'd20-1');
});

test('a skill or ability is a d20 plus that bonus; Dodge and a save spell are not a player throw', () => {
  const athletics = dieForAction(fighter, { id: 'skill:athletics', kind: 'skill', label: 'Athletics' });
  assert.equal(athletics?.formula, `d20+${fighter.skillBonuses.athletics}`);
  assert.equal(athletics?.sides, 20);
  const strength = dieForAction(fighter, { id: 'ability:str', kind: 'ability', label: 'Strength' });
  assert.equal(strength?.modifier, checkBonus(fighter, { ability: 'str' }).bonus);
  assert.equal(dieForAction(fighter, { id: 'common:dodge', kind: 'common', label: 'Dodge' }), null);
  const save = dieForAction(wizard, { id: 'spell:burning-hands', kind: 'spell', label: 'Cast Burning Hands' });
  assert.equal(save, null, 'the targets save; the caster does not throw to hit');
});

test('an attack and an attack spell name the to-hit bonus', () => {
  const attack = dieForAction(fighter, { id: 'common:attack', kind: 'attack', label: 'Attack' });
  assert.ok(attack && attack.formula.startsWith('d20'));
  const bolt = dieForAction(wizard, { id: 'spell:fire-bolt', kind: 'spell', label: 'Cast Fire Bolt' });
  assert.equal(bolt?.modifier, wizard.spellcasting?.attackBonus);
  assert.equal(bolt?.purpose, 'Cast Fire Bolt');
});

test('a written check uses the same bonus the engine will add', () => {
  const die = dieForCheck(fighter, { kind: 'check', ability: 'str', skill: 'athletics', tier: 'medium', effect: { category: 'none' } });
  assert.equal(die.modifier, fighter.skillBonuses.athletics);
  assert.equal(die.purpose, 'Athletics');
});

test('a hidden roll stays hidden until it is revealed', () => {
  const die = dieForCheck(fighter, { kind: 'check', ability: 'str', skill: 'athletics', tier: 'easy', effect: { category: 'none' } });
  assert.equal(rollPending({ die, revealed: false }), true);
  assert.equal(rollPending({ die, revealed: true }), false);
  assert.equal(rollPending({}), false);
});
