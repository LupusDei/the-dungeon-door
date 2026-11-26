import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heroSheet } from '../characters.ts';
import { abilityModifier } from './abilities.ts';
import { expertiseOf, rederive } from './character.ts';
import { climb } from './leveling.fixture.ts';
import { srd } from './srd.ts';

const rogue = heroSheet({ id: 'r', name: 'Vex', race: 'halfling', characterClass: 'rogue', backgroundId: 'criminal' });
const bard = heroSheet({ id: 'b', name: 'Lyra', race: 'human', characterClass: 'bard' });
const fighter = heroSheet({ id: 'f', name: 'Bryn', race: 'human', characterClass: 'fighter' });

test('a level-1 rogue has Expertise in two proficient skills, its best ones, and adds twice its proficiency bonus', () => {
  assert.equal(rogue.expertise!.length, 2);
  assert.ok(rogue.expertise!.every((s) => rogue.skills.includes(s)));
  const best = [...rogue.skills].sort((a, b) => rogue.abilityScores[srd().skills.get(b)!] - rogue.abilityScores[srd().skills.get(a)!] || a.localeCompare(b));
  assert.deepEqual(rogue.expertise, best.slice(0, 2));
  for (const skill of rogue.expertise!) {
    assert.equal(rogue.skillBonuses[skill], abilityModifier(rogue.abilityScores[srd().skills.get(skill)!]) + 2 * rogue.proficiencyBonus);
  }
  const plain = rogue.skills.find((s) => !rogue.expertise!.includes(s))!;
  assert.equal(rogue.skillBonuses[plain], abilityModifier(rogue.abilityScores[srd().skills.get(plain)!]) + rogue.proficiencyBonus);
});

test('chosen Expertise is kept; a fighter has none; a bard gets it at level 2 and more at 9', () => {
  const chosen = rederive({ ...rogue, expertise: ['athletics', 'insight'] });
  assert.deepEqual(chosen.expertise, ['athletics', 'insight']);
  assert.equal(fighter.expertise, undefined);
  assert.equal(bard.expertise, undefined);
  assert.equal(climb(bard, 2).expertise!.length, 2);
  assert.equal(climb(bard, 9).expertise!.length, Math.min(4, bard.skills.length));
});

test('a ranger’s Deft Explorer gives one skill', () => {
  const ranger = heroSheet({ id: 'g', name: 'Fen', race: 'elf', characterClass: 'ranger' });
  assert.equal(climb(ranger, 2).expertise!.length, 1);
  assert.deepEqual(expertiseOf({ ...ranger, features: [], expertise: ['stealth'] }, ranger.abilityScores, srd()), ['stealth']);
});
