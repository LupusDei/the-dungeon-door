import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SAMPLE } from '../rules/sheet.fixture.ts';
import type { PartyState } from './state.ts';
import { dungeonHazard, partyHazard, springTrap } from './traps.ts';

const bryn = { ...SAMPLE, equipment: [] };
const cleo = { ...bryn, name: 'Cleo', skills: [], skillBonuses: {}, saveBonuses: { ...SAMPLE.saveBonuses, dex: -1 } };
const vex = { ...cleo, name: 'Vex', skills: ['perception', 'sleight-of-hand'], skillBonuses: { perception: 5, 'sleight-of-hand': 5 }, otherProficiencies: ['tool-thieves-tools'] };
const party = (...sheets: (typeof bryn)[]): PartyState => ({ version: 1, rng: 3, sheets: Object.fromEntries(sheets.map((s, i) => [`p${i + 1}`, s])) });

test('a trap someone notices (best passive score vs its detect DC) is avoided', () => {
  const p = party(bryn, vex);
  const r = springTrap(p, 'collapsing-roof', 1, {});
  assert.deepEqual(r.lines, ['Vex spots a Collapsing Roof (passive Perception 15 vs DC 11). Once detected, the trip wire can be easily cut or avoided (no ability check required).']);
  assert.deepEqual([r.party.sheets, r.success], [p.sheets, true]);
});

test('an unnoticed trap goes off: each hero beneath it saves; damage rolled once, half on a success', () => {
  const r = springTrap({ ...party(bryn, cleo), rng: 0 }, 'collapsing-roof', 1, { p1: 12, p2: 3 });
  assert.deepEqual(r.lines.slice(0, 3), ['Nobody notices the Collapsing Roof.', 'Bryn: Dexterity save 12 + 2 = 14 vs DC 13, success', 'Cleo: Dexterity save 3 - 1 = 2 vs DC 13, failure']);
  const [, damage] = r.lines[3].match(/^Damage (\d+) bludgeoning: Bryn takes \d+, Cleo takes \d+$/)!;
  assert.deepEqual([r.party.sheets.p1.hp, r.party.sheets.p2.hp], [bryn.hp - Math.floor(+damage / 2), Math.max(0, bryn.hp - +damage)]);
  assert.equal(r.success, false);
  assert.notEqual(r.party.rng, 0);
});

test('a trap for one creature catches the first hero standing; a pit has no save; damage parts add up', () => {
  const down = { ...bryn, name: 'Ash', hp: 0 };
  const r = springTrap(party(down, bryn, cleo), 'spiked-pit', 1, {});
  assert.equal(r.lines[0], 'Nobody notices the Spiked Pit.');
  const [, a, b, total] = r.lines[1].match(/^Damage (\d+) bludgeoning \+ (\d+) piercing: Bryn takes (\d+)$/)!;
  assert.equal(+a + +b, +total);
  assert.deepEqual([r.party.sheets.p1.hp, r.party.sheets.p2.hp, r.party.sheets.p3.hp], [0, Math.max(0, bryn.hp - +total), bryn.hp]);
});

test('Poisoned Darts: a failed save means 1d3 darts, each doing the poison damage', () => {
  const r = springTrap(party(bryn), 'poisoned-darts', 1, { p1: 1 });
  assert.match(r.lines[2], /^Damage [123] darts, \d+ poison: Bryn takes \d+$/);
  const saved = springTrap(party(bryn), 'poisoned-darts', 1, { p1: 20 });
  assert.deepEqual([saved.lines.length, saved.party.sheets.p1.hp], [2, bryn.hp], 'a success: no darts');
});

test('a noticed Poisoned Needle must be disarmed (best hero, thieves\' tools, with Help); a failed attempt springs it on them', () => {
  const ok = springTrap(party(bryn, vex), 'poisoned-needle', 1, { p2: 15 });
  assert.equal(ok.lines[0], 'Vex spots a Poisoned Needle (passive Perception 15 vs DC 15).');
  assert.match(ok.lines[1], /^Vex: Sleight Of Hand with Thieves' Tools \d+ \(Advantage over \d+\) \+ 5 = \d+ vs DC 15, success$/);
  assert.equal(ok.lines.at(-1), 'The Poisoned Needle is disarmed.');
  assert.equal(ok.success, true);
  const bad = springTrap({ ...party(bryn, { ...vex, otherProficiencies: [] }), rng: 5 }, 'poisoned-needle', 1, { p2: 1, p1: 2 });
  assert.match(bad.lines[1], /^Vex: Sleight Of Hand with Thieves' Tools 1 \+ 5 = 6 vs DC 15, failure$/);
  assert.equal(bad.lines[2], 'The Poisoned Needle goes off.');
  assert.match(bad.lines[3], /^Vex: Constitution save \d+ \+ 4 = \d+ vs DC 11, (success|failure)$/);
  assert.equal(bad.party.sheets.p1.hp, bryn.hp, 'only the one disarming is stabbed');
  assert.equal(bad.success, false);
});

test('a failed save can leave a condition: the Falling Net restrains', () => {
  const r = springTrap(party(bryn), 'falling-net', 1, { p1: 2 });
  assert.deepEqual(r.lines, ['Nobody notices the Falling Net.', 'Bryn: Dexterity save 2 + 2 = 4 vs DC 10, failure', 'Bryn is Restrained (DC 10 Strength (Athletics) to break free).']);
  const needle = springTrap(party(bryn), 'poisoned-needle', 1, { p1: 1 });
  assert.equal(needle.lines.at(-1), 'Bryn is Poisoned.');
});

test('hazards befall every living hero, with the party\'s dice', () => {
  const r = partyHazard(party(bryn, { ...cleo, dead: true }, cleo), { kind: 'falling', feet: 20 });
  assert.equal(r.lines.length, 2);
  assert.match(r.lines[0], /^Bryn falls 20 feet: \d+ Bludgeoning damage, and lands Prone$/);
  assert.equal(r.party.sheets.p2.hp, cleo.hp);
  assert.notEqual(r.party.rng, 3);
});

test('dungeon hazards (original placements, CC0): what each SRD hazard is in a room', () => {
  assert.deepEqual(dungeonHazard('falling', 1), { detect: { ability: 'wis', skill: 'perception', dc: 15 }, spec: { kind: 'falling', feet: 10 }, what: 'a crumbling floor' });
  assert.deepEqual(dungeonHazard('falling', 5)!.spec, { kind: 'falling', feet: 30 });
  assert.deepEqual(dungeonHazard('falling', 11)!.spec, { kind: 'falling', feet: 60 });
  assert.deepEqual(dungeonHazard('falling', 17)!.spec, { kind: 'falling', feet: 120 });
  assert.deepEqual(dungeonHazard('burning', 1), { detect: { ability: 'wis', skill: 'perception', dc: 15 }, spec: { kind: 'burning' }, what: 'a jet of burning oil' });
  assert.deepEqual(dungeonHazard('suffocation', 1), { detect: null, spec: { kind: 'suffocation', minutes: 1 }, what: 'a flooded passage' });
  assert.deepEqual(dungeonHazard('dehydration', 1), { detect: null, spec: { kind: 'dehydration' }, what: 'a long, parched crawl' });
  assert.equal(dungeonHazard('lava', 1), null);
});

test('springing a dungeon hazard: noticed, the party goes around; otherwise it strikes', () => {
  const seen = springTrap(party(bryn, { ...vex, skillBonuses: { perception: 10 } }), 'falling', 1, {});
  assert.deepEqual([seen.lines, seen.success], [['Vex spots a crumbling floor (passive Perception 20 vs DC 15). The party finds a way around it.'], true]);
  const flooded = springTrap(party(bryn), 'suffocation', 1, {});
  assert.deepEqual([flooded.lines, flooded.success], [['The party meets a flooded passage.', 'Bryn holds their breath long enough'], false]);
});

test('an id that is neither trap nor hazard springs nothing', () => {
  const p = party(bryn);
  assert.deepEqual(springTrap(p, 'lava', 1, {}), { party: p, lines: [], success: true });
});
