import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heroSheet } from '../characters.ts';
import { addItem } from '../rules/inventory.ts';
import type { CharacterSheet } from '../rules/sheet.ts';
import { startDungeon } from './delve.ts';
import type { PartyState } from './state.ts';
import { ambientLight, clockOf, lightLevel, lightUp, passTime, secondsFor } from './time.ts';

const bare = (s: CharacterSheet) => ({ ...s, equipment: [] });
const fighter = bare(heroSheet({ id: 'f', name: 'Bryn', race: 'human', characterClass: 'fighter' }));
const rogue = bare(heroSheet({ id: 'r', name: 'Cleo', race: 'human', characterClass: 'rogue' }));
const party = (a: CharacterSheet = fighter, b: CharacterSheet = rogue): PartyState => ({ version: 1, rng: 1, sheets: { p1: a, p2: b } });
const torches = (s: CharacterSheet, n: number) => addItem(s, 'torch', n);

test('the clock starts at 0 and only moves forward', () => {
  assert.equal(clockOf(party()), 0);
  assert.equal(clockOf(passTime(party(), 600, 'bright').party), 600);
  assert.equal(clockOf(passTime(passTime(party(), 600, 'bright').party, 60, 'bright').party), 660);
});

test('where it is not bright, the hero with the best light lights it and the torch is used up', () => {
  const lit = lightUp(party(fighter, torches(rogue, 2)), 'dark');
  assert.deepEqual(lit.party.lit, { source: 'torch', holder: 'p2', left: 3600 });
  assert.equal(lit.party.sheets.p2.equipment[0].count, 1);
  assert.deepEqual(lit.lines, ['Cleo lights a Torch (1 hour).']);
  assert.deepEqual(lightUp(party(torches(fighter, 1)), 'bright'), { party: party(torches(fighter, 1)), lines: [] }, 'no need in bright light');
  assert.deepEqual(lightUp(lit.party, 'dark'), { party: lit.party, lines: [] }, 'one light is enough');
  assert.deepEqual(lightUp(party(), 'dim'), { party: party(), lines: [] }, 'no light to make');
  const lamp = lightUp(party(torches(fighter, 1), addItem(addItem(rogue, 'lamp'), 'oil')), 'dim');
  assert.deepEqual(lamp.party.lit, { source: 'lamp', holder: 'p2', left: 6 * 3600 });
  assert.deepEqual(lamp.lines, ['Cleo lights a Lamp (6 hours).']);
  const down = lightUp(party(fighter, { ...torches(rogue, 1), hp: 0 }), 'dark');
  assert.equal(down.party.lit, undefined, 'a hero who is down lights nothing');
});

test('time burns the light down; when it goes out the next one is lit, or the party is in the dark', () => {
  const lit = lightUp(party(torches(fighter, 2)), 'dark').party;
  const later = passTime(lit, 600, 'dark');
  assert.equal(later.party.lit!.left, 3000);
  assert.deepEqual(later.lines, []);
  const out = passTime(lit, 3600 + 600, 'dark');
  assert.deepEqual(out.lines, ["Bryn's Torch burns out.", 'Bryn lights a Torch (1 hour).']);
  assert.deepEqual(out.party.lit, { source: 'torch', holder: 'p1', left: 3000 });
  const dark = passTime(lit, 3 * 3600, 'dark');
  assert.deepEqual(dark.lines, ["Bryn's Torch burns out.", 'Bryn lights a Torch (1 hour).', "Bryn's Torch burns out.", 'The party has no light left.']);
  assert.equal(dark.party.lit, null);
  const bright = passTime(lit, 3600, 'bright');
  assert.deepEqual([bright.party.lit, bright.lines], [null, ["Bryn's Torch burns out."]], 'no need for another in bright light');
});

test('the light level: a lit light makes it bright; otherwise the light of the area, or daylight outside a dungeon', () => {
  const dungeon = startDungeon('fixed', 7, [1], 6);
  const outside = { party: party(), combat: null, dungeon: null };
  assert.equal(ambientLight(outside), 'bright');
  assert.equal(ambientLight({ ...outside, party: { ...party(), clock: 14 * 3600 } }), 'dark', '22:00');
  assert.equal(ambientLight({ ...outside, dungeon }), 'dim', 'the entrance');
  assert.equal(lightLevel({ ...outside, dungeon }), 'dim');
  assert.equal(lightLevel({ ...outside, dungeon, party: { ...party(), lit: { source: 'torch', holder: 'p1', left: 9 } } }), 'bright');
});

test('how long a turn takes (original convention): ten minutes for most, an hour to trade or raise the dead, the rest itself, a hazard its own time', () => {
  assert.equal(secondsFor(null), 600);
  for (const kind of ['check', 'move', 'trap', 'parley', 'use'] as const) assert.equal(secondsFor({ kind } as never), 600, kind);
  assert.equal(secondsFor({ kind: 'fight', monsters: [] }), 0, 'the rounds count themselves');
  assert.equal(secondsFor({ kind: 'buy', items: [] }), 3600);
  assert.equal(secondsFor({ kind: 'sell', items: [] }), 3600);
  assert.equal(secondsFor({ kind: 'revive' }), 3600);
  assert.equal(secondsFor({ kind: 'rest', rest: 'short' }), 3600);
  assert.equal(secondsFor({ kind: 'rest', rest: 'long' }), 8 * 3600);
  assert.equal(secondsFor({ kind: 'hazard', hazard: 'falling', feet: 30 }), 600);
  assert.equal(secondsFor({ kind: 'hazard', hazard: 'suffocation', minutes: 4 }), 240);
  assert.equal(secondsFor({ kind: 'hazard', hazard: 'extreme-cold', hours: 3 }), 3 * 3600);
  assert.equal(secondsFor({ kind: 'hazard', hazard: 'dehydration' }), 86400, 'a day without water');
  assert.equal(secondsFor({ kind: 'hazard', hazard: 'malnutrition', days: 2 }), 2 * 86400);
});

test('time wears conditions off, and says so', () => {
  const sick = { ...fighter, conditions: [{ condition: 'poisoned' as const, until: { kind: 'time' as const, left: 900 } }] };
  const half = passTime(party(sick), 600, 'bright');
  assert.deepEqual([half.party.sheets.p1.conditions, half.lines], [[{ condition: 'poisoned', until: { kind: 'time', left: 300 } }], []]);
  const well = passTime(party(sick), 900, 'bright');
  assert.deepEqual([well.party.sheets.p1.conditions, well.lines], [undefined, ['Bryn is no longer Poisoned.']]);
});
