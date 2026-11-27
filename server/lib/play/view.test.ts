import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heroSheet } from '../characters.ts';
import { load } from '../rules/inventory.ts';
import { candidates, temperedBudget } from '../rules/encounter.ts';
import { habitat, kindIdOf } from '../rules/habitats.ts';
import { encounterBudget, monsters } from '../rules/monsters.ts';
import { fillOf } from '../rules/wounds.ts';
import { habitatOf, startDungeon, enter } from './delve.ts';
import { startFight } from './fight.ts';
import { items } from '../rules/items.ts';
import type { DungeonState, PartyState } from './state.ts';
import { ROAD_MONSTERS, type Trek, type TrekLeg } from './trek.ts';
import type { RulesState } from './turn.ts';
import { rulesContext, rulesView, suitableMonsters } from './view.ts';
import { asItStands } from '../rules/checks.ts';

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
    passivePerception: 10 + fighter.skillBonuses.perception, passiveInsight: 10 + fighter.skillBonuses.insight, speed: fighter.speed,
    gp: fighter.gp, inventory: fighter.equipment, ...load(fighter), sight: 'none', darkvision: 0, resistances: [], conditions: [], concentratingOn: null,
    nextLevelXp: 300, questXp: 0,
  });
  assert.deepEqual([view.party[1].sight, view.party[1].darkvision], ['dim', 60], 'an elf sees the dark room dimly');
  assert.deepEqual(rulesView({ party: { ...party, sheets: { p1: { ...fighter, traits: ['dwarven-resilience'] } } }, combat: null, dungeon: null }, []).party[0].resistances, ['poison']);
  const caster = { ...fighter, spellcasting: { ability: 'wis', saveDc: 13, attackBonus: 5, slots: [2, 0, 0, 0, 0, 0, 0, 0, 0], expended: [0, 0, 0, 0, 0, 0, 0, 0, 0], cantrips: [], prepared: ['bless'], concentratingOn: 'bless' } } as typeof fighter;
  assert.equal(rulesView({ party: { ...party, sheets: { p1: caster } }, combat: null, dungeon: null }, []).party[0].concentratingOn, 'Bless', 'the spell held, by name');
  assert.deepEqual([view.time, view.light], [{ seconds: 0, label: 'Day 1, 08:00' }, { level: 'dark', source: null }]);
  const lit = rulesView({ party: { ...party, clock: 2460, lit: { source: 'torch', holder: 'p1', left: 1190 } }, combat: null, dungeon: d }, []);
  assert.deepEqual([lit.time, lit.light, lit.party[0].sight], [{ seconds: 2460, label: 'Day 1, 08:41' }, { level: 'bright', source: { name: 'Torch', holder: 'Bryn', minutesLeft: 20 } }, 'clear']);
  assert.equal(view.party[0].dragging, false);
  const slain = { party: { ...party, sheets: { p1: { ...fighter, hp: 0, dead: true } } }, combat: null, dungeon: null };
  assert.deepEqual([rulesView(slain, []).party[0].dead, rulesContext(slain).party[0].dead], [true, true]);
  assert.deepEqual([view.party[1].slotsLeft.slice(0, 2), view.party[1].down], [[1, 0], false]);
  assert.deepEqual(view.combat!.combatants.map((c) => c.id), combat.order);
  assert.deepEqual(Object.keys(view.combat!.combatants.find((c) => c.side === 'party')!), ['id', 'name', 'side', 'hp', 'maxHp', 'status', 'conditions', 'toughness', 'position', 'engagedWith', 'square', 'speedFeet']);
  assert.deepEqual(Object.keys(view.combat!.combatants.find((c) => c.side === 'foes')!), ['id', 'name', 'side', 'wound', 'fill', 'status', 'conditions', 'toughness', 'position', 'engagedWith', 'square']);
  assert.equal(view.combat!.combatants.find((c) => c.side === 'party')!.speedFeet, fighter.speed);
  assert.deepEqual(view.combat!.combatants.map((c) => [c.position, c.engagedWith]), view.combat!.combatants.map(() => ['near', []]), 'a fight begins with both sides near');
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
    items: wizard.equipment.map((e) => (e.count > 1 ? `${e.name} ×${e.count}` : e.name)).join(', '), dragging: false, dead: false, sees: 'clear', conditions: '',
  });
  assert.deepEqual([ctx.party[0].sees, ctx.time, ctx.light], ['dim', 'Day 1, 08:00', 'dim; no light carried']);
  const lit = rulesContext({ party: { ...party, lit: { source: 'lamp', holder: 'p2', left: 600 } }, combat: null, dungeon: d });
  assert.equal(lit.light, "bright; the party's light: Cleo's Lamp (10 minutes left)");
  const guttering = rulesContext({ party: { ...party, lit: { source: 'lamp', holder: 'p2', left: 45 } }, combat: null, dungeon: d });
  assert.equal(guttering.light, "bright; the party's light: Cleo's Lamp (1 minute left)");
  assert.match(ctx.party[1].items, / ×\d/, 'stacks show their count');
  assert.equal(rulesContext({ party: { ...party, sheets: { p1: { ...wizard, equipment: [{ id: 'plate-armor', name: 'Plate Armor', count: 3 }] } } }, combat: null, dungeon: null }).party[0].dragging, true);
  const goblin = ctx.combat!.combatants.find((c) => c.name === 'Goblin Warrior');
  assert.deepEqual(goblin, { name: 'Goblin Warrior', side: 'foes', wound: 'Unhurt', status: 'up', toughness: 'weak', position: 'near', engagedWith: [], square: combat.combatants['foe-1'].square ?? null });
  assert.equal(ctx.combat!.band, 'low');
  assert.deepEqual(ctx.dungeon, {
    kind: d.map.kind, level: 1, area: d.map.nodes.r0.name, purpose: 'Threshold',
    exits: [{ id: 'r1', connection: 'unlocked-door', leadsTo: d.map.nodes.r1.name }, { id: 'r4', connection: 'unlocked-door', leadsTo: `${d.map.nodes.r4.name}, by a winding passage` }],
    waiting: null,
  });
  assert.deepEqual(ctx.monsters, suitableMonsters([1, 1], habitat(kindIdOf(d.map.kind))), 'the dungeon’s own monsters');
  assert.deepEqual(rulesContext({ party, combat: null, dungeon: { ...d, level: 5 } }).monsters, suitableMonsters([5, 5], habitat(kindIdOf(d.map.kind))), 'at its level');
  assert.deepEqual(rulesContext({ party, combat: null, dungeon: null }).monsters, suitableMonsters([1, 1]));
  assert.deepEqual([rulesContext({ party, combat: null, dungeon: null }).combat, rulesContext({ party, combat: null, dungeon: null }).dungeon], [null, null]);
});

test('foes who did not attack are shown waiting, with their attitude, to the app and the DM', () => {
  const entered = enter(startDungeon('fixed', 3, [1, 1], 4), 'r1')!.dungeon;
  const r1 = entered.map.nodes.r1;
  const boars = { ...r1, contents: { ...r1.contents!, kind: 'monster' as const, encounter: { difficulty: 'moderate' as const, budget: 75, xp: 75, monsters: ['boar', 'boar', 'boar'] } } };
  const met = { ...entered, map: { ...entered.map, nodes: { ...entered.map.nodes, r1: boars } }, attitudes: { r1: 'friendly' as const } };
  const s = { party, combat: null, dungeon: met };
  const expected = { foes: 'Boar ×3', attitude: 'friendly' as const, band: 'deadly' as const, monsters: [{ name: 'Boar', count: 3, toughness: 'weak' as const }] };
  assert.deepEqual([rulesView(s, []).dungeon!.waiting, rulesContext(s).dungeon!.waiting], [expected, expected]);
});

test('an exit not yet explored leads to the unknown', () => {
  const d = startDungeon('explore', 3, [1], 4);
  assert.ok(rulesContext({ party, combat: null, dungeon: d }).dungeon!.exits.every((x) => x.leadsTo === null));
});

test('monsters to suggest: those the engine fights that a moderate fight for this party could afford, toughest first, at most 40', () => {
  const ids = suitableMonsters([3, 3, 3]);
  const budget = temperedBudget([3, 3, 3], 'moderate');
  const fightable = candidates([3, 3, 3], undefined);
  assert.equal(ids.length, 40);
  assert.ok(ids.every((id) => fightable.some((m) => m.id === id) && monsters().get(id)!.xp <= budget));
  const xps = ids.map((id) => monsters().get(id)!.xp);
  assert.deepEqual(xps, [...xps].sort((a, b) => b - a));
  assert.equal(xps[0], Math.max(...fightable.map((m) => m.xp).filter((x) => x <= budget)));
  assert.equal(encounterBudget([3, 3], 'moderate'), 450);
  assert.equal(monsters().get(suitableMonsters([3, 3])[0])!.xp, 450, 'a monster worth the whole budget is in');
  assert.ok(suitableMonsters([1, 1, 1, 1]).every((id) => monsters().get(id)!.xp <= 150), 'level 1: half the 5.2 budget');
  assert.deepEqual(suitableMonsters([2, 2], ['goblin-warrior', 'ogre']), ['goblin-warrior'], 'from the dungeon’s own (an ogre is too much)');
});

test('conditions show with how they end, in the API and to the DM', () => {
  const carried = { ...fighter, conditions: [
    { condition: 'poisoned' as const, until: { kind: 'time' as const, left: 2390 } },
    { condition: 'poisoned' as const, until: { kind: 'time' as const, left: 5400 } },
    { condition: 'frightened' as const, until: { kind: 'long-rest' as const } },
    { condition: 'paralyzed' as const, until: { kind: 'save' as const, ability: 'con' as const, dc: 12 } },
    { condition: 'restrained' as const, until: { kind: 'escape' as const, ability: 'str' as const, skill: 'sleight-of-hand', dc: 10 } },
    { condition: 'blinded' as const, until: { kind: 'time' as const, left: 3600 } },
    { condition: 'deafened' as const, until: { kind: 'time' as const, left: 30 } },
  ] };
  const s = { party: { ...party, sheets: { p1: carried } }, combat: null, dungeon: null };
  assert.deepEqual(rulesView(s, []).party[0].conditions.map((c) => c.ends), ['40 minutes', '1.5 hours', 'until a long rest', 'DC 12 CON save to end', 'DC 10 Sleight Of Hand to break free', '1 hour', '1 minute'], 'one hour, one minute');
  assert.equal(rulesContext(s).party[0].conditions, 'poisoned (40 minutes), poisoned (1.5 hours), frightened (until a long rest), paralyzed (DC 12 CON save to end), restrained (DC 10 Sleight Of Hand to break free), blinded (1 hour), deafened (1 minute)');
});

test('the dungeon level and where it went deeper, to the app and the DM', () => {
  const d = { ...startDungeon('fixed', 3, [1, 1], 4), level: 3, deepened: [{ at: 'r1', level: 2 }, { at: 'r2', level: 3 }] };
  const s = { party, combat: null, dungeon: d };
  assert.deepEqual([rulesView(s, []).dungeon!.level, rulesView(s, []).dungeon!.deepened, rulesContext(s).dungeon!.level], [3, d.deepened, 3]);
  const fresh = { party, combat: null, dungeon: startDungeon('fixed', 3, [1, 1], 4) };
  assert.deepEqual([rulesView(fresh, []).dungeon!.level, rulesView(fresh, []).dungeon!.deepened], [1, []]);
});

test('an exhausted hero: the sheet and the party view give the same passive Perception, and the view the speed it moves at (q-mwxaavkv)', () => {
  const heroOf = (sheet: typeof fighter) => rulesView({ party: { version: 1, rng: 1, sheets: { p1: sheet } }, combat: null, dungeon: null }, []).party[0];
  const tired = { ...fighter, exhaustion: 2 };
  assert.equal(heroOf(tired).passivePerception, asItStands(tired).passivePerception);
  assert.equal(heroOf(tired).passivePerception, 10 + fighter.skillBonuses.perception - 4);
  assert.deepEqual([heroOf(tired).speed, heroOf(fighter).speed], [fighter.speed - 10, fighter.speed], '-5 ft a level');
  assert.equal(heroOf({ ...fighter, speed: 20, exhaustion: 5 }).speed, 0, 'never below 0');
  const mail = fighter.equipment.find((e) => e.id === 'chain-mail')!;
  const laden = { ...fighter, equipment: [...fighter.equipment, { ...mail, count: 10 }] };
  assert.ok(load(laden).dragging);
  assert.deepEqual([heroOf(laden).speed, heroOf({ ...laden, exhaustion: 5 }).speed, heroOf({ ...laden, speed: 20, exhaustion: 5 }).speed], [5, 5, 0], 'dragging: 5 ft at most');
});

test('on the road: no dungeon yet; the stretch, its terrain, what is on it (wares, who bars the way), where it ends, to the app and the DM; road monsters to use', () => {
  const quiet: TrekLeg = { event: 'quiet', roll: 11, monsters: [], treasure: null, wares: [] };
  for (const leadsTo of ['door', 'tale'] as const) {
    const dungeon = leadsTo === 'door' ? startDungeon('fixed', 3, [1, 1], 4) : null;
    const road = (second: TrekLeg, facing?: Trek['facing']): RulesState =>
      ({ party: { ...party, trek: { terrain: 'a forest road', leg: 1, legs: [quiet, second], leadsTo, ...(facing ? { facing } : {}) } }, combat: null, dungeon });
    const vendor = road({ event: 'vendor', roll: 9, monsters: [], treasure: null, wares: ['potion-of-healing', 'rope'] });
    const expected = { stretch: 2, of: 2, terrain: 'a forest road', event: 'vendor', leadsTo, wares: [{ id: 'potion-of-healing', name: 'Potion of Healing', cost: 50 }, { id: 'rope', name: items().get('rope')!.name, cost: 1 }], waiting: null };
    assert.deepEqual([rulesView(vendor, []).trek, rulesContext(vendor).trek], [expected, expected]);
    assert.deepEqual([rulesView(vendor, []).dungeon, rulesContext(vendor).dungeon], [null, null]);
    assert.ok(rulesContext(vendor).monsters.length > 0 && rulesContext(vendor).monsters.every((m) => ROAD_MONSTERS.includes(m)));
    const bandits = road({ event: 'bandits', roll: 2, monsters: ['bandit', 'bandit'], treasure: null, wares: [] }, { monsters: ['bandit', 'bandit'], attitude: 'hostile' });
    assert.deepEqual([rulesView(bandits, []).trek!.waiting!.foes, rulesContext(bandits).trek!.waiting!.attitude], ['Bandit ×2', 'hostile']);
    assert.equal(rulesView({ ...bandits, combat: startFight(party, ['bandit']).combat }, []).trek!.waiting, null, 'in the fight, no one waits');
  }
  const door = { party, combat: null, dungeon: startDungeon('fixed', 3, [1, 1], 4) };
  assert.deepEqual([rulesView(door, []).trek, rulesContext(door).trek], [null, null]);
  assert.ok(rulesContext(door).monsters.every((m) => habitatOf(party, door.dungeon)!.includes(m)), 'at the door, the dungeon’s own');
});

test('a foe’s hit points are hidden from the players and the DM: they see its wound, and the app a fuzzy gauge (fill) for it in this fight; a hero’s HP shows', () => {
  const { combat } = startFight(party, ['zombie', 'goblin-warrior']);
  const zombie = combat.combatants['foe-1'];
  const hurt = { ...combat, combatants: { ...combat.combatants, 'foe-1': { ...zombie, hp: Math.floor(zombie.maxHp / 2) } } };
  const s = { party, combat: hurt, dungeon: null };
  const shown = rulesView(s, []).combat!.combatants;
  const byName = <T extends { name: string }>(xs: T[]) => [...xs].sort((a, b) => a.name.localeCompare(b.name));
  const fill = fillOf(zombie.maxHp >> 1, zombie.maxHp, `${hurt.order.join(',')}|foe-1`);
  assert.ok(fill > 0.25 && fill <= 0.5, `${fill}`);
  assert.deepEqual(byName(shown.filter((c) => c.side === 'foes')).map((c) => [c.name, c.wound, c.fill, c.hp, c.maxHp]), [['Goblin Warrior', 'Unhurt', 1, undefined, undefined], ['Zombie', 'Crumbling', fill, undefined, undefined]]);
  assert.ok(shown.every((c) => !('vigor' in c)), 'no rungs to count');
  assert.deepEqual(byName(shown.filter((c) => c.side === 'party')).map((c) => [c.hp, c.wound]), [[0, undefined], [wizard.hp, undefined]]);
  const told = rulesContext(s).combat!.combatants;
  assert.deepEqual(byName(told.filter((c) => c.side === 'foes')).map((c) => [c.wound, c.hp, 'fill' in c]), [['Unhurt', undefined, false], ['Crumbling', undefined, false]]);
  assert.equal(told.find((c) => c.name === 'Cleo')!.hp, wizard.hp);
});
