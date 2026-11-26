import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heroSheet } from '../characters.ts';
import { load } from '../rules/inventory.ts';
import { encounterBudget, monsters } from '../rules/monsters.ts';
import { startDungeon, enter } from './delve.ts';
import { startFight } from './fight.ts';
import type { PartyState } from './state.ts';
import { rulesContext, rulesView, suitableMonsters } from './view.ts';

const fighter = heroSheet({ id: 'f', name: 'Bryn', race: 'human', characterClass: 'fighter' });
const wizard = heroSheet({ id: 'w', name: 'Cleo', race: 'elf', characterClass: 'wizard' });
const party: PartyState = { version: 1, rng: 1, sheets: { p1: { ...fighter, hp: 0, hitDiceSpent: 1 }, p2: { ...wizard, spellcasting: { ...wizard.spellcasting!, expended: [1, 0, 0, 0, 0, 0, 0, 0, 0] } } } };

test('the API view: each hero’s numbers, the fight in initiative order, the areas seen, the last dice', () => {
  const { combat } = startFight(party, ['goblin-warrior']);
  const d = enter(enter(startDungeon('fixed', 3, [1, 1], 4), 'r4')!.dungeon, 'r4')!.dungeon; // by the winding passage r0-r4
  const view = rulesView({ party, combat, dungeon: d }, ['Bryn: …']);
  assert.deepEqual(view.party[0], {
    playerId: 'p1', name: 'Bryn', level: 1, xp: 0, hp: 0, maxHp: fighter.maxHp, armorClass: fighter.armorClass,
    exhaustion: 0, hitDiceLeft: 0, slotsLeft: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    resources: [{ id: 'second-wind', name: 'Second Wind', left: 2, max: 2 }], down: true, dead: false,
    passivePerception: 10 + fighter.skillBonuses.perception, passiveInsight: 10 + fighter.skillBonuses.insight,
    gp: fighter.gp, inventory: fighter.equipment, ...load(fighter), sight: 'none', darkvision: 0,
  });
  assert.deepEqual([view.party[1].sight, view.party[1].darkvision], ['dim', 60], 'an elf sees the dark room dimly');
  assert.deepEqual([view.time, view.light], [{ seconds: 0, label: 'Day 1, 08:00' }, { level: 'dark', source: null }]);
  const lit = rulesView({ party: { ...party, clock: 2460, lit: { source: 'torch', holder: 'p1', left: 1190 } }, combat: null, dungeon: d }, []);
  assert.deepEqual([lit.time, lit.light, lit.party[0].sight], [{ seconds: 2460, label: 'Day 1, 08:41' }, { level: 'bright', source: { name: 'Torch', holder: 'Bryn', minutesLeft: 20 } }, 'clear']);
  assert.equal(view.party[0].dragging, false);
  const slain = { party: { ...party, sheets: { p1: { ...fighter, hp: 0, dead: true } } }, combat: null, dungeon: null };
  assert.deepEqual([rulesView(slain, []).party[0].dead, rulesContext(slain).party[0].dead], [true, true]);
  assert.deepEqual([view.party[1].slotsLeft.slice(0, 2), view.party[1].down], [[1, 0], false]);
  assert.deepEqual(view.combat!.combatants.map((c) => c.id), combat.order);
  assert.deepEqual(Object.keys(view.combat!.combatants[0]), ['id', 'name', 'side', 'hp', 'maxHp', 'status', 'conditions']);
  assert.deepEqual([view.combat!.round, view.combat!.outcome], [1, 'ongoing']);
  assert.deepEqual([view.dungeon!.mode, view.dungeon!.kind, view.dungeon!.at], ['fixed', d.map.kind, 'r4']);
  assert.deepEqual(view.dungeon!.areas.map((a) => [a.id, a.cleared]), [['r0', true], ['r0-r4', false], ['r4', false]]);
  assert.deepEqual(view.dungeon!.areas[2].exits, [{ id: 'r0', connection: 'unlocked-door', to: 'r0-r4' }]);
  assert.deepEqual(view.results, ['Bryn: …']);
  assert.deepEqual([rulesView({ party, combat: null, dungeon: null }, []).combat, rulesView({ party, combat: null, dungeon: null }, []).dungeon], [null, null]);
});

test('the DM’s view: the party’s state, the fight, the area and its exits, and monsters to use', () => {
  const { combat } = startFight(party, ['goblin-warrior']);
  const d = startDungeon('fixed', 3, [1, 1], 4);
  const ctx = rulesContext({ party, combat, dungeon: d });
  assert.deepEqual(ctx.party[1], {
    name: 'Cleo', level: 1, hp: wizard.hp, maxHp: wizard.maxHp, armorClass: wizard.armorClass, exhaustion: 0, slotsLeft: [1, 0, 0, 0, 0, 0, 0, 0, 0],
    passivePerception: 10 + wizard.skillBonuses.perception, passiveInsight: 10 + wizard.skillBonuses.insight, gp: wizard.gp,
    items: wizard.equipment.map((e) => (e.count > 1 ? `${e.name} ×${e.count}` : e.name)).join(', '), dragging: false, dead: false, sees: 'clear',
  });
  assert.deepEqual([ctx.party[0].sees, ctx.time, ctx.light], ['dim', 'Day 1, 08:00', 'dim; no light carried']);
  const lit = rulesContext({ party: { ...party, lit: { source: 'lamp', holder: 'p2', left: 600 } }, combat: null, dungeon: d });
  assert.equal(lit.light, "bright; the party's light: Cleo's Lamp (10 minutes left)");
  assert.match(ctx.party[1].items, / ×\d/, 'stacks show their count');
  assert.equal(rulesContext({ party: { ...party, sheets: { p1: { ...wizard, equipment: [{ id: 'plate-armor', name: 'Plate Armor', count: 3 }] } } }, combat: null, dungeon: null }).party[0].dragging, true);
  assert.deepEqual(ctx.combat!.combatants.find((c) => c.name === 'Goblin Warrior'), { name: 'Goblin Warrior', side: 'foes', hp: combat.combatants['foe-1'].hp, maxHp: combat.combatants['foe-1'].maxHp, status: 'up' });
  assert.deepEqual(ctx.dungeon, {
    kind: d.map.kind, area: d.map.nodes.r0.name, purpose: 'Threshold',
    exits: [{ id: 'r1', connection: 'unlocked-door', leadsTo: 'Cramped (15 x 15 ft.)' }, { id: 'r4', connection: 'unlocked-door', leadsTo: 'Cramped (15 x 15 ft.), by a winding passage' }],
    waiting: null,
  });
  assert.deepEqual(ctx.monsters, suitableMonsters([1, 1]));
  assert.deepEqual([rulesContext({ party, combat: null, dungeon: null }).combat, rulesContext({ party, combat: null, dungeon: null }).dungeon], [null, null]);
});

test('foes who did not attack are shown waiting, with their attitude, to the app and the DM', () => {
  const met = { ...enter(startDungeon('fixed', 3, [1, 1], 4), 'r1')!.dungeon, attitudes: { r1: 'friendly' as const } };
  const s = { party, combat: null, dungeon: met };
  const expected = { foes: 'Boar ×3', attitude: 'friendly' };
  assert.deepEqual([rulesView(s, []).dungeon!.waiting, rulesContext(s).dungeon!.waiting], [expected, expected]);
});

test('an exit not yet explored leads to the unknown', () => {
  const d = startDungeon('explore', 3, [1], 4);
  assert.ok(rulesContext({ party, combat: null, dungeon: d }).dungeon!.exits.every((x) => x.leadsTo === null));
});

test('monsters to suggest: those a moderate fight for this party could afford, toughest first, at most 40', () => {
  const ids = suitableMonsters([3, 3, 3]);
  const budget = encounterBudget([3, 3, 3], 'moderate');
  assert.equal(ids.length, 40);
  assert.ok(ids.every((id) => monsters().get(id)!.xp <= budget));
  const xps = ids.map((id) => monsters().get(id)!.xp);
  assert.deepEqual(xps, [...xps].sort((a, b) => b - a));
  assert.equal(xps[0], Math.max(...[...monsters().values()].map((m) => m.xp).filter((x) => x <= budget)));
  assert.equal(encounterBudget([3, 3], 'moderate'), 450);
  assert.equal(monsters().get(suitableMonsters([3, 3])[0])!.xp, 450, 'a monster worth the whole budget is in');
});
