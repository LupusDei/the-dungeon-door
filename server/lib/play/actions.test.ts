import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heroSheet } from '../characters.ts';
import type { Combatant } from '../rules/combatant.ts';
import type { CombatState } from '../rules/scene.ts';
import type { CharacterSheet } from '../rules/sheet.ts';
import { takeThird, thirdChoice, thirdWords } from './actions.ts';
import { COMBAT_CHOICES, fightRound, startFight } from './fight.ts';
import { yourChoices } from './your-turn.ts';

const fighter = heroSheet({ id: 'f', name: 'Bryn', race: 'human', characterClass: 'fighter' });
const cleric = heroSheet({ id: 'c', name: 'Cleo', race: 'human', characterClass: 'cleric' });
const net = (dc: number): CharacterSheet => ({ ...fighter, conditions: [{ condition: 'restrained', until: { kind: 'escape', ability: 'str', skill: 'athletics', dc } }] });
const patch = (combat: CombatState, changes: Record<string, Partial<Combatant>>): CombatState =>
  ({ ...combat, combatants: Object.fromEntries(Object.entries(combat.combatants).map(([id, c]) => [id, { ...c, ...changes[id] }])) });
const fight = (p1: CharacterSheet, p2: CharacterSheet = cleric) => startFight({ version: 1, rng: 9, sheets: { p1, p2 } }, ['goblin-warrior']);
const dodge = COMBAT_CHOICES[2];

test('the third choice: Break Free when held, Help a dying friend, else Dodge', () => {
  const held = fight(net(12));
  assert.deepEqual(thirdChoice(held.combat, net(12), 'p1'), { kind: 'break-free', condition: 'restrained', until: { kind: 'escape', ability: 'str', skill: 'athletics', dc: 12 } });
  const fallen = patch(fight(fighter).combat, { p2: { hp: 0, status: 'dying' } });
  assert.deepEqual(thirdChoice(fallen, fighter, 'p1'), { kind: 'stabilize', target: 'p2' });
  assert.deepEqual(thirdChoice(fallen, cleric, 'p2'), { kind: 'dodge' }, 'not itself');
  assert.deepEqual(thirdChoice(patch(fight(fighter).combat, { 'foe-1': { hp: 0, status: 'dying' } }), fighter, 'p1'), { kind: 'dodge' }, 'not a foe');
  assert.deepEqual(thirdChoice(fight(fighter).combat, fighter, 'p1'), { kind: 'dodge' });
  const timed = { ...fighter, conditions: [{ condition: 'poisoned' as const, until: { kind: 'time' as const, left: 60 } }] };
  assert.deepEqual(thirdChoice(fight(timed).combat, timed, 'p1'), { kind: 'dodge' }, 'only what an escape ends');
});

test('the third choice in words', () => {
  const held = fight(net(12));
  assert.deepEqual(thirdWords(thirdChoice(held.combat, net(12), 'p1'), held.combat, net(12), dodge),
    { label: 'Break Free', detail: 'Spend your action to escape being Restrained: Athletics (STR) check against DC 12.' });
  const fallen = patch(fight(fighter).combat, { p2: { hp: 0, status: 'dying' } });
  assert.deepEqual(thirdWords({ kind: 'stabilize', target: 'p2' }, fallen, fighter, dodge), { label: 'Help Cleo', detail: 'Stabilize them before they die: a DC 10 Wisdom (Medicine) check.' });
  const kit = { ...fighter, equipment: [...fighter.equipment, { id: 'healers-kit', name: 'Healer\u2019s Kit', count: 1 }] };
  assert.match(thirdWords({ kind: 'stabilize', target: 'p2' }, fallen, kit, dodge).detail, /with your Healer.s Kit\.$/);
  assert.equal(thirdWords({ kind: 'dodge' }, fallen, fighter, dodge), dodge);
  assert.equal(yourChoices(held.combat, net(12), 'p1')[2].label, 'Break Free', 'the player sees it');
});

test('Break Free: the escape check as the action; free of it on a success, on the sheet and in the fight', () => {
  const easy = fight(net(-50));
  const freed = takeThird(easy.combat, net(-50), 'p1');
  assert.equal(freed.action.kind, 'other');
  assert.match((freed.action as { text: string }).text, /^Bryn breaks free \(Athletics -?\d+ vs DC -50\)\.$/);
  assert.equal(freed.sheet.conditions?.length ?? 0, 0);
  assert.deepEqual(freed.combat.combatants.p1.conditions, []);
  assert.deepEqual(freed.combat.combatants.p1.carried, []);
  assert.notEqual(freed.combat.rng, easy.combat.rng);
  const hard = fight(net(99));
  const stuck = takeThird(hard.combat, net(99), 'p1');
  assert.match((stuck.action as { text: string }).text, /^Bryn strains against being Restrained but cannot break free \(Athletics -?\d+ vs DC 99\)\.$/);
  assert.deepEqual(stuck.sheet, net(99));
  assert.deepEqual(stuck.combat.combatants.p1.conditions, ['restrained']);
  assert.notEqual(stuck.combat.rng, hard.combat.rng);
});

test('Help: stabilize a dying friend with a Medicine check, or surely with a Healer’s Kit; Dodge otherwise', () => {
  const fallen = patch(fight(fighter).combat, { p2: { hp: 0, status: 'dying', deathSaves: { successes: 1, failures: 2 } } });
  const wise = { ...fighter, abilityScores: { ...fighter.abilityScores, wis: 30 }, skillProficiencies: ['medicine'] };
  const kit = { ...fighter, equipment: [...fighter.equipment, { id: 'healers-kit', name: 'Healer\u2019s Kit', count: 1 }] };
  const sure = takeThird(fallen, kit, 'p1');
  assert.equal((sure.action as { text: string }).text, 'Bryn stabilizes Cleo with a Healer\u2019s Kit.');
  assert.equal(sure.combat.combatants.p2.status, 'stable');
  assert.deepEqual(sure.combat.combatants.p2.deathSaves, { successes: 0, failures: 0 });
  const outcomes = new Set<string>();
  for (let rng = 1; rng < 60; rng++) {
    const t = takeThird({ ...fallen, rng }, fighter, 'p1');
    const text = (t.action as { text: string }).text;
    outcomes.add(t.combat.combatants.p2.status);
    assert.match(text, /^Bryn (stabilizes Cleo|tries to stabilize Cleo) \(Medicine -?\d+ vs DC 10\)(, but cannot)?\.$/);
    assert.equal(t.combat.combatants.p2.status === 'stable', text.startsWith('Bryn stabilizes'));
  }
  assert.deepEqual([...outcomes].sort(), ['dying', 'stable']);
  assert.equal(takeThird(fallen, wise, 'p1').combat.combatants.p2.status, 'stable');
  assert.deepEqual(takeThird(fight(fighter).combat, fighter, 'p1').action, { kind: 'dodge' });
});

test('in a round, a held hero voting for the third choice spends its turn breaking free', () => {
  const start = fight(net(-50));
  const harmless = [{ name: 'Poke', bonus: -100, ranged: false, damage: [{ dice: '0', type: 'force' }] }];
  const round = fightRound(start.party, patch(start.combat, { 'foe-1': { attacks: harmless } }), { p1: { choiceId: 'c', roll: 10 } });
  assert.ok(round.lines.some((l) => l.startsWith('Bryn breaks free')), round.lines.join('\n'));
  assert.equal(round.party.sheets.p1.conditions?.length ?? 0, 0);
});
