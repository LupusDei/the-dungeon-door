import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ABILITIES, type Ability } from './abilities.ts';
import { buildCharacter, type CharacterChoices } from './character.ts';
import { awardXp, canLevelUp, encounterXp, type LevelUpChoices, levelForXp, levelUp, splitXp } from './leveling.ts';
import { scriptedRng, seededRng } from './rng.ts';
import type { CharacterSheet } from './sheet.ts';
import { srd } from './srd.ts';
import { RuleViolation } from './violation.ts';

const BRYN: CharacterChoices = {
  name: 'Bryn', classId: 'fighter', speciesId: 'dwarf', backgroundId: 'soldier',
  abilities: { kind: 'standardArray', order: ['str', 'con', 'dex', 'wis', 'int', 'cha'] },
  boost: { kind: 'twoOne', plusTwo: 'str', plusOne: 'con' },
  classChoices: [['skill-perception', 'skill-survival']],
  classEquipment: 0, backgroundEquipment: 0,
};
const MIRA: CharacterChoices = {
  name: 'Mira', classId: 'cleric', speciesId: 'human', backgroundId: 'acolyte',
  abilities: { kind: 'standardArray', order: ['wis', 'con', 'str', 'dex', 'cha', 'int'] },
  boost: { kind: 'twoOne', plusTwo: 'wis', plusOne: 'cha' },
  classChoices: [['skill-medicine', 'skill-history']],
  classEquipment: 0, backgroundEquipment: 1,
  cantrips: ['guidance', 'sacred-flame', 'light'], prepared: ['bless', 'cure-wounds', 'healing-word', 'shield-of-faith'],
};
const bryn = () => buildCharacter(BRYN, seededRng(1));
const milestone = { advancement: 'milestone' as const };
const avg: LevelUpChoices = { hp: 'average' };
const violation = (message: RegExp) => (e: unknown) => e instanceof RuleViolation && message.test(e.message);

/** Level a hero up to `level` by milestones, taking the class's first subclass and +1 to its two lowest scores. */
function climb(sheet: CharacterSheet, level: number): CharacterSheet {
  while (sheet.level < level) {
    const next = srd().classes.get(sheet.classId)!.levels[sheet.level];
    const choices: LevelUpChoices = { hp: 'average' };
    if (sheet.level + 1 === srd().classes.get(sheet.classId)!.subclassLevel) choices.subclassId = srd().classes.get(sheet.classId)!.subclasses[0];
    if (next.features.some((f) => f.id.endsWith('-ability-score-improvement') || f.id.endsWith('-epic-boon'))) {
      const [a, b] = [...ABILITIES].sort((x, y) => sheet.abilityScores[x] - sheet.abilityScores[y]);
      choices.improvement = { kind: 'abilityScores', increases: { [a]: 1, [b]: 1 } };
    }
    sheet = levelUp(sheet, choices, seededRng(sheet.level), milestone);
  }
  return sheet;
}

test('the level for an XP total follows the SRD thresholds, up to 20', () => {
  assert.deepEqual([0, 299, 300, 899, 900, 6500, 354999, 355000, 10 ** 9].map((xp) => levelForXp(xp)), [1, 1, 2, 2, 3, 5, 19, 20, 20]);
});

test('an encounter is worth its monsters\' XP, split evenly among the heroes who earned it', () => {
  assert.equal(encounterXp([0.25, 0.25, 2]), 50 + 50 + 450);
  assert.equal(splitXp(550, 4), 137, 'the remainder is lost');
  assert.equal(splitXp(550, 1), 550);
  assert.throws(() => splitXp(550, 0), violation(/at least one hero/));
});

test('awarding XP adds to the sheet; a hero can level up once it reaches the next threshold', () => {
  const s = awardXp(bryn(), 299);
  assert.equal(s.xp, 299);
  assert.equal(canLevelUp(s), false);
  assert.equal(canLevelUp(awardXp(s, 1)), true);
  assert.throws(() => awardXp(s, -5), violation(/XP awards cannot be negative/));
  assert.equal(awardXp(s, 0).xp, 299, 'nothing is still an award');
  assert.equal(canLevelUp({ ...climb(bryn(), 20), xp: 10 ** 9 }), false, 'level 20 is the last');
});

test('with XP advancement a hero cannot level up before its XP allows', () => {
  assert.throws(() => levelUp(bryn(), avg, seededRng(1)), violation(/Bryn needs 300 XP to reach level 2/));
  assert.equal(levelUp(awardXp(bryn(), 300), avg, seededRng(1)).level, 2);
});

test('with milestones the DM decides; the XP is raised to the new level\'s threshold', () => {
  const s = levelUp(bryn(), avg, seededRng(1), milestone);
  assert.deepEqual([s.level, s.xp], [2, 300]);
  assert.equal(levelUp(awardXp(bryn(), 500), avg, seededRng(1), milestone).xp, 500, 'more XP is kept');
});

test('hit points rise by the average or a roll of the hit die, plus CON and Dwarven Toughness', () => {
  const average = levelUp(bryn(), avg, seededRng(1), milestone);
  assert.deepEqual([average.hpRolls, average.maxHp, average.hp], [[10, 6], 13 + 6 + 3, 13 + 6 + 3]);
  const rolled = levelUp(bryn(), { hp: 'roll' }, scriptedRng([2]), milestone);
  assert.deepEqual([rolled.hpRolls, rolled.maxHp], [[10, 2], 13 + 2 + 3]);
  const hurt = levelUp({ ...bryn(), hp: 4 }, avg, seededRng(1), milestone);
  assert.equal(hurt.hp, 4 + 9, 'a wounded hero gains the new hit points, not a full heal');
});

test('a level-up brings the new proficiency bonus, class features, and spell slots', () => {
  const fighter = climb(bryn(), 5);
  assert.equal(fighter.proficiencyBonus, 3);
  assert.ok(fighter.features.includes('Action Surge') && fighter.features.includes('Extra Attack'));
  assert.deepEqual(fighter.features.slice(0, 3), ['Fighting Style', 'Second Wind', 'Weapon Mastery']);
  const cleric = climb(buildCharacter(MIRA, seededRng(1)), 5);
  assert.deepEqual(cleric.spellcasting!.slots, [4, 3, 2, 0, 0, 0, 0, 0, 0]);
});

test('the subclass is chosen at its level, from the class\'s list, and brings its features', () => {
  const two = climb(bryn(), 2);
  assert.throws(() => levelUp(two, avg, seededRng(1), milestone), violation(/choose a Fighter subclass: champion/));
  assert.throws(() => levelUp(two, { ...avg, subclassId: 'evoker' }, seededRng(1), milestone), violation(/evoker is not a Fighter subclass/));
  assert.throws(() => levelUp(bryn(), { ...avg, subclassId: 'champion' }, seededRng(1), milestone), violation(/a Fighter chooses a subclass at level 3/));
  const three = levelUp(two, { ...avg, subclassId: 'champion' }, seededRng(1), milestone);
  assert.equal(three.subclassId, 'champion');
  assert.ok(three.features.includes('Improved Critical'));
  assert.ok(climb(three, 7).features.includes('Remarkable Athlete'));
});

test('an Ability Score Improvement adds 2 to one score or 1 to two, never above 20', () => {
  const three = climb(bryn(), 3);
  const asi = (increases: Partial<Record<Ability, number>>) => levelUp(three, { ...avg, improvement: { kind: 'abilityScores', increases } }, seededRng(1), milestone);
  assert.equal(asi({ dex: 2 }).abilityScores.dex, three.abilityScores.dex + 2);
  assert.deepEqual([asi({ dex: 1, wis: 1 }).abilityScores.dex, asi({ dex: 1, wis: 1 }).abilityScores.wis], [three.abilityScores.dex + 1, three.abilityScores.wis + 1]);
  assert.throws(() => asi({ dex: 1 }), violation(/an Ability Score Improvement is \+2 to one score or \+1 to two/));
  assert.throws(() => asi({ dex: 3 }), violation(/\+2 to one score or \+1 to two/));
  assert.throws(() => asi({ dex: 1, wis: 1, int: 0 }), violation(/\+2 to one score or \+1 to two/));
  assert.equal(levelUp({ ...three, abilityScores: { ...three.abilityScores, str: 18 } }, { ...avg, improvement: { kind: 'abilityScores', increases: { str: 2 } } }, seededRng(1), milestone).abilityScores.str, 20, 'up to 20 exactly');
  assert.throws(() => levelUp({ ...three, abilityScores: { ...three.abilityScores, str: 19 } }, { ...avg, improvement: { kind: 'abilityScores', increases: { str: 2 } } }, seededRng(1), milestone), violation(/str cannot go above 20/));
  assert.throws(() => levelUp(three, avg, seededRng(1), milestone), violation(/level 4 brings an Ability Score Improvement or a feat/));
  assert.throws(() => levelUp(bryn(), { ...avg, improvement: { kind: 'abilityScores', increases: { str: 2 } } }, seededRng(1), milestone), violation(/level 2 brings no Ability Score Improvement/));
});

test('raising CON raises max HP by 1 per level for every level already gained', () => {
  const three = climb(bryn(), 3);
  const four = levelUp(three, { ...avg, improvement: { kind: 'abilityScores', increases: { con: 2 } } }, seededRng(1), milestone);
  assert.equal(four.maxHp, three.maxHp + 6 + 3 + 4);
});

test('a general feat instead: its prerequisite met, its +1 to an allowed score, once', () => {
  const three = climb(bryn(), 3);
  const feat = (featId: string, increase?: Ability, sheet = three) => levelUp(sheet, { ...avg, improvement: { kind: 'feat', featId, increase } }, seededRng(1), milestone);
  const grappler = feat('grappler', 'str');
  assert.deepEqual([grappler.feats, grappler.abilityScores.str], [['grappler'], three.abilityScores.str + 1]);
  assert.throws(() => feat('grappler', 'con'), violation(/Grappler raises str or dex/));
  assert.throws(() => feat('grappler'), violation(/Grappler raises str or dex/));
  assert.throws(() => feat('grappler', 'str', { ...three, abilityScores: { ...three.abilityScores, str: 12, dex: 12 } }), violation(/Grappler needs str or dex 13/));
  assert.equal(feat('grappler', 'dex', { ...three, abilityScores: { ...three.abilityScores, str: 12, dex: 13 } }).abilityScores.dex, 14, 'exactly 13 will do');
  assert.throws(() => feat('alert'), violation(/Alert is not a feat you can take at level 4/));
  assert.throws(() => feat('boon-of-fate', 'con'), violation(/Boon of Fate is not a feat you can take at level 4/));
  assert.throws(() => feat('ability-score-improvement'), violation(/Ability Score Improvement is not a feat you can take at level 4/));
  assert.throws(() => feat('archery'), violation(/Archery is not a feat you can take/));
  assert.throws(() => feat('nope'), violation(/there is no feat nope/));
  assert.throws(() => levelUp(climb(grappler, 5), { ...avg, improvement: { kind: 'feat', featId: 'grappler', increase: 'dex' } }, seededRng(1), milestone), violation(/Bryn already has Grappler/));
});

test('at 19 an epic boon may raise a score up to 30; a spellcasting boon needs spellcasting', () => {
  const eighteen = climb(bryn(), 18);
  const at20 = { ...eighteen, abilityScores: { ...eighteen.abilityScores, con: 20 } };
  const boon = levelUp(at20, { ...avg, improvement: { kind: 'feat', featId: 'boon-of-fate', increase: 'con' } }, seededRng(1), milestone);
  assert.deepEqual([boon.abilityScores.con, boon.feats.at(-1)], [21, 'boon-of-fate']);
  assert.throws(() => levelUp(eighteen, { ...avg, improvement: { kind: 'feat', featId: 'boon-of-spell-recall', increase: 'wis' } }, seededRng(1), milestone), violation(/Boon of Spell Recall needs Spellcasting/));
  assert.equal(levelUp(eighteen, { ...avg, improvement: { kind: 'feat', featId: 'grappler', increase: 'str' } }, seededRng(1), milestone).level, 19, 'or a general feat');
  const twenty = climb(boon, 20);
  assert.throws(() => levelUp(twenty, avg, seededRng(1), milestone), violation(/Bryn is already level 20/));
});

test('a leveled sheet is plain JSON and the same for the same seed and choices', () => {
  const a = levelUp(awardXp(bryn(), 300), { hp: 'roll' }, seededRng(9));
  assert.deepEqual(levelUp(awardXp(bryn(), 300), { hp: 'roll' }, seededRng(9)), a);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
});

test('a feat that grants no ability increase is simply taken', () => {
  const lucky = { id: 'lucky', name: 'Lucky', type: 'general' as const, minLevel: 4, prerequisite: null, increase: null, needsSpellcasting: false };
  const data = { ...srd(), feats: new Map([...srd().feats, ['lucky', lucky]]) };
  const three = climb(bryn(), 3);
  const four = levelUp(three, { ...avg, improvement: { kind: 'feat', featId: 'lucky' } }, seededRng(1), milestone, data);
  assert.deepEqual([four.feats, four.abilityScores], [['lucky'], three.abilityScores]);
});
