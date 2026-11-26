import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCharacter, quickChoices } from './character.ts';
import { climb } from './leveling.fixture.ts';
import { rechargeResources, resourcesOf, useResource } from './resources.ts';
import { seededRng } from './rng.ts';
import type { CharacterSheet } from './sheet.ts';
import { SAMPLE } from './sheet.fixture.ts';
import { RuleViolation } from './violation.ts';

const hero = (classId: string, level = 1): CharacterSheet =>
  climb(buildCharacter(quickChoices(seededRng(2), { name: 'Hero', classId }), seededRng(2)), level);
const violation = (message: RegExp) => (e: unknown) => e instanceof RuleViolation && message.test(e.message);
const summary = (sheet: CharacterSheet) => resourcesOf(sheet).map((r) => [r.id, r.max, r.left, r.shortRest]);

test('a level-1 fighter has Second Wind twice; Action Surge comes at 2 and twice at 17', () => {
  assert.deepEqual(summary(SAMPLE), [['second-wind', 2, 2, 'one']]);
  assert.deepEqual(summary(hero('fighter', 2)), [['second-wind', 2, 2, 'one'], ['action-surge', 1, 1, 'all']]);
  assert.deepEqual(summary(hero('fighter', 17)), [['second-wind', 4, 4, 'one'], ['action-surge', 2, 2, 'all']]);
});

test('each class\'s resources follow its table: Rage, Channel Divinity, Focus, Wild Shape, Sorcery Points', () => {
  assert.deepEqual(summary(hero('barbarian', 3)), [['rage', 3, 3, 'one']]);
  assert.deepEqual(summary(hero('cleric')), [], 'Channel Divinity starts at 2');
  assert.deepEqual(summary(hero('cleric', 6)), [['channel-divinity', 3, 3, 'one']]);
  assert.deepEqual(summary(hero('paladin', 3)), [['lay-on-hands', 15, 15, 'none'], ['channel-divinity', 2, 2, 'one']]);
  assert.deepEqual(summary(hero('monk', 5)), [['focus', 5, 5, 'all']]);
  assert.deepEqual(summary(hero('druid', 2)), [['wild-shape', 2, 2, 'one']]);
  assert.deepEqual(summary(hero('sorcerer', 4)), [['sorcery-points', 4, 4, 'none']]);
  assert.deepEqual(summary(hero('wizard')), [['arcane-recovery', 1, 1, 'none']]);
  assert.deepEqual(summary(hero('warlock', 2)), [['magical-cunning', 1, 1, 'none']]);
  assert.deepEqual(summary(hero('rogue', 5)), []);
});

test('Bardic Inspiration: CHA modifier uses (at least 1), back on a Short Rest from Font of Inspiration', () => {
  const bard = hero('bard');
  const cha = Math.floor((bard.abilityScores.cha - 10) / 2);
  assert.deepEqual(summary(bard), [['bardic-inspiration', Math.max(1, cha), Math.max(1, cha), 'none']]);
  assert.deepEqual(summary({ ...bard, abilityScores: { ...bard.abilityScores, cha: 8 } })[0].slice(1, 3), [1, 1]);
  assert.equal(summary(hero('bard', 5))[0][3], 'all');
});

test('using a resource spends it; it cannot be spent past its maximum or if the hero lacks it', () => {
  const once = useResource(SAMPLE, 'second-wind');
  assert.deepEqual([once.resourcesUsed, resourcesOf(once)[0].left], [{ 'second-wind': 1 }, 1]);
  const twice = useResource(once, 'second-wind');
  assert.throws(() => useResource(twice, 'second-wind'), violation(/Bryn has no Second Wind left/));
  assert.throws(() => useResource(SAMPLE, 'rage'), violation(/Bryn has no rage/));
  const paladin = hero('paladin', 3);
  assert.equal(resourcesOf(useResource(paladin, 'lay-on-hands', 15))[0].left, 0, 'a pool spends many at once');
  assert.throws(() => useResource(paladin, 'lay-on-hands', 16), violation(/Hero has no Lay On Hands left/));
  assert.throws(() => useResource(paladin, 'lay-on-hands', 0), violation(/use at least 1/));
});

test('a Short Rest gives back one use or all, as each feature says; a Long Rest gives back everything', () => {
  const fighter = hero('fighter', 2);
  const spent = useResource(useResource(useResource(fighter, 'second-wind'), 'second-wind'), 'action-surge');
  const short = rechargeResources(spent, 'short');
  assert.deepEqual(short.resourcesUsed, { 'second-wind': 1, 'action-surge': 0 });
  assert.deepEqual(rechargeResources(short, 'short').resourcesUsed, { 'second-wind': 0, 'action-surge': 0 });
  assert.deepEqual(rechargeResources(spent, 'long').resourcesUsed, {});
  const sorcerer = useResource(hero('sorcerer', 4), 'sorcery-points', 3);
  assert.deepEqual(rechargeResources(sorcerer, 'short').resourcesUsed, { 'sorcery-points': 3 });
});
