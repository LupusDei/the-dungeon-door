import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scriptedRng } from '../rules/rng.ts';
import { SAMPLE } from '../rules/sheet.fixture.ts';
import { groupRoll } from './checks.ts';
import { hookLabel, parseHook } from './hooks.ts';

const bryn = { playerId: 'p1', sheet: SAMPLE };
const cleo = { playerId: 'p2', sheet: { ...SAMPLE, name: 'Cleo', abilityScores: { ...SAMPLE.abilityScores, str: 8 }, skills: [], skillBonuses: {}, saveBonuses: { ...SAMPLE.saveBonuses, dex: -1 } } };

test('a check: each hero rolls their vote d20 plus their skill bonus; the party succeeds if at least half do', () => {
  const hook = { kind: 'check' as const, ability: 'str' as const, skill: 'athletics', dc: 12 };
  const result = groupRoll([bryn, cleo], hook, { p1: 14, p2: 10 }, scriptedRng([]));
  assert.deepEqual(result.rolls.map((r) => [r.name, r.natural, r.bonus, r.total, r.success]), [['Bryn', 14, 5, 19, true], ['Cleo', 10, -1, 9, false]]);
  assert.equal(result.success, true, 'one of two is half');
  assert.deepEqual(result.lines, ['Bryn: Athletics 14 + 5 = 19 vs DC 12, success', 'Cleo: Athletics 10 - 1 = 9 vs DC 12, failure']);
  assert.equal(groupRoll([bryn, cleo], { ...hook, dc: 20 }, { p1: 14, p2: 10 }, scriptedRng([])).success, false);
});

test('5.2: a natural 20 on a check is not an automatic success, nor a 1 a failure', () => {
  const hook = { kind: 'check' as const, ability: 'str' as const, skill: 'athletics', dc: 30 };
  assert.equal(groupRoll([bryn], hook, { p1: 20 }, scriptedRng([])).success, false);
  assert.equal(groupRoll([bryn], { ...hook, dc: 5 }, { p1: 1 }, scriptedRng([])).success, true);
});

test('a plain ability check uses the modifier; a hero who did not vote rolls a fresh d20; exhaustion costs 2 a level', () => {
  const hook = { kind: 'check' as const, ability: 'int' as const, dc: 10 };
  const tired = { ...cleo, sheet: { ...cleo.sheet, exhaustion: 2 } };
  const result = groupRoll([bryn, tired], hook, { p1: 9 }, scriptedRng([11]));
  assert.deepEqual(result.rolls.map((r) => [r.natural, r.bonus]), [[9, 1], [11, -3]]);
  assert.equal(result.lines[0], 'Bryn: Intelligence 9 + 1 = 10 vs DC 10, success');
});

test('a save: failures take the damage, successes half, rolled once; a hero at 0 HP fails without rolling', () => {
  const hook = { kind: 'save' as const, ability: 'dex' as const, dc: 13, damage: '2d10', damageType: 'bludgeoning' };
  const down = { playerId: 'p3', sheet: { ...SAMPLE, name: 'Dax', hp: 0 } };
  const result = groupRoll([bryn, cleo, down], hook, { p1: 12, p2: 3 }, scriptedRng([6, 5]));
  assert.deepEqual(result.rolls.map((r) => [r.name, r.bonus, r.total, r.success]), [['Bryn', 2, 14, true], ['Cleo', -1, 2, false], ['Dax', 0, null, false]]);
  assert.deepEqual(result.sheets.map((s) => s.sheet.hp), [SAMPLE.hp - 5, Math.max(0, SAMPLE.hp - 11), 0]);
  assert.deepEqual(result.lines, [
    'Bryn: Dexterity save 12 + 2 = 14 vs DC 13, success', 'Cleo: Dexterity save 3 - 1 = 2 vs DC 13, failure', 'Dax is down and fails',
    'Damage 11 bludgeoning: Bryn takes 5, Cleo takes 11',
  ]);
  assert.equal(result.success, false);
});

test('a save with no damage changes no hit points', () => {
  const hook = { kind: 'save' as const, ability: 'wis' as const, dc: 10 };
  const result = groupRoll([bryn], hook, { p1: 2 }, scriptedRng([]));
  assert.deepEqual([result.sheets[0].sheet, result.lines], [SAMPLE, ['Bryn: Wisdom save 2 + 0 = 2 vs DC 10, failure']]);
});

test('exhaustion costs 2 a level on saves too; a hero at 1 HP still rolls; 1 damage is still damage', () => {
  const tired = { ...bryn, sheet: { ...SAMPLE, exhaustion: 1, hp: 1 } };
  const result = groupRoll([tired], { kind: 'save', ability: 'dex', dc: 10, damage: '1d1' }, { p1: 8 }, scriptedRng([1]));
  assert.deepEqual([result.rolls[0].bonus, result.rolls[0].success, result.sheets[0].sheet.hp], [0, false, 0]);
  assert.equal(result.lines[1], 'Damage 1: Bryn takes 1');
});

test('a save\'s damage can kill outright (massive damage)', () => {
  const r = groupRoll([bryn], { kind: 'save', ability: 'dex', dc: 30, damage: '1d1+30' }, { p1: 1 }, scriptedRng([1]));
  assert.deepEqual([r.sheets[0].sheet.hp, r.sheets[0].sheet.dead], [0, true]);
});

test('a skill bonus is used even when it is 0', () => {
  const plain = { ...bryn, sheet: { ...SAMPLE, skillBonuses: { athletics: 0 } } };
  assert.equal(groupRoll([plain], { kind: 'check', ability: 'str', skill: 'athletics', dc: 10 }, { p1: 10 }, scriptedRng([])).rolls[0].bonus, 0);
});

test('hooks from the DM are checked; a bad one is dropped (the choice becomes pure story)', () => {
  assert.deepEqual(parseHook({ kind: 'check', ability: 'dex', skill: 'stealth', dc: 15 }), { kind: 'check', ability: 'dex', skill: 'stealth', dc: 15 });
  assert.equal(parseHook({ kind: 'check', ability: 'luck', dc: 15 }), null);
  assert.equal(parseHook({ kind: 'check', ability: 'dex', skill: 'juggling', dc: 15 }), null);
  assert.equal(parseHook({ kind: 'save', ability: 'dex', dc: 13, damage: 'lots' }), null);
  assert.equal(parseHook({ kind: 'check', ability: 'dex', dc: 31 }), null);
  assert.deepEqual(parseHook({ kind: 'fight', monsters: ['goblin-warrior', 'tarrasque-ish'] }), { kind: 'fight', monsters: ['goblin-warrior'] });
  assert.equal(parseHook({ kind: 'fight', monsters: ['nope'] }), null);
  assert.deepEqual(parseHook({ kind: 'rest', rest: 'long' }), { kind: 'rest', rest: 'long' });
  assert.deepEqual(parseHook({ kind: 'move', exit: 'r2' }), { kind: 'move', exit: 'r2' });
  assert.equal(parseHook(null), null);
  assert.equal(parseHook(undefined), null);
});

test('each hook has a short label for the app', () => {
  assert.equal(hookLabel({ kind: 'check', ability: 'str', skill: 'athletics', dc: 12 }), 'Athletics check, DC 12');
  assert.equal(hookLabel({ kind: 'check', ability: 'int', dc: 10 }), 'Intelligence check, DC 10');
  assert.equal(hookLabel({ kind: 'save', ability: 'dex', dc: 13, damage: '2d10' }), 'Dexterity save, DC 13');
  assert.equal(hookLabel({ kind: 'fight', monsters: ['goblin-warrior', 'goblin-warrior', 'bugbear-warrior'] }), 'Fight: 2 Goblin Warriors, Bugbear Warrior');
  assert.equal(hookLabel({ kind: 'rest', rest: 'short' }), 'Short rest');
  assert.equal(hookLabel({ kind: 'rest', rest: 'long' }), 'Long rest');
  assert.equal(hookLabel({ kind: 'move', exit: 'r2' }), 'Go on (r2)');
});

const vex = { playerId: 'p3', sheet: { ...cleo.sheet, name: 'Vex', skills: ['stealth'], skillBonuses: { stealth: 5 }, otherProficiencies: ['tool-thieves-tools'] } };

test('Advantage and Disadvantage: two d20s, the vote first; the line shows the die not kept', () => {
  const hook = { kind: 'check' as const, ability: 'str' as const, skill: 'athletics', dc: 12, advantage: true };
  const result = groupRoll([bryn], hook, { p1: 3 }, scriptedRng([14]));
  assert.deepEqual([result.rolls[0].natural, result.rolls[0].dice, result.rolls[0].total], [14, [3, 14], 19]);
  assert.equal(result.lines[0], 'Bryn: Athletics 14 (Advantage over 3) + 5 = 19 vs DC 12, success');
  const save = groupRoll([bryn], { kind: 'save', ability: 'dex', dc: 10, disadvantage: true }, { p1: 15 }, scriptedRng([4]));
  assert.equal(save.lines[0], 'Bryn: Dexterity save 4 (Disadvantage over 15) + 2 = 6 vs DC 10, failure');
  assert.deepEqual(groupRoll([bryn], { ...hook, disadvantage: true }, { p1: 3 }, scriptedRng([])).rolls[0].dice, [3], 'both cancel');
  assert.equal(groupRoll([bryn], hook, { p1: 9 }, scriptedRng([9])).lines[0], 'Bryn: Athletics 9 (Advantage over 9) + 5 = 14 vs DC 12, success', 'equal dice');
});

test('a tool check adds proficiency for a tool the hero knows; with the skill too it has Advantage', () => {
  const hook = { kind: 'check' as const, ability: 'dex' as const, tool: 'thieves-tools', dc: 15 };
  const result = groupRoll([vex, cleo], hook, { p3: 10, p2: 10 }, scriptedRng([]));
  assert.deepEqual(result.rolls.map((r) => r.bonus), [4, 2], 'DEX +2, and +2 proficiency for Vex');
  assert.equal(result.lines[0], "Vex: Thieves' Tools 10 + 4 = 14 vs DC 15, failure");
  const skilled = groupRoll([vex], { ...hook, skill: 'stealth' }, { p3: 2 }, scriptedRng([17]));
  assert.deepEqual([skilled.rolls[0].dice, skilled.rolls[0].bonus], [[2, 17], 5]);
  assert.equal(skilled.lines[0], "Vex: Stealth with Thieves' Tools 17 (Advantage over 2) + 5 = 22 vs DC 15, success");
});

test('"best" mode: the hero with the best bonus rolls; a hero proficient in the skill helps (Advantage)', () => {
  const hook = { kind: 'check' as const, ability: 'dex' as const, skill: 'stealth', dc: 15, mode: 'best' as const };
  const result = groupRoll([bryn, cleo, vex], hook, { p1: 19, p3: 8 }, scriptedRng([]));
  assert.deepEqual(result.rolls.map((r) => [r.name, r.dice]), [['Vex', [8]]], 'nobody else is proficient in Stealth: no help');
  assert.equal(result.success, false);
  const athletics = groupRoll([cleo, bryn, { ...bryn, playerId: 'p4', sheet: { ...SAMPLE, name: 'Ash' } }], { ...hook, ability: 'str', skill: 'athletics' }, {}, scriptedRng([4, 13]));
  assert.deepEqual(athletics.rolls.map((r) => [r.name, r.dice, r.success]), [['Bryn', [4, 13], true]]);
  assert.deepEqual(athletics.lines, ['Ash helps: Advantage', 'Bryn: Athletics 13 (Advantage over 4) + 5 = 18 vs DC 15, success']);
  const down = { ...bryn, sheet: { ...SAMPLE, hp: 0 } };
  assert.deepEqual(groupRoll([down, cleo], { ...hook, ability: 'str', skill: 'athletics' }, { p2: 20 }, scriptedRng([])).rolls.map((r) => r.name), ['Cleo'], 'a hero who is down neither rolls nor helps');
  assert.deepEqual(groupRoll([down], { ...hook, ability: 'str', skill: 'athletics' }, {}, scriptedRng([])).lines, ['Bryn is down and fails']);
});

test('a check against a monster takes its DC from the monster (passive score or Influence)', () => {
  const sneak = groupRoll([vex], { kind: 'check', ability: 'dex', skill: 'stealth', against: 'goblin-warrior' }, { p3: 4 }, scriptedRng([]));
  assert.equal(sneak.lines[0], 'Vex: Stealth 4 + 5 = 9 vs DC 9, success');
  const talk = groupRoll([bryn], { kind: 'check', ability: 'cha', skill: 'persuasion', against: 'goblin-warrior', dc: 3 }, { p1: 20 }, scriptedRng([]));
  assert.equal(talk.rolls[0].success, true, 'a DC the DM gives wins');
});

test('the extended check hook is checked too', () => {
  assert.deepEqual(parseHook({ kind: 'check', ability: 'dex', tool: 'thieves-tools', dc: 15, mode: 'best', advantage: true }), { kind: 'check', ability: 'dex', tool: 'thieves-tools', dc: 15, mode: 'best', advantage: true });
  assert.deepEqual(parseHook({ kind: 'check', ability: 'cha', skill: 'persuasion', against: 'goblin-warrior' }), { kind: 'check', ability: 'cha', skill: 'persuasion', against: 'goblin-warrior' });
  assert.equal(parseHook({ kind: 'check', ability: 'cha', skill: 'persuasion' }), null, 'no DC and no monster');
  assert.equal(parseHook({ kind: 'check', ability: 'cha', against: 'nobody' }), null);
  assert.equal(parseHook({ kind: 'check', ability: 'dex', tool: 'longsword', dc: 10 }), null, 'not a tool');
  assert.equal(parseHook({ kind: 'check', ability: 'dex', dc: 10, mode: 'solo' }), null);
  assert.deepEqual(parseHook({ kind: 'save', ability: 'con', dc: 12, disadvantage: true }), { kind: 'save', ability: 'con', dc: 12, disadvantage: true });
});

test('labels for the extended hooks', () => {
  assert.equal(hookLabel({ kind: 'check', ability: 'dex', tool: 'thieves-tools', dc: 15 }), "Thieves' Tools check, DC 15");
  assert.equal(hookLabel({ kind: 'check', ability: 'dex', skill: 'stealth', against: 'goblin-warrior', mode: 'best' }), 'Stealth check vs Goblin Warrior, one hero with help');
  assert.equal(hookLabel({ kind: 'check', ability: 'str', skill: 'athletics', dc: 12, advantage: true }), 'Athletics check, DC 12, with Advantage');
  assert.equal(hookLabel({ kind: 'save', ability: 'con', dc: 12, disadvantage: true }), 'Constitution save, DC 12, with Disadvantage');
  assert.equal(hookLabel({ kind: 'save', ability: 'con', dc: 12, advantage: true, disadvantage: true }), 'Constitution save, DC 12');
});

test('trade hooks: items must be in the SRD catalog; only Potions of Healing can be drunk', () => {
  assert.deepEqual(parseHook({ kind: 'buy', items: ['potion-of-healing', 'spoon'] }), { kind: 'buy', items: ['potion-of-healing'] });
  assert.equal(parseHook({ kind: 'sell', items: ['spoon'] }), null);
  assert.deepEqual(parseHook({ kind: 'sell', items: ['gemstone'] }), { kind: 'sell', items: ['gemstone'] });
  assert.deepEqual(parseHook({ kind: 'use', item: 'potion-of-greater-healing' }), { kind: 'use', item: 'potion-of-greater-healing' });
  assert.equal(parseHook({ kind: 'use', item: 'torch' }), null);
  assert.equal(hookLabel({ kind: 'buy', items: ['potion-of-healing', 'potion-of-healing', 'rope'] }), 'Buy Potion of Healing ×2, Rope');
  assert.equal(hookLabel({ kind: 'sell', items: ['gemstone', 'gemstone'] }), 'Sell Gemstone ×2');
  assert.equal(hookLabel({ kind: 'use', item: 'potion-of-healing' }), 'Drink a Potion of Healing');
});

test('trap and hazard hooks: a 5.2 trap id (or an old 5.1 one); a hazard with the amount it needs', () => {
  assert.deepEqual(parseHook({ kind: 'trap', trap: 'poisoned-needle' }), { kind: 'trap', trap: 'poisoned-needle' });
  assert.deepEqual(parseHook({ kind: 'trap', trap: 'pits' }), { kind: 'trap', trap: 'pits' });
  assert.equal(parseHook({ kind: 'trap', trap: 'falling' }), null, 'a hazard is not a trap');
  assert.deepEqual(parseHook({ kind: 'hazard', hazard: 'falling', feet: 30, minutes: null }), { kind: 'hazard', hazard: 'falling', feet: 30 });
  assert.deepEqual(parseHook({ kind: 'hazard', hazard: 'burning', feet: null }), { kind: 'hazard', hazard: 'burning' });
  assert.equal(parseHook({ kind: 'hazard', hazard: 'falling' }), null, 'how far?');
  assert.equal(parseHook({ kind: 'hazard', hazard: 'extreme-heat', hours: 0 }), null);
  assert.equal(parseHook({ kind: 'hazard', hazard: 'lava', hours: 1 }), null);
  assert.equal(hookLabel({ kind: 'trap', trap: 'poisoned-needle' }), 'Risk a trap');
  assert.equal(hookLabel({ kind: 'hazard', hazard: 'extreme-heat', hours: 4 }), 'Hazard: Extreme Heat (4 hours)');
  assert.equal(hookLabel({ kind: 'hazard', hazard: 'falling', feet: 30 }), 'Hazard: Falling (30 feet)');
  assert.equal(hookLabel({ kind: 'hazard', hazard: 'suffocation', minutes: 2 }), 'Hazard: Suffocation (2 minutes)');
  assert.equal(hookLabel({ kind: 'hazard', hazard: 'malnutrition', days: 5 }), 'Hazard: Malnutrition (5 days)');
  assert.equal(hookLabel({ kind: 'hazard', hazard: 'burning' }), 'Hazard: Burning');
});
