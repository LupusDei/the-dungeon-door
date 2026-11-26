import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heroCombatant } from '../rules/combatant.ts';
import { SAMPLE } from '../rules/sheet.fixture.ts';
import type { CharacterSheet } from '../rules/sheet.ts';
import { scriptedRng } from '../rules/rng.ts';
import { afterFight, afterHarm, outcome, settleOne } from './dying.ts';
import type { CombatState, PartyState } from './state.ts';

const bryn: CharacterSheet = { ...SAMPLE, equipment: [] };
const cleo: CharacterSheet = { ...bryn, name: 'Cleo', skills: ['medicine'], skillBonuses: { medicine: 4 } };
const party = (sheets: Record<string, CharacterSheet>, rng = 1): PartyState => ({ version: 1, rng, sheets });

test('nobody at 0 HP: nothing to settle', () => {
  const p = party({ p1: bryn });
  assert.deepEqual(afterHarm(p), { party: p, lines: [] });
});

test('Spare the Dying from a friend stabilizes a dying hero, who wakes with 1 HP after 1d4 hours', () => {
  const caster: CharacterSheet = { ...cleo, spellcasting: { ability: 'wis', saveDc: 13, attackBonus: 5, slots: [0, 0, 0, 0, 0, 0, 0, 0, 0], cantrips: ['spare-the-dying'], prepared: [], expended: [0, 0, 0, 0, 0, 0, 0, 0, 0], concentratingOn: null } };
  const r = afterHarm(party({ p1: { ...bryn, hp: 0 }, p2: caster }));
  assert.deepEqual(r.lines.slice(0, 2), ['Bryn is dying.', 'Cleo casts Spare the Dying: Bryn is stable.']);
  assert.match(r.lines[2], /^Bryn wakes with 1 HP after [1-4] hours?\.$/);
  assert.equal(r.party.sheets.p1.hp, 1);
});

test('a Healer\'s Kit stabilizes without a check', () => {
  const r = afterHarm(party({ p1: { ...bryn, hp: 0 }, p2: { ...cleo, equipment: [{ id: 'healers-kit', name: "Healer's Kit", count: 1 }] } }));
  assert.equal(r.lines[1], "Cleo uses a Healer's Kit: Bryn is stable.");
});

test('otherwise the best healer tries a DC 10 Medicine check; each failure, the dying hero makes a death save', () => {
  const r = afterHarm(party({ p1: { ...bryn, hp: 0 }, p2: cleo }, 4));
  assert.equal(r.lines[0], 'Bryn is dying.');
  assert.match(r.lines[1], /^Cleo: Medicine \d+ \+ 4 = \d+ vs DC 10, (success|failure)$/);
  assert.ok(r.lines.at(-1)!.startsWith('Bryn wakes') || r.lines.at(-1) === 'Bryn dies.' || r.lines.at(-1)!.includes('death save'));
});

test('alone, a dying hero rolls death saves until stable, dead, or a 20 brings them back', () => {
  for (let seed = 1; seed < 40; seed++) {
    const r = afterHarm(party({ p1: { ...bryn, hp: 0 } }, seed));
    const last = r.lines.at(-1)!;
    const s = r.party.sheets.p1;
    if (s.dead) assert.equal(last, 'Bryn dies.');
    else assert.equal(s.hp, 1, last);
    assert.ok(r.lines.slice(1, -1).every((l) => /^Bryn's death save: \d+ \((success|failure|two failures|20: back up with 1 HP)\)\.$/.test(l) || /stable/.test(l)), r.lines.join(' | '));
  }
});

test('the dead stay dead and are not settled again', () => {
  const p = party({ p1: { ...bryn, hp: 0, dead: true }, p2: cleo });
  assert.deepEqual(afterHarm(p), { party: p, lines: [] });
});

test('after a fight: the slain are marked dead, the dying and stable are settled', () => {
  const p = party({ p1: bryn, p2: cleo, p3: { ...bryn, name: 'Ash' } });
  const hero = (id: string, s: CharacterSheet, status: 'up' | 'dying' | 'stable' | 'dead') => ({ ...heroCombatant(id, s), hp: status === 'up' ? s.hp : 0, status });
  const combat = { combatants: { p1: hero('p1', bryn, 'dead'), p2: hero('p2', cleo, 'up'), p3: hero('p3', { ...bryn, name: 'Ash' }, 'stable') } } as unknown as CombatState;
  const r = afterFight({ ...p, sheets: { ...p.sheets, p1: { ...bryn, hp: 0 }, p3: { ...bryn, name: 'Ash', hp: 0 } } }, combat);
  assert.deepEqual([r.party.sheets.p1.dead, r.party.sheets.p1.hp], [true, 0]);
  assert.equal(r.lines[0], 'Bryn is dead.');
  assert.match(r.lines[1], /^Ash wakes with 1 HP after [1-4] hours?\.$/);
  assert.equal(r.party.sheets.p3.hp, 1);
});

const downed = () => ({ ...heroCombatant('p1', { ...bryn, hp: 0 }), status: 'dying' as const });
const friend = { playerId: 'p2', sheet: cleo };

test('three Medicine tries at most, a death save after each failure; then death saves alone', () => {
  const r = settleOne(scriptedRng([1, 5, 1, 5, 1, 15, 15, 15]), downed(), [friend]);
  assert.equal(r.c.status, 'stable');
  assert.deepEqual(r.lines, [
    'Bryn is dying.',
    'Cleo: Medicine 1 + 4 = 5 vs DC 10, failure', "Bryn's death save: 5 (failure).",
    'Cleo: Medicine 1 + 4 = 5 vs DC 10, failure', "Bryn's death save: 5 (failure).",
    'Cleo: Medicine 1 + 4 = 5 vs DC 10, failure', "Bryn's death save: 15 (success).",
    "Bryn's death save: 15 (success).", "Bryn's death save: 15 (success).",
  ]);
  assert.deepEqual(settleOne(scriptedRng([6]), downed(), [friend]).lines.slice(1), ['Cleo: Medicine 6 + 4 = 10 vs DC 10, success', 'Bryn is stable.']);
  assert.deepEqual(settleOne(scriptedRng([1, 1]), downed(), []).lines, ['Bryn is dying.', "Bryn's death save: 1 (two failures).", "Bryn's death save: 1 (two failures)."]);
  assert.equal(settleOne(scriptedRng([20]), downed(), []).c.status, 'up');
  assert.deepEqual(settleOne(scriptedRng([10, 9, 10, 10]), downed(), []).lines.slice(1), ["Bryn's death save: 10 (success).", "Bryn's death save: 9 (failure).", "Bryn's death save: 10 (success).", "Bryn's death save: 10 (success)."]);
});

test('waking: 1 HP after 1d4 hours for the stable; on their feet after a 20; the dead stay down', () => {
  const stable = { ...downed(), status: 'stable' as const };
  assert.deepEqual(outcome(scriptedRng([1]), stable, { ...bryn, hp: 0 }), { sheet: { ...bryn, hp: 1 }, line: 'Bryn wakes with 1 HP after 1 hour.' });
  assert.equal(outcome(scriptedRng([3]), stable, bryn).line, 'Bryn wakes with 1 HP after 3 hours.');
  assert.deepEqual(outcome(scriptedRng([]), { ...stable, status: 'up' }, { ...bryn, hp: 0 }), { sheet: { ...bryn, hp: 1 }, line: 'Bryn is back on their feet.' });
  assert.deepEqual(outcome(scriptedRng([]), { ...stable, status: 'dead' }, { ...bryn, hp: 0 }), { sheet: { ...bryn, hp: 0, dead: true }, line: 'Bryn dies.' });
});

test('a friend at 1 HP can still help; a friend at 0 HP or dead cannot', () => {
  const kit = [{ id: 'healers-kit', name: "Healer's Kit", count: 1 }];
  const r = afterHarm(party({ p1: { ...bryn, hp: 0 }, p2: { ...cleo, hp: 1, equipment: kit } }));
  assert.equal(r.lines[1], "Cleo uses a Healer's Kit: Bryn is stable.");
  const none = afterHarm(party({ p1: { ...bryn, hp: 0 }, p2: { ...cleo, dead: true, equipment: kit } }));
  assert.notEqual(none.lines[1], "Cleo uses a Healer's Kit: Bryn is stable.");
});
