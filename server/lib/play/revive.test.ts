import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heroSheet } from '../characters.ts';
import type { CharacterSheet } from '../rules/sheet.ts';
import { newlyDead, raiseTheDead, revivify } from './revive.ts';
import type { PartyState } from './state.ts';

const fighter = heroSheet({ id: 'f', name: 'Bryn', race: 'human', characterClass: 'fighter' });
const rogue = heroSheet({ id: 'r', name: 'Cleo', race: 'halfling', characterClass: 'rogue' });
const cleric = heroSheet({ id: 'c', name: 'Mira', race: 'human', characterClass: 'cleric' });
/** A 9th-level cleric's slots, with both spells prepared. */
const priest = (gp: number, slots = [4, 3, 3, 3, 1, 0, 0, 0, 0]): CharacterSheet => ({
  ...cleric, gp, spellcasting: { ...cleric.spellcasting!, prepared: ['revivify', 'raise-dead'], slots, expended: slots.map(() => 0) },
});
const dead = (s: CharacterSheet): CharacterSheet => ({ ...s, hp: 0, dead: true });
const party = (sheets: Record<string, CharacterSheet>): PartyState => ({ version: 1, rng: 1, sheets });

test('the newly dead: dead now, not before', () => {
  const before = party({ p1: fighter, p2: dead(rogue) });
  assert.deepEqual(newlyDead(before, party({ p1: dead(fighter), p2: dead(rogue) })), ['p1']);
});

test('Revivify on the spot: a standing caster with the spell and a slot, and 300 gp from the richest who has it', () => {
  const p = party({ p1: dead(fighter), p2: priest(100), p3: { ...rogue, gp: 400 } });
  const { party: after, lines } = revivify(p, ['p1']);
  assert.deepEqual([after.sheets.p1.hp, after.sheets.p1.dead, after.sheets.p1.revivalPenalty], [1, undefined, undefined]);
  assert.deepEqual([after.sheets.p2.gp, after.sheets.p3.gp], [100, 100]);
  assert.deepEqual(after.sheets.p2.spellcasting!.expended, [0, 0, 1, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(lines, ['Mira casts Revivify on Bryn, using up a 300 gp diamond: Bryn lives again with 1 HP.']);
});

test('no Revivify without a caster, a slot, or the gold; it lasts while they do', () => {
  assert.deepEqual(revivify(party({ p1: dead(fighter), p2: { ...rogue, gp: 999 } }), ['p1']).lines, []);
  assert.deepEqual(revivify(party({ p1: dead(fighter), p2: priest(299) }), ['p1']).lines, []);
  const twoDown = party({ p1: dead(fighter), p3: dead(rogue), p2: priest(600, [4, 3, 1, 0, 0, 0, 0, 0, 0]) });
  const once = revivify(twoDown, ['p1', 'p3']);
  assert.deepEqual([once.party.sheets.p1.dead, once.party.sheets.p3.dead], [undefined, true], 'one 3rd-level slot, one Revivify');
  const rich = revivify(party({ p1: dead(fighter), p3: dead(rogue), p2: priest(600) }), ['p1', 'p3']);
  assert.deepEqual([rich.lines.length, rich.party.sheets.p2.gp], [2, 0]);
  const poorer = revivify(party({ p1: dead(fighter), p3: dead(rogue), p2: priest(450) }), ['p1', 'p3']);
  assert.equal(poorer.lines.length, 1, 'the gold runs out');
  const tied = revivify(party({ p1: dead(fighter), p2: priest(300), p3: { ...rogue, gp: 300 } }), ['p1']);
  assert.deepEqual([tied.party.sheets.p2.gp, tied.party.sheets.p3.gp], [0, 300], 'first of the richest pays');
  const downPurse = revivify(party({ p1: dead(fighter), p2: priest(0), p3: { ...rogue, hp: 0, gp: 900 } }), ['p1']);
  assert.deepEqual(downPurse.lines, [], 'a hero at 0 HP cannot hand over the diamond');
});

test('raising the dead: a party caster (500 gp diamond) or the temple (2,500 gp); -4 on D20 Tests after', () => {
  const byPriest = raiseTheDead(party({ p1: dead(fighter), p2: priest(600) }));
  assert.deepEqual([byPriest.party.sheets.p1.hp, byPriest.party.sheets.p1.revivalPenalty, byPriest.party.sheets.p2.gp], [1, 4, 100]);
  assert.deepEqual(byPriest.party.sheets.p2.spellcasting!.expended, [0, 0, 0, 0, 1, 0, 0, 0, 0]);
  assert.deepEqual(byPriest.lines, ['Mira casts Raise Dead on Bryn, using up a 500 gp diamond (paid by Mira): Bryn lives again with 1 HP, weakened by the ordeal (-4 on D20 Tests, easing with each Long Rest).']);
  const temple = raiseTheDead(party({ p1: dead(fighter), p2: { ...rogue, gp: 2500 } }));
  assert.deepEqual([temple.party.sheets.p1.dead, temple.party.sheets.p2.gp], [undefined, 0]);
  assert.match(temple.lines[0], /^The temple raises Bryn for 2500 gp \(paid by Cleo\): Bryn lives again with 1 HP, weakened/);
  const broke = raiseTheDead(party({ p1: dead(fighter), p2: { ...rogue, gp: 2499 } }));
  assert.deepEqual([broke.lines, broke.party.sheets.p1.dead], [['Nobody can pay the 2500 gp to raise Bryn.'], true]);
  assert.deepEqual(raiseTheDead(party({ p1: fighter })).lines, ['Nobody here needs raising.']);
  const both = raiseTheDead(party({ p1: dead(fighter), p3: dead(rogue), p2: { ...priest(5000), spellcasting: { ...priest(0).spellcasting!, prepared: [] } } }));
  assert.deepEqual([both.lines.length, both.party.sheets.p2.gp], [2, 0], 'the temple raises both while the gold lasts');
});
