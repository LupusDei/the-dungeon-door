import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCharacter, type CharacterChoices, quickChoices } from './character.ts';
import { climb } from './leveling.fixture.ts';
import { seededRng } from './rng.ts';
import type { CharacterSheet } from './sheet.ts';
import { SAMPLE } from './sheet.fixture.ts';
import { beamsAt, castSpell, concentrationDc, endConcentration, maxSpellLevel, prepareSpells, slotsLeft, spellDamageDice, spellHealingDice } from './spells.ts';
import { srd } from './srd.ts';
import { RuleViolation } from './violation.ts';

const MIRA: CharacterChoices = {
  name: 'Mira', classId: 'cleric', speciesId: 'human', backgroundId: 'acolyte',
  abilities: { kind: 'standardArray', order: ['wis', 'con', 'str', 'dex', 'cha', 'int'] },
  boost: { kind: 'twoOne', plusTwo: 'wis', plusOne: 'cha' },
  classChoices: [['skill-medicine', 'skill-history']],
  classEquipment: 0, backgroundEquipment: 1,
  cantrips: ['guidance', 'sacred-flame', 'light'], prepared: ['bless', 'cure-wounds', 'healing-word', 'shield-of-faith'],
};
const mira = () => buildCharacter(MIRA, seededRng(1));
const violation = (message: RegExp) => (e: unknown) => e instanceof RuleViolation && message.test(e.message);
const spell = (id: string) => srd().spells.get(id)!;
const casting = (s: CharacterSheet) => s.spellcasting!;

test('the highest spell level a caster can cast is its highest level with slots', () => {
  assert.equal(maxSpellLevel([4, 3, 2, 0, 0, 0, 0, 0, 0]), 3);
  assert.equal(maxSpellLevel([0, 2, 0, 0, 0, 0, 0, 0, 0]), 2, 'pact slots');
  assert.equal(maxSpellLevel([0, 0, 0, 0, 0, 0, 0, 0, 0]), 0);
  assert.equal(maxSpellLevel([4, 3, 3, 1, 0, 0, 0, 0, 0]), 4, 'one slot is enough');
  assert.deepEqual(slotsLeft(SAMPLE), [], 'a hero with no spellcasting has no slots');
});

test('preparing spells: the right number of each, from the class list, no higher than the caster can cast', () => {
  const three = climb(mira(), 3);
  const cantrips = ['guidance', 'light', 'thaumaturgy'];
  const prepared = ['bless', 'cure-wounds', 'healing-word', 'shield-of-faith', 'hold-person', 'aid'];
  assert.deepEqual([casting(prepareSpells(three, cantrips, prepared)).cantrips, casting(prepareSpells(three, cantrips, prepared)).prepared], [cantrips, prepared]);
  assert.throws(() => prepareSpells(three, cantrips, prepared.slice(1)), violation(/choose 6 prepared spells/));
  assert.throws(() => prepareSpells(three, ['guidance', 'light'], prepared), violation(/choose 3 cantrips/));
  assert.throws(() => prepareSpells(three, cantrips, [...prepared.slice(1), 'fireball']), violation(/fireball is not a Cleric spell of level 1 to 2/));
  assert.throws(() => prepareSpells(three, cantrips, [...prepared.slice(1), 'spirit-guardians']), violation(/spirit-guardians is not a Cleric spell of level 1 to 2/));
  assert.throws(() => prepareSpells(three, ['guidance', 'light', 'fire-bolt'], prepared), violation(/fire-bolt is not a Cleric cantrip/));
  assert.throws(() => prepareSpells(three, cantrips, [...prepared.slice(1), 'aid']), violation(/aid is chosen twice/));
  assert.throws(() => prepareSpells(SAMPLE, [], []), violation(/Bryn casts no spells/));
  assert.throws(() => prepareSpells(three, ['guidance', 'light', 'bless'], prepared), violation(/bless is not a Cleric cantrip/));
  assert.throws(() => prepareSpells(three, cantrips, [...prepared.slice(1), 'thaumaturgy']), violation(/thaumaturgy is not a Cleric spell of level 1 to 2/));
});

test('a cantrip costs no slot, and its damage grows at character levels 5, 11 and 17', () => {
  const { sheet, cast } = castSpell(mira(), 'sacred-flame');
  assert.deepEqual(casting(sheet).expended, casting(mira()).expended);
  assert.deepEqual(cast, { spellId: 'sacred-flame', slotLevel: 0, damageDice: '1d8', beams: 1, healingDice: null, endedConcentration: null });
  assert.equal(castSpell(climb(mira(), 5), 'sacred-flame').cast.damageDice, '2d8');
  assert.throws(() => castSpell(mira(), 'fire-bolt'), violation(/Mira does not know the cantrip fire-bolt/));
  assert.throws(() => castSpell(mira(), 'sacred-flame', 1), violation(/a cantrip uses no slot/));
});

test('cantrip dice and beams by character level', () => {
  assert.deepEqual([1, 4, 5, 10, 11, 16, 17, 20].map((level) => spellDamageDice(spell('fire-bolt'), 0, level)), ['1d10', '1d10', '2d10', '2d10', '3d10', '3d10', '4d10', '4d10']);
  assert.deepEqual([1, 4, 5, 11, 17].map((level) => beamsAt(spell('eldritch-blast'), level)), [1, 1, 2, 3, 4]);
  assert.equal(spellDamageDice(spell('eldritch-blast'), 0, 17), '1d10', 'each beam is its own attack');
  assert.equal(beamsAt(spell('fireball'), 17), 1);
});

test('a leveled spell spends a slot of its level, or a higher one for more dice', () => {
  const { sheet, cast } = castSpell(mira(), 'cure-wounds');
  assert.deepEqual([casting(sheet).expended[0], cast.slotLevel, cast.healingDice, cast.damageDice], [1, 1, '2d8', null]);
  assert.deepEqual(slotsLeft(sheet), [1, 0, 0, 0, 0, 0, 0, 0, 0]);
  const up = castSpell(climb(mira(), 3), 'cure-wounds', 2);
  assert.deepEqual([up.cast.slotLevel, up.cast.healingDice, casting(up.sheet).expended.slice(0, 2)], [2, '4d8', [0, 1]]);
  assert.deepEqual([3, 4, 5, 9].map((slot) => spellDamageDice(spell('fireball'), slot, 9)), ['8d6', '9d6', '10d6', '14d6']);
  assert.equal(spellDamageDice(spell('hold-person'), 2, 3), null);
  assert.equal(spellDamageDice(spell('befuddlement'), 9, 17), '10d12', 'no upcast in its text: the same dice');
  assert.equal(spellHealingDice({ ...spell('cure-wounds'), healing: { dice: '3d8', upcastDice: null } }, 5), '3d8');
  assert.equal(spellHealingDice(spell('fireball'), 3), null);
});

test('casting needs the spell prepared and a slot left at or above its level', () => {
  const spent = castSpell(castSpell(mira(), 'bless').sheet, 'cure-wounds').sheet;
  assert.throws(() => castSpell(spent, 'healing-word'), violation(/Mira has no slot of level 1 or higher left/));
  assert.throws(() => castSpell(mira(), 'aid'), violation(/Mira has not prepared aid/));
  assert.throws(() => castSpell(mira(), 'nope'), violation(/there is no spell nope/));
  const three = prepareSpells(climb(mira(), 3), ['guidance', 'light', 'thaumaturgy'], ['bless', 'cure-wounds', 'healing-word', 'shield-of-faith', 'hold-person', 'aid']);
  assert.throws(() => castSpell(three, 'aid', 1), violation(/aid is a level-2 spell/));
  assert.throws(() => castSpell(three, 'aid', 3), violation(/Mira has no level-3 slot left/));
  assert.throws(() => castSpell(three, 'aid', 10), violation(/there are no level-10 slots/));
  const twice = castSpell(castSpell(three, 'aid', 2).sheet, 'aid', 2);
  assert.deepEqual([twice.cast.slotLevel, slotsLeft(twice.sheet)[1]], [2, 0], 'at its own level, down to the last slot');
  const archmage = { ...three, spellcasting: { ...three.spellcasting!, slots: [4, 3, 3, 3, 3, 2, 2, 1, 1] } };
  assert.equal(castSpell(archmage, 'cure-wounds', 9).cast.healingDice, '18d8', 'level 9 is the highest slot');
  assert.throws(() => castSpell(SAMPLE, 'bless'), violation(/Bryn casts no spells/));
});

test('without a slot level, the lowest slot left at or above the spell\'s level is used', () => {
  const three = climb(mira(), 3);
  const once = castSpell(three, 'bless');
  assert.equal(once.cast.slotLevel, 1);
  const fourTimes = [1, 2, 3].reduce((s) => castSpell(s, 'bless').sheet, once.sheet);
  assert.equal(castSpell(fourTimes, 'bless').cast.slotLevel, 2);
});

test('a warlock casts every spell with its pact slots, at the pact slot level', () => {
  const warlock = climb(buildCharacter(quickChoices(seededRng(3), { name: 'Vex', classId: 'warlock' }), seededRng(3)), 3);
  assert.deepEqual(casting(warlock).slots.slice(0, 2), [0, 2]);
  const { sheet, cast } = castSpell(warlock, 'hellish-rebuke');
  assert.deepEqual([cast.slotLevel, casting(sheet).expended.slice(0, 2), cast.damageDice], [2, [0, 1], '3d10']);
});

test('concentrating on a new spell ends the old one', () => {
  const blessed = castSpell(climb(mira(), 3), 'bless');
  assert.deepEqual([casting(blessed.sheet).concentratingOn, blessed.cast.endedConcentration], ['bless', null]);
  const shielded = castSpell(blessed.sheet, 'shield-of-faith');
  assert.deepEqual([casting(shielded.sheet).concentratingOn, shielded.cast.endedConcentration], ['shield-of-faith', 'bless']);
  assert.equal(casting(castSpell(shielded.sheet, 'cure-wounds').sheet).concentratingOn, 'shield-of-faith', 'a spell without concentration leaves it');
  assert.equal(casting(endConcentration(shielded.sheet)).concentratingOn, null);
  assert.equal(endConcentration(SAMPLE), SAMPLE);
});

test('the concentration save DC is half the damage, at least 10 and at most 30', () => {
  assert.deepEqual([1, 20, 21, 22, 23, 59, 60, 61, 200].map(concentrationDc), [10, 10, 10, 11, 11, 29, 30, 30, 30]);
});
