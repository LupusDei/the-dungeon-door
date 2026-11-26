import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heroSheet } from '../characters.ts';
import type { CharacterSheet } from '../rules/sheet.ts';
import { DAY, provisions } from './provisions.ts';
import type { PartyState } from './state.ts';

const base = heroSheet({ id: 'f', name: 'Bryn', race: 'human', characterClass: 'fighter' });
const bare = { ...base, equipment: base.equipment.filter((e) => e.id !== 'rations' && e.id !== 'waterskin') };
const kit = (rations: number, water = true): CharacterSheet => ({
  ...bare, equipment: [...bare.equipment, ...(rations ? [{ id: 'rations', name: 'Rations', count: rations }] : []), ...(water ? [{ id: 'waterskin', name: 'Waterskin', count: 1 }] : [])],
});
const party = (clock: number, ...sheets: CharacterSheet[]): PartyState =>
  ({ version: 1, rng: 1, clock, sheets: Object.fromEntries(sheets.map((s, i) => [`p${i + 1}`, s])) });

test('no morning passed: nothing happens', () => {
  const p = party(DAY - 1, kit(2));
  assert.deepEqual(provisions(p, 0), { party: p, lines: [] });
  assert.deepEqual(provisions(party(2 * DAY - 1, kit(2)), DAY).lines, []);
});

test('each morning a hero with Rations eats one; with a Waterskin it has water enough', () => {
  const fed = provisions(party(DAY, kit(2)), DAY - 1);
  assert.deepEqual(fed.lines, ['A new day.', "Bryn eats a day's Rations (1 left)."]);
  assert.equal(fed.party.sheets.p1.equipment.find((e) => e.id === 'rations')!.count, 1);
  assert.equal(fed.party.sheets.p1.hungry, 0);
  const last = provisions(party(DAY, kit(1)), 0);
  assert.equal(last.party.sheets.p1.equipment.some((e) => e.id === 'rations'), false);
});

test('without food the days add up, and malnutrition brings Exhaustion in time; without water, dehydration', () => {
  const two = provisions(party(2 * DAY, { ...kit(0), hungry: 0 }), 0);
  assert.deepEqual(two.lines, ['A new day.', 'Bryn goes hungry but holds up.', 'A new day.', 'Bryn goes hungry but holds up.']);
  assert.equal(two.party.sheets.p1.hungry, 2);
  const long = provisions(party(DAY, { ...kit(0), hungry: 9 }), 0);
  assert.match(long.lines[1], /^Bryn goes 10 days without food: Exhaustion \d\.$/);
  assert.ok(long.party.sheets.p1.exhaustion > 0);
  const dry = provisions(party(DAY, kit(3, false)), 0);
  assert.deepEqual(dry.lines.slice(2), ['Bryn has too little water: Exhaustion 1.']);
  assert.equal(dry.party.sheets.p1.exhaustion, 1);
  const ate = provisions(party(DAY, { ...kit(1), hungry: 2 }), 0);
  assert.equal(ate.party.sheets.p1.hungry, 0, 'eating ends the hunger');
});

test('the dead neither eat nor drink; one who starves to death drinks no more', () => {
  const ghost = { ...kit(2), dead: true };
  const p = provisions(party(DAY, ghost), 0);
  assert.deepEqual(p.lines, ['A new day.']);
  assert.equal(p.party.sheets.p1, ghost);
  const dying = provisions(party(DAY, { ...kit(0, false), hungry: 30, exhaustion: 5 }), 0);
  assert.match(dying.lines[1], /and dies\.$/);
  assert.equal(dying.lines.length, 2, 'no water line for the dead');
});
