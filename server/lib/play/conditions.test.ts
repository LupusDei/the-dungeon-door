import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SAMPLE } from '../rules/sheet.fixture.ts';
import { shakeOff } from './conditions.ts';
import type { PartyState } from './state.ts';

const netted = { condition: 'restrained' as const, until: { kind: 'escape' as const, ability: 'str' as const, skill: 'athletics', dc: 10 } };
const held = { condition: 'paralyzed' as const, until: { kind: 'save' as const, ability: 'con' as const, dc: 12 } };
const sick = { condition: 'poisoned' as const, until: { kind: 'time' as const, left: 600 } };
const party = (rng: number, ...conditions: (typeof netted | typeof held | typeof sick)[]): PartyState =>
  ({ version: 1, rng, sheets: { p1: { ...SAMPLE, conditions }, p2: { ...SAMPLE, name: 'Ann' } } });

test('each turn a hero tries once to end what a save or a check ends: success ends it', () => {
  const tries = Array.from({ length: 40 }, (_, i) => shakeOff(party(i + 1, netted, held, sick)));
  const free = tries.find((t) => !t.party.sheets.p1.conditions!.some((c) => c.condition === 'restrained'))!;
  assert.ok(free.lines.some((l) => /^Bryn breaks free \(Athletics \d+ vs DC 10\)\.$/.test(l)), free.lines.join('|'));
  const stuck = tries.find((t) => t.party.sheets.p1.conditions!.some((c) => c.condition === 'restrained'))!;
  assert.ok(stuck.lines.some((l) => /^Bryn is still Restrained \(Athletics \d+ vs DC 10\)\.$/.test(l)));
  assert.ok(tries.some((t) => t.lines.some((l) => /^Bryn shakes off Paralyzed \(CON save \d+ vs DC 12\)\.$/.test(l))));
  assert.ok(tries.every((t) => t.party.sheets.p1.conditions!.some((c) => c.condition === 'poisoned')), 'time, not dice, ends Poisoned');
  assert.ok(tries.every((t) => t.party.sheets.p2.conditions === undefined));
  assert.notEqual(tries[0].party.rng, 1);
});

test('nothing to shake off: nothing changes and no dice are rolled', () => {
  assert.deepEqual(shakeOff(party(7, sick)), { party: party(7, sick), lines: [] });
  const dead = { ...party(7, netted), sheets: { p1: { ...SAMPLE, dead: true, conditions: [netted] } } };
  assert.deepEqual(shakeOff(dead).lines, []);
});
