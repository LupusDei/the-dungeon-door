import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heroSheet } from '../characters.ts';
import { scriptedRng } from '../rules/rng.ts';
import { parley, rollAttitude } from './parley.ts';
import type { PartyState } from './state.ts';

const bard = heroSheet({ id: 'b', name: 'Lyra', race: 'human', characterClass: 'bard' }, 'classic');
const fighter = heroSheet({ id: 'f', name: 'Bryn', race: 'human', characterClass: 'fighter' }, 'classic');
const party = (rng = 3): PartyState => ({ version: 1, rng, sheets: { p1: fighter, p2: bard } });

test('attitude: 2d6, 2–5 Hostile, 6–9 Indifferent, 10–12 Friendly; undead, constructs and oozes always Hostile', () => {
  const at = (a: number, b: number) => rollAttitude(scriptedRng([a, b]), ['goblin-warrior']);
  assert.deepEqual([at(1, 1), at(2, 3), at(3, 3), at(4, 5), at(5, 5), at(6, 6)].map((r) => [r.roll, r.attitude]),
    [[2, 'hostile'], [5, 'hostile'], [6, 'indifferent'], [9, 'indifferent'], [10, 'friendly'], [12, 'friendly']]);
  assert.deepEqual(rollAttitude(scriptedRng([6, 6]), ['goblin-warrior', 'skeleton']), { attitude: 'hostile', roll: null });
  assert.equal(rollAttitude(scriptedRng([6, 6]), ['gelatinous-cube']).attitude, 'hostile');
  assert.equal(rollAttitude(scriptedRng([6, 6]), ['flesh-golem']).attitude, 'hostile');
});

test('a parley, with nobody named as having picked it: the best talker makes a Persuasion check against the shrewdest foe (DC max(15, INT)), the others helping', () => {
  const won = parley(party(), ['goblin-warrior', 'goblin-boss'], 'indifferent', { p1: 20, p2: 20 });
  assert.equal(won.success, true);
  assert.match(won.lines[0], /^Lyra: Persuasion 20/);
  assert.match(won.lines[0], /vs DC 15, success$/);
  assert.deepEqual([won.attitude, won.lines.at(-1)], ['indifferent', 'The Goblin Warrior, Goblin Boss let the party be.']);
  assert.notEqual(parley(party(), ['goblin-warrior'], 'indifferent', {}).party.rng, 3, 'without votes the dice roll, and move on');
  const lost = parley(party(), ['goblin-warrior'], 'indifferent', { p1: 1, p2: 1 });
  assert.deepEqual([lost.success, lost.attitude, lost.lines.at(-1)], [false, 'hostile', 'The talk goes badly: the Goblin Warrior turn hostile.']);
  const soured = Array.from({ length: 40 }, (_, i) => parley(party(i + 1), ['goblin-warrior'], 'friendly', { p1: 1, p2: 1 })).find((p) => !p.success)!;
  assert.equal(soured.attitude, 'indifferent', 'a failed talk with Friendly foes leaves them Indifferent');
  assert.equal(parley(party(), ['goblin-warrior'], 'hostile', { p1: 1, p2: 1 }).attitude, 'hostile');
});

test('Friendly foes give Advantage, Hostile ones Disadvantage; the dead do not talk', () => {
  assert.match(parley(party(), ['goblin-warrior'], 'friendly', { p1: 10, p2: 10 }).lines[0], /Advantage/);
  assert.match(parley(party(), ['goblin-warrior'], 'hostile', { p1: 10, p2: 10 }).lines[0], /Disadvantage/);
  assert.doesNotMatch(parley(party(), ['goblin-warrior'], 'indifferent', { p1: 10, p2: 10 }).lines[0], /dvantage/);
  const mute = { ...party(), sheets: { p1: fighter, p2: { ...bard, hp: 0, dead: true } } };
  assert.match(parley(mute, ['goblin-warrior'], 'indifferent', { p1: 10, p2: 10 }).lines[0], /^Bryn: /);
});

test('the DC comes from the foe hardest to sway', () => {
  const sage = parley(party(), ['goblin-warrior', 'mage'], 'indifferent', { p1: 10, p2: 10 });
  assert.match(sage.lines[0], /vs DC 17,/, 'a mage has INT 17');
});

test('the one who picked the parley talks, with their own d20, whoever else is the better talker; the roll comes back whole', () => {
  const talked = parley(party(), ['goblin-warrior'], 'indifferent', { p1: 17 }, ['p1']);
  assert.match(talked.lines[0], /^Bryn: Persuasion 17 /, 'Lyra is the better talker, but she did not pick it');
  assert.deepEqual([talked.name, talked.dc, talked.helpers], ['Persuasion', 15, []]);
  assert.deepEqual(talked.rolls.map((r) => [r.playerId, r.natural, r.dice, r.fresh]), [['p1', 17, [17], false]]);
  const both = parley(party(), ['goblin-warrior'], 'indifferent', { p1: 17, p2: 9 }, ['p1', 'p2']);
  assert.match(both.lines.at(-2)!, /^Lyra: Persuasion /, 'both picked it: the better talker speaks');
  const nobody = parley(party(), ['goblin-warrior'], 'indifferent', { p1: 17, p2: 9 });
  assert.deepEqual(nobody.lines, both.lines, 'with no backers given, the best talker in the party speaks');
});
