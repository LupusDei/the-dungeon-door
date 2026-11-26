import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addItem } from './inventory.ts';
import { breathMinutes, sufferHazard } from './hazards.ts';
import { scriptedRng } from './rng.ts';
import { SAMPLE } from './sheet.fixture.ts';

const bryn = { ...SAMPLE, equipment: [] };

test('falling: 1d6 Bludgeoning per 10 feet, at most 20d6, and the hero lands Prone', () => {
  const fell = sufferHazard(scriptedRng([2, 3, 4]), bryn, { kind: 'falling', feet: 35 });
  assert.deepEqual([fell.sheet.hp, fell.line], [SAMPLE.hp - 9, 'Bryn falls 35 feet: 9 Bludgeoning damage, and lands Prone']);
  assert.equal(sufferHazard(scriptedRng(Array(20).fill(1)), { ...bryn, hp: 30, maxHp: 30 }, { kind: 'falling', feet: 500 }).sheet.hp, 10);
  assert.deepEqual(sufferHazard(scriptedRng([]), bryn, { kind: 'falling', feet: 5 }), { sheet: bryn, line: 'Bryn drops 5 feet, unhurt' });
  assert.equal(sufferHazard(scriptedRng([6, 6]), { ...bryn, hp: 4 }, { kind: 'falling', feet: 20 }).sheet.hp, 0);
  assert.equal(sufferHazard(scriptedRng(Array(20).fill(6)), bryn, { kind: 'falling', feet: 200 }).sheet.dead, true, 'massive damage');
});

test('burning: 1d4 Fire, then the hero drops Prone and rolls to put it out', () => {
  assert.equal(sufferHazard(scriptedRng([3]), { ...bryn, traits: ['lineage-resistance-fire'] }, { kind: 'burning' }).line, 'Bryn catches fire: 1 Fire damage, then drops Prone and rolls to put it out', 'resisted');
  assert.deepEqual(sufferHazard(scriptedRng([3]), bryn, { kind: 'burning' }), { sheet: { ...bryn, hp: SAMPLE.hp - 3 }, line: 'Bryn catches fire: 3 Fire damage, then drops Prone and rolls to put it out' });
});

test('suffocation: breath lasts 1 + CON minutes (at least 30 seconds); then 1 Exhaustion a round, lifted on breathing again, death at 6', () => {
  assert.deepEqual([breathMinutes(bryn), breathMinutes({ ...bryn, abilityScores: { ...bryn.abilityScores, con: 8 } })], [3, 0.5]);
  assert.deepEqual(sufferHazard(scriptedRng([]), bryn, { kind: 'suffocation', minutes: 3 }), { sheet: bryn, line: 'Bryn holds their breath long enough' });
  assert.equal(sufferHazard(scriptedRng([]), bryn, { kind: 'suffocation', minutes: 3.1 }).line, 'Bryn runs out of breath and suffocates for 1 round, then recovers on breathing again');
  const short = sufferHazard(scriptedRng([]), bryn, { kind: 'suffocation', minutes: 3.5 });
  assert.deepEqual([short.sheet, short.line], [bryn, 'Bryn runs out of breath and suffocates for 5 rounds, then recovers on breathing again']);
  const dies = sufferHazard(scriptedRng([]), { ...bryn, exhaustion: 1 }, { kind: 'suffocation', minutes: 3.5 });
  assert.deepEqual([dies.sheet.exhaustion, dies.sheet.dead, dies.line], [6, true, 'Bryn runs out of breath and suffocates for 5 rounds: Exhaustion 6, and dies']);
});

test('extreme cold: a DC 10 Constitution save each hour or 1 Exhaustion (which then costs 2 on the next save)', () => {
  assert.equal(sufferHazard(scriptedRng([5, 7]), bryn, { kind: 'extreme-cold', hours: 2 }).sheet.exhaustion, 2, '7 + 4 - 2 = 9 fails');
  const cold = sufferHazard(scriptedRng([5, 8, 10]), bryn, { kind: 'extreme-cold', hours: 3 });
  assert.deepEqual([cold.sheet.exhaustion, cold.line], [1, 'Bryn endures 3 hours of extreme cold and fails 1 Constitution save: Exhaustion 1']);
  assert.deepEqual(sufferHazard(scriptedRng([6]), bryn, { kind: 'extreme-cold', hours: 1 }).line, 'Bryn endures 1 hour of extreme cold and fails no Constitution save');
});

test('extreme heat: the DC is 5, +1 each hour; Medium or Heavy armor gives Disadvantage; drinkable water spares the hero', () => {
  const armored = addItem(bryn, 'chain-mail');
  const heat = sufferHazard(scriptedRng([2, 9, 1, 20, 2, 3]), armored, { kind: 'extreme-heat', hours: 3 });
  assert.deepEqual([heat.sheet.exhaustion, heat.line], [2, 'Bryn endures 3 hours of extreme heat and fails 2 Constitution saves: Exhaustion 2']);
  const light = sufferHazard(scriptedRng([1, 2]), addItem(addItem(bryn, 'torch'), 'leather-armor'), { kind: 'extreme-heat', hours: 2 });
  assert.equal(light.sheet.exhaustion, 0, 'DC 5 then 6: 1 + 4 and 2 + 4 pass');
  assert.equal(sufferHazard(scriptedRng([9, 1]), addItem({ ...bryn, saveBonuses: { ...bryn.saveBonuses, con: 0 } }, 'breastplate'), { kind: 'extreme-heat', hours: 1 }).sheet.exhaustion, 1, 'Medium armor too');
  assert.deepEqual(sufferHazard(scriptedRng([]), addItem(armored, 'waterskin'), { kind: 'extreme-heat', hours: 8 }).line, 'Bryn has drinkable water: the heat is bearable');
});

test('dehydration and malnutrition: Exhaustion for a hero with no water or food', () => {
  assert.deepEqual(sufferHazard(scriptedRng([]), bryn, { kind: 'dehydration' }).sheet.exhaustion, 1);
  assert.equal(sufferHazard(scriptedRng([]), bryn, { kind: 'dehydration' }).line, 'Bryn has too little water: Exhaustion 1');
  assert.equal(sufferHazard(scriptedRng([]), addItem(bryn, 'waterskin'), { kind: 'dehydration' }).line, 'Bryn has water enough');
  const starving = (days: number) => sufferHazard(scriptedRng([]), bryn, { kind: 'malnutrition', days }).sheet.exhaustion;
  assert.deepEqual([starving(4), starving(5), starving(7)], [0, 1, 3], 'CON +2: 5 days before the first level');
  assert.equal(sufferHazard(scriptedRng([]), { ...bryn, abilityScores: { ...bryn.abilityScores, con: 3 } }, { kind: 'malnutrition', days: 1 }).sheet.exhaustion, 1, 'at least 1 day');
  assert.equal(sufferHazard(scriptedRng([]), addItem(bryn, 'rations'), { kind: 'malnutrition', days: 30 }).line, 'Bryn has food enough');
  assert.equal(sufferHazard(scriptedRng([]), bryn, { kind: 'malnutrition', days: 2 }).line, 'Bryn goes hungry but holds up');
});

test('exhaustion 6 from any hazard is death', () => {
  const last = sufferHazard(scriptedRng([]), { ...bryn, exhaustion: 5 }, { kind: 'dehydration' });
  assert.deepEqual([last.sheet.exhaustion, last.sheet.dead, last.line], [6, true, 'Bryn has too little water: Exhaustion 6, and dies']);
});
