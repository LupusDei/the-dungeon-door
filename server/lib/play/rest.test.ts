import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heroSheet } from '../characters.ts';
import { partyRest } from './rest.ts';
import type { PartyState } from './state.ts';

const fighter = heroSheet({ id: 'f', name: 'Bryn', race: 'human', characterClass: 'fighter' });
const warlock = heroSheet({ id: 'k', name: 'Vex', race: 'tiefling', characterClass: 'warlock' });
const party = (sheets: PartyState['sheets']): PartyState => ({ version: 1, rng: 5, sheets });

test('a short rest: each hurt hero spends hit dice until healed or out of them; the dice move on', () => {
  const hurt = { ...fighter, level: 3, hpRolls: [10, 6, 6], maxHp: fighter.maxHp + 12, hp: 1 };
  const { party: after, lines } = partyRest(party({ p1: hurt, p2: fighter }), 'short');
  const rested = after.sheets.p1;
  assert.ok(rested.hp > 1 && rested.hp <= rested.maxHp);
  assert.ok(rested.hitDiceSpent >= 1 && rested.hitDiceSpent <= 3);
  assert.ok(rested.hp === rested.maxHp || rested.hitDiceSpent === 3, 'stops only when healed or out of dice');
  assert.equal(after.sheets.p2.hitDiceSpent, 0, 'an unhurt hero spends none');
  assert.notEqual(after.rng, 5);
  assert.match(lines[0], new RegExp(`^Bryn spends ${rested.hitDiceSpent} hit dice and regains ${rested.hp - 1} HP\\.$`));
  assert.equal(lines[1], 'Bryn rests.');
});

test('one hit die is a die', () => {
  const { party: after, lines } = partyRest(party({ p1: { ...fighter, hp: fighter.maxHp - 1 } }), 'short');
  assert.equal(after.sheets.p1.hitDiceSpent, 1);
  assert.deepEqual(lines, ['Bryn spends 1 hit die and regains 1 HP.']);
});

test('a short rest gives a warlock its pact slots back; a hero at 0 HP first regains 1', () => {
  const spent = { ...warlock, spellcasting: { ...warlock.spellcasting!, expended: [...warlock.spellcasting!.slots] } };
  const { party: after, lines } = partyRest(party({ p1: spent, p2: { ...fighter, hp: 0, hitDiceSpent: 1 } }), 'short');
  assert.deepEqual(after.sheets.p1.spellcasting!.expended, [0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(after.sheets.p2.hp, 1, 'no hit dice left: just the 1 HP');
  assert.ok(lines.includes('Bryn regains 1 HP.'));
});

test('a long rest: full HP, every hit die and slot back, and one exhaustion level removed (5.2)', () => {
  const worn = { ...fighter, hp: 0, hitDiceSpent: 1, exhaustion: 2, resourcesUsed: { 'second-wind': 1 } };
  const { party: after, lines } = partyRest(party({ p1: worn }), 'long');
  const s = after.sheets.p1;
  assert.deepEqual([s.hp, s.hitDiceSpent, s.exhaustion, s.resourcesUsed], [fighter.maxHp, 0, 1, {}]);
  assert.deepEqual(lines, ['The party takes a long rest: hit points, hit dice, spell slots and features restored; one level of exhaustion removed.']);
});
