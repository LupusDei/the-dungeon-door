import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heroSheet } from '../characters.ts';
import type { Combatant } from '../rules/combatant.ts';
import { resourcesOf } from '../rules/resources.ts';
import type { CombatState } from '../rules/scene.ts';
import type { CharacterSheet } from '../rules/sheet.ts';
import { slotsLeft } from '../rules/spells.ts';
import { fightRound, startFight } from './fight.ts';
import { checkVote, legalActions, type LegalInput } from './legal.ts';

const fighter = heroSheet({ id: 'f', name: 'Bryn', race: 'human', characterClass: 'fighter' });
const wizard = heroSheet({ id: 'w', name: 'Cleo', race: 'elf', characterClass: 'wizard' });
const party = (sheets: Record<string, CharacterSheet>) => ({ version: 1 as const, rng: 9, sheets });
const begin = (sheets: Record<string, CharacterSheet>, foes = ['goblin-warrior']) => startFight(party(sheets), foes);
const patch = (combat: CombatState, changes: Record<string, Partial<Combatant>>): CombatState =>
  ({ ...combat, combatants: Object.fromEntries(Object.entries(combat.combatants).map(([id, c]) => [id, { ...c, ...changes[id] }])) });
const harmless = [{ name: 'Poke', bonus: 0, ranged: false, damage: [{ dice: '0', type: 'bludgeoning' }] }];

const listed = (over: Partial<LegalInput> & Pick<LegalInput, 'sheet'> & { combat: CombatState | null }) =>
  legalActions({ playerId: 'p1', choices: [], canAct: true, ...over });
const ids = (actions: { id: string }[]) => actions.map((a) => a.id);
const one = (actions: ReturnType<typeof legalActions>, id: string) => {
  const found = actions.find((a) => a.id === id);
  assert.ok(found, ids(actions).join(', '));
  return found;
};

test('a fighter in a fight is offered each weapon, Second Wind, and the common actions', () => {
  const { combat, party: p } = begin({ p1: fighter });
  const actions = listed({ combat, sheet: p.sheets.p1 });
  const weapons = combat.combatants.p1.attacks;
  assert.deepEqual(actions.filter((a) => a.kind === 'attack').map((a) => a.label), weapons.map((a) => `Attack with ${a.name}`));
  assert.ok(actions.filter((a) => a.kind === 'attack').every((a) => a.available && a.picks === 'one' && a.targets.length > 0));
  assert.equal(one(actions, 'feature:second-wind').available, true);
  for (const id of ['common:attack', 'common:dash', 'common:disengage', 'common:dodge', 'common:hide', 'common:ready']) {
    assert.equal(one(actions, id).available, true, id);
  }
  assert.deepEqual([one(actions, 'common:help').available, one(actions, 'common:help').reason], [false, 'No one to help']);
  assert.equal(one(actions, 'common:break-free').reason, 'You are not restrained or grappled');
  assert.equal(actions.some((a) => a.kind === 'spell'), false);
});

test('a prepared spell with no slot stays on the list, and says why', () => {
  const sheet: CharacterSheet = {
    ...wizard,
    spellcasting: { ...wizard.spellcasting!, cantrips: ['fire-bolt'], prepared: ['magic-missile'], expended: [...wizard.spellcasting!.slots] },
  };
  const { combat, party: p } = begin({ p1: sheet });
  const actions = listed({ combat, sheet: p.sheets.p1 });
  assert.equal(one(actions, 'spell:fire-bolt').available, true);
  const missile = one(actions, 'spell:magic-missile');
  assert.equal(missile.available, false);
  assert.equal(missile.reason, 'No level 1 spell slot or higher left');
  assert.equal(checkVote(actions, 'spell:magic-missile', ['foe-1']).ok, false);
});

test('a feature with no uses left is listed, not dropped', () => {
  const wind = resourcesOf(fighter).find((r) => r.id === 'second-wind');
  assert.ok(wind);
  const spent = { ...fighter, resourcesUsed: { 'second-wind': wind.max } };
  const { combat, party: p } = begin({ p1: spent });
  const action = one(listed({ combat, sheet: p.sheets.p1 }), 'feature:second-wind');
  assert.deepEqual([action.available, action.reason], [false, 'No uses left']);
});

test('a vote names an action and a target; a stranger and an extra target are refused', () => {
  const { combat, party: p } = begin({ p1: fighter });
  const actions = listed({ combat, sheet: p.sheets.p1 });
  const attack = actions.find((a) => a.kind === 'attack' && a.available)!;
  const foe = attack.targets[0].id;
  const ok = checkVote(actions, attack.id, [foe]);
  assert.equal(ok.ok, true);
  if (ok.ok) assert.deepEqual(ok.targets, [foe]);
  assert.equal(checkVote(actions, attack.id, ['nobody']).ok, false);
  assert.equal(checkVote(actions, 'common:dodge', []).ok, true);
  assert.equal(checkVote(actions, 'common:dodge', [foe]).ok, false);
  assert.equal(checkVote(actions, 'nope', []).ok, false);
});

test('the named weapon is the one that strikes, not whichever is best', () => {
  const armed = { ...fighter, equipment: [...fighter.equipment, { id: 'greatsword', name: 'Greatsword', count: 1 }] };
  const { combat, party: p } = begin({ p1: armed });
  const calm = patch(combat, { 'foe-1': { attacks: harmless } });
  const actions = listed({ combat: calm, sheet: p.sheets.p1 });
  const sword = one(actions, 'attack:greatsword');
  const best = calm.combatants.p1.attacks.reduce((a, b) => (b.bonus > a.bonus ? b : a));
  const round = fightRound(p, calm, { p1: { choiceId: 'a', roll: 18, actionId: sword.id, targets: [sword.targets[0].id] } });
  assert.ok(round.lines.some((l) => l.includes('with Greatsword')), round.lines.join(' | '));
  if (best.name !== 'Greatsword') assert.ok(round.lines.every((l) => !l.includes(`with ${best.name}`)), best.name);
});

test('the named spell is cast, and it spends the slot', () => {
  const sheet: CharacterSheet = {
    ...wizard,
    spellcasting: { ...wizard.spellcasting!, cantrips: ['fire-bolt'], prepared: ['magic-missile'], expended: wizard.spellcasting!.expended.map(() => 0) },
  };
  const { combat, party: p } = begin({ p1: sheet });
  const calm = patch(combat, { 'foe-1': { attacks: harmless } });
  const before = slotsLeft(p.sheets.p1)[0];
  const actions = listed({ combat: calm, sheet: p.sheets.p1 });
  const missile = one(actions, 'spell:magic-missile');
  assert.equal(missile.available, true);
  const round = fightRound(p, calm, { p1: { choiceId: 'b', roll: 12, actionId: missile.id, targets: [missile.targets[0].id] } });
  assert.ok(round.lines.some((l) => l.includes('casts Magic Missile')), round.lines.join(' | '));
  assert.equal(slotsLeft(round.party.sheets.p1)[0], before - 1);
});

test('out of a fight the scene choices are on the list, and a weapon says why not', () => {
  const choices = [
    { id: 'a', label: 'Engage', detail: 'Stand and fight them.' },
    { id: 'b', label: 'Run', detail: 'Back the way you came.' },
    { id: 'c', label: 'Parley', detail: 'Talk.' },
  ];
  const actions = listed({ combat: null, sheet: fighter, choices });
  assert.equal(one(actions, 'choice:a').label, 'Engage');
  assert.equal(one(actions, 'choice:a').available, true);
  const run = checkVote(actions, 'choice:b', []);
  assert.equal(run.ok && run.choiceId, 'b');
  assert.deepEqual([one(actions, 'common:attack').available, one(actions, 'common:attack').reason], [false, 'Not in a fight']);
  const weapon = actions.find((a) => a.kind === 'attack');
  assert.ok(weapon);
  assert.equal(weapon.reason, 'Not in a fight');
});

test('Dash spends the turn; a named potion or Second Wind is the heal, not a second bonus', () => {
  const stocked = { ...fighter, equipment: [...fighter.equipment, { id: 'potion-of-healing', name: 'Potion of Healing', count: 1 }] };
  const { combat, party: p } = begin({ p1: stocked });
  const hurt = patch(combat, { 'foe-1': { attacks: harmless }, p1: { hp: 1 } });
  const dashed = fightRound(p, hurt, { p1: { choiceId: 'c', roll: 8, actionId: 'common:dash', targets: [] } });
  assert.ok(dashed.lines.some((l) => l.includes('Bryn dashes.')), dashed.lines.join(' | '));
  const drunk = fightRound(p, hurt, { p1: { choiceId: 'c', roll: 8, actionId: 'item:potion-of-healing', targets: [] } });
  assert.ok(drunk.lines.some((l) => /drinks a Potion of Healing: \d+ HP back/.test(l)), drunk.lines.join(' | '));
  assert.equal(drunk.lines.some((l) => l.includes('Bonus Action')), false, drunk.lines.join(' | '));
  assert.equal(drunk.party.sheets.p1.equipment.some((e) => e.id === 'potion-of-healing'), false);
  const wind = fightRound(p, hurt, { p1: { choiceId: 'c', roll: 10, actionId: 'feature:second-wind', targets: [] } });
  assert.ok(wind.lines.some((l) => /uses Second Wind: \d+ HP back/.test(l)), wind.lines.join(' | '));
  assert.equal(wind.lines.filter((l) => l.includes('Second Wind')).length, 1);
  const left = resourcesOf(wind.party.sheets.p1).find((r) => r.id === 'second-wind')!;
  assert.equal(left.left, left.max - 1);
});

test('a hero who cannot act sees the list, each available one closed with the reason', () => {
  const { combat, party: p } = begin({ p1: fighter });
  const actions = legalActions({ combat, sheet: p.sheets.p1, playerId: 'p1', choices: [], canAct: false });
  assert.ok(actions.length > 0);
  assert.ok(actions.every((a) => !a.available && a.reason));
  assert.equal(one(actions, 'common:dodge').reason, 'You cannot act');
});
