import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCharacter, quickChoices } from './character.ts';
import { climb } from './leveling.fixture.ts';
import { useResource } from './resources.ts';
import { arcaneRecovery, d20Modifier, exhaustionEffects, gainExhaustion, longRest, magicalCunning, shortRest } from './rests.ts';
import { scriptedRng, seededRng } from './rng.ts';
import type { CharacterSheet } from './sheet.ts';
import { castSpell } from './spells.ts';
import { RuleViolation } from './violation.ts';

const hero = (classId: string, level = 1): CharacterSheet =>
  climb(buildCharacter(quickChoices(seededRng(2), { name: 'Hero', classId }), seededRng(2)), level);
const violation = (message: RegExp) => (e: unknown) => e instanceof RuleViolation && message.test(e.message);
const fighter = () => hero('fighter', 4);
const con = (s: CharacterSheet) => Math.floor((s.abilityScores.con - 10) / 2);
const spend = (s: CharacterSheet, levels: number[]) => levels.reduce((sheet, slot) => sheet.spellcasting!.prepared.length ? castSpell(sheet, sheet.spellcasting!.prepared[0], slot).sheet : sheet, s);

test('a Short Rest spends hit dice: each heals its roll plus CON, at least 1, never above the maximum', () => {
  const hurt = { ...fighter(), hp: 5 };
  const { sheet, rolls, healed } = shortRest(hurt, scriptedRng([7, 2]), { hitDice: 2 });
  assert.deepEqual(rolls, [7, 2]);
  assert.equal(healed, 7 + con(hurt) + 2 + con(hurt));
  assert.deepEqual([sheet.hp, sheet.hitDiceSpent], [5 + healed, 2]);
  const weak = { ...hurt, abilityScores: { ...hurt.abilityScores, con: 3 } };
  assert.equal(shortRest(weak, scriptedRng([1]), { hitDice: 1 }).healed, 1, 'at least 1 a die');
  assert.equal(shortRest({ ...hurt, hp: hurt.maxHp - 1 }, scriptedRng([10]), { hitDice: 1 }).sheet.hp, hurt.maxHp);
  assert.deepEqual(shortRest(hurt, scriptedRng([])).sheet.hp, 5, 'resting without spending hit dice heals nothing');
});

test('a hero has one hit die per level to spend until a Long Rest', () => {
  const tired = { ...fighter(), hp: 5, hitDiceSpent: 3 };
  assert.equal(shortRest(tired, scriptedRng([4]), { hitDice: 1 }).sheet.hitDiceSpent, 4);
  assert.throws(() => shortRest(tired, scriptedRng([4, 4]), { hitDice: 2 }), violation(/Hero has 1 hit die left/));
  assert.throws(() => shortRest(tired, scriptedRng([]), { hitDice: -1 }), violation(/spend 0 or more hit dice/));
});

test('a hero needs at least 1 hit point to rest', () => {
  assert.throws(() => shortRest({ ...fighter(), hp: 0 }, scriptedRng([])), violation(/Hero needs at least 1 hit point to rest/));
  assert.throws(() => longRest({ ...fighter(), hp: 0 }), violation(/Hero needs at least 1 hit point to rest/));
  assert.equal(longRest({ ...fighter(), hp: 1 }).hp, fighter().maxHp);
});

test('a Short Rest recharges features as each says, and gives a warlock back its pact slots', () => {
  const spent = useResource(useResource(hero('fighter', 2), 'second-wind'), 'action-surge');
  assert.deepEqual(shortRest(spent, scriptedRng([])).sheet.resourcesUsed, { 'second-wind': 0, 'action-surge': 0 });
  const warlock = spend(hero('warlock', 3), [2, 2]);
  assert.deepEqual(warlock.spellcasting!.expended.slice(0, 2), [0, 2]);
  assert.deepEqual(shortRest(warlock, scriptedRng([])).sheet.spellcasting!.expended, [0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const cleric = spend(hero('cleric', 3), [1, 2]);
  assert.deepEqual(shortRest(cleric, scriptedRng([])).sheet.spellcasting!.expended.slice(0, 2), [1, 1], 'other casters wait for a Long Rest');
});

test('a Long Rest restores hit points, all hit dice, slots and features, ends concentration, and removes one exhaustion level', () => {
  const cleric = hero('cleric', 3);
  const worn = { ...castSpell(spend(cleric, [2]), 'bless').sheet, hp: 3, hitDiceSpent: 3, exhaustion: 2, resourcesUsed: { 'channel-divinity': 1 } };
  const rested = longRest(worn);
  assert.deepEqual(
    [rested.hp, rested.hitDiceSpent, rested.spellcasting!.expended, rested.spellcasting!.concentratingOn, rested.resourcesUsed, rested.exhaustion],
    [cleric.maxHp, 0, [0, 0, 0, 0, 0, 0, 0, 0, 0], null, {}, 1],
  );
  assert.equal(longRest({ ...worn, exhaustion: 0 }).exhaustion, 0);
  assert.equal(longRest(fighter()).spellcasting, null);
});

test('every D20 Test loses 2 per exhaustion level and the revival penalty; a Long Rest eases that by 1', () => {
  assert.deepEqual([d20Modifier(fighter()), d20Modifier({ ...fighter(), exhaustion: 2 }), d20Modifier({ ...fighter(), exhaustion: 1, revivalPenalty: 4 })], [0, -4, -6]);
  const raised = { ...fighter(), revivalPenalty: 4 };
  assert.deepEqual([longRest(raised).revivalPenalty, longRest({ ...raised, revivalPenalty: 1 }).revivalPenalty], [3, 0]);
  assert.equal(Object.hasOwn(longRest(fighter()), 'revivalPenalty'), false, 'nobody else gets one');
});

test('exhaustion stacks to 6; each level is -2 on d20 tests and -5 feet of speed; at 6 the hero dies', () => {
  const tired = gainExhaustion(fighter(), 2);
  assert.equal(tired.exhaustion, 2);
  assert.deepEqual(exhaustionEffects(tired), { d20: -4, speed: -10, dead: false });
  const gone = gainExhaustion(tired, 9);
  assert.deepEqual([gone.exhaustion, exhaustionEffects(gone).dead], [6, true]);
  assert.equal(gainExhaustion(fighter()).exhaustion, 1);
  assert.throws(() => gainExhaustion(fighter(), 0), violation(/gain at least 1 exhaustion level/));
});

test('Arcane Recovery: once per Long Rest, spent slots totalling half the wizard level (rounded up), none above 5th', () => {
  const wizard = spend(hero('wizard', 4), [1, 1, 2]);
  const recovered = arcaneRecovery(wizard, [2]);
  assert.deepEqual([recovered.spellcasting!.expended.slice(0, 2), recovered.resourcesUsed], [[2, 0], { 'arcane-recovery': 1 }]);
  assert.deepEqual(arcaneRecovery(wizard, [1, 1]).spellcasting!.expended.slice(0, 2), [0, 1]);
  assert.throws(() => arcaneRecovery(wizard, [2, 1]), violation(/Arcane Recovery restores at most 2 levels of slots/));
  assert.throws(() => arcaneRecovery(recovered, [1]), violation(/Hero has no Arcane Recovery left/));
  assert.throws(() => arcaneRecovery(hero('wizard', 4), [1]), violation(/Hero has no spent level-1 slot to recover/));
  assert.throws(() => arcaneRecovery({ ...wizard, level: 12 }, [6]), violation(/no slot above level 5/));
  assert.deepEqual(arcaneRecovery(spend(hero('wizard', 9), [5]), [5]).spellcasting!.expended[4], 0, 'a 5th-level slot can come back');
  assert.throws(() => arcaneRecovery(wizard, []), violation(/recover at least one slot/));
});

test('Magical Cunning: once per Long Rest, a warlock regains up to half its pact slots, rounded up', () => {
  const warlock = spend(hero('warlock', 3), [2, 2]);
  const cunning = magicalCunning(warlock);
  assert.deepEqual([cunning.spellcasting!.expended.slice(0, 2), cunning.resourcesUsed], [[0, 1], { 'magical-cunning': 1 }]);
  assert.deepEqual(magicalCunning(spend(hero('warlock', 3), [2])).spellcasting!.expended.slice(0, 2), [0, 0]);
  assert.throws(() => magicalCunning(cunning), violation(/Hero has no Magical Cunning left/));
});
