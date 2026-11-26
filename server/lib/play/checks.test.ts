import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scriptedRng } from '../rules/rng.ts';
import { SAMPLE } from '../rules/sheet.fixture.ts';
import { groupRoll } from './checks.ts';
import { hookLabel, parseHook } from './hooks.ts';

const bryn = { playerId: 'p1', sheet: SAMPLE };
const cleo = { playerId: 'p2', sheet: { ...SAMPLE, name: 'Cleo', abilityScores: { ...SAMPLE.abilityScores, str: 8 }, skillBonuses: {}, saveBonuses: { ...SAMPLE.saveBonuses, dex: -1 } } };

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
