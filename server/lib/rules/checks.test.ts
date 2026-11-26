import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heroSheet } from '../characters.ts';
import { abilityModifier } from './abilities.ts';
import { abilityCheck, checkBonus, dcAgainst, passiveScore } from './checks.ts';
import { monster } from './monsters.ts';
import { scriptedRng } from './rng.ts';

const rogue = heroSheet({ id: 'r', name: 'Vex', race: 'halfling', characterClass: 'rogue', backgroundId: 'criminal' });
const fighter = heroSheet({ id: 'f', name: 'Bryn', race: 'human', characterClass: 'fighter' });
const pb = rogue.proficiencyBonus;
const dex = abilityModifier(rogue.abilityScores.dex);

test('a check adds the ability modifier, and the skill bonus (proficiency, Expertise) when the skill applies', () => {
  assert.deepEqual(checkBonus(fighter, { ability: 'int' }), { bonus: abilityModifier(fighter.abilityScores.int), advantage: false });
  assert.equal(checkBonus(rogue, { ability: 'dex', skill: 'stealth' }).bonus, rogue.skillBonuses.stealth);
  assert.equal(checkBonus(rogue, { ability: 'dex', skill: 'not-a-skill' }).bonus, dex);
});

test('a tool adds proficiency if the hero has it; with the skill too, Advantage (5.2)', () => {
  assert.deepEqual(checkBonus(rogue, { ability: 'dex', tool: 'thieves-tools' }), { bonus: dex + pb, advantage: false });
  assert.deepEqual(checkBonus(fighter, { ability: 'dex', tool: 'thieves-tools' }), { bonus: abilityModifier(fighter.abilityScores.dex), advantage: false });
  assert.deepEqual(checkBonus(rogue, { ability: 'dex', skill: 'sleight-of-hand', tool: 'thieves-tools' }), { bonus: rogue.skillBonuses['sleight-of-hand'], advantage: true });
  assert.ok(!rogue.skills.includes('investigation'));
  assert.deepEqual(checkBonus(rogue, { ability: 'int', skill: 'investigation', tool: 'thieves-tools' }), { bonus: rogue.skillBonuses.investigation + pb, advantage: false });
  assert.deepEqual(checkBonus({ ...rogue, otherProficiencies: ['thieves-tools'] }, { ability: 'dex', tool: 'thieves-tools' }).bonus, dex + pb);
});

test('exhaustion costs 2 a level', () => {
  assert.equal(checkBonus({ ...fighter, exhaustion: 2 }, { ability: 'str' }).bonus, abilityModifier(fighter.abilityScores.str) - 4);
});

test('the roll: the d20 given (or rolled), Advantage from Help or the tool, Disadvantage from the scene', () => {
  const plain = abilityCheck(scriptedRng([]), rogue, { ability: 'dex', skill: 'stealth' }, { natural: 12 });
  assert.deepEqual([plain.natural, plain.total, plain.mode], [12, 12 + rogue.skillBonuses.stealth, 'normal']);
  const helped = abilityCheck(scriptedRng([18]), rogue, { ability: 'dex', skill: 'stealth' }, { natural: 3, advantage: true });
  assert.deepEqual([helped.natural, helped.rolls, helped.mode], [18, [3, 18], 'advantage']);
  const hindered = abilityCheck(scriptedRng([2]), rogue, { ability: 'dex' }, { natural: 15, disadvantage: true });
  assert.deepEqual([hindered.natural, hindered.mode], [2, 'disadvantage']);
  const tools = abilityCheck(scriptedRng([19]), rogue, { ability: 'dex', skill: 'sleight-of-hand', tool: 'thieves-tools' }, { natural: 4, disadvantage: true });
  assert.equal(tools.mode, 'normal', 'Advantage and Disadvantage cancel');
  assert.equal(abilityCheck(scriptedRng([7]), fighter, { ability: 'str' }).natural, 7);
});

test('passive scores: 10 + the bonus, +5 with Advantage, -5 with Disadvantage', () => {
  assert.equal(passiveScore(rogue, { ability: 'wis', skill: 'perception' }), 10 + rogue.skillBonuses.perception);
  assert.equal(passiveScore(rogue, { ability: 'wis', skill: 'insight' }, 'advantage'), 15 + rogue.skillBonuses.insight);
  assert.equal(passiveScore(rogue, { ability: 'int', skill: 'investigation' }, 'disadvantage'), 5 + rogue.skillBonuses.investigation);
});

test('5.2 has no contests: a check against a creature beats its passive score, or its Influence DC', () => {
  const goblin = monster('goblin-warrior');
  assert.equal(dcAgainst(goblin, { ability: 'dex', skill: 'stealth' }), 9, 'hiding: its passive Perception');
  assert.equal(dcAgainst(goblin, { ability: 'dex', skill: 'sleight-of-hand' }), 9);
  assert.equal(dcAgainst(goblin, { ability: 'wis', skill: 'perception' }), 16, 'finding it: 10 + its Stealth');
  assert.equal(dcAgainst(goblin, { ability: 'int', skill: 'investigation' }), 16);
  assert.equal(dcAgainst(goblin, { ability: 'wis', skill: 'insight' }), 9, 'reading it: 10 + its Deception (CHA 8)');
  assert.equal(dcAgainst(goblin, { ability: 'str', skill: 'athletics' }), 9, '10 + its Athletics (STR 8)');
  assert.equal(dcAgainst(goblin, { ability: 'dex' }), 12, 'a plain check: 10 + the same ability (DEX 15)');
  assert.equal(dcAgainst(monster('aboleth'), { ability: 'wis', skill: 'insight' }), 14);
});

test('Influence (5.2): DC 15 or the monster\'s Intelligence, whichever is higher', () => {
  assert.equal(dcAgainst(monster('goblin-warrior'), { ability: 'cha', skill: 'persuasion' }), 15);
  for (const skill of ['deception', 'intimidation', 'performance', 'persuasion']) assert.equal(dcAgainst(monster('aboleth'), { ability: 'cha', skill }), 18);
  assert.equal(dcAgainst(monster('aboleth'), { ability: 'wis', skill: 'animal-handling' }), 18);
});
