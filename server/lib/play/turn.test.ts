import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heroSheet } from '../characters.ts';
import type { CharacterSheet } from '../rules/sheet.ts';
import { clearRoom, startDungeon } from './delve.ts';
import { startFight } from './fight.ts';
import type { DungeonState, PartyState } from './state.ts';
import { pickChoice, playTurn, type RulesState } from './turn.ts';

const fighter = heroSheet({ id: 'f', name: 'Bryn', race: 'human', characterClass: 'fighter' });
const rogue = heroSheet({ id: 'r', name: 'Cleo', race: 'halfling', characterClass: 'rogue' });
const party = (sheets: Record<string, CharacterSheet> = { p1: fighter, p2: rogue }): PartyState => ({ version: 1, rng: 9, sheets });
const state = (over: Partial<RulesState> = {}): RulesState => ({ party: party(), combat: null, dungeon: null, ...over });
const ballots = (a: number, b: number) => [{ playerId: 'p1', choiceId: 'a' as const, roll: a }, { playerId: 'p2', choiceId: 'b' as const, roll: b }];

test('ties go to the choice whose voters rolled highest; then to the first; no leaders, no choice', () => {
  assert.equal(pickChoice(['a'], ballots(1, 20)), 'a');
  assert.equal(pickChoice(['a', 'b'], ballots(3, 17)), 'b');
  assert.equal(pickChoice(['a', 'b'], ballots(17, 3)), 'a');
  assert.equal(pickChoice(['a', 'b'], ballots(9, 9)), 'a');
  assert.equal(pickChoice([], []), null);
});

test('a story choice (no hook) leaves everything as it was', () => {
  const s = state();
  assert.deepEqual(playTurn(s, null, ballots(5, 5)), { ...s, lines: [], success: null, fight: null });
});

test('a check: every hero rolls with their vote, the party succeeds or fails together, the dice move on', () => {
  const won = playTurn(state(), { kind: 'check', ability: 'str', skill: 'athletics', dc: 5 }, ballots(15, 15));
  assert.equal(won.success, true);
  assert.equal(won.lines.length, 2);
  assert.match(won.lines[0], /^Bryn: Athletics 15 \+ \d+ = \d+ vs DC 5, success$/);
  assert.equal(playTurn(state(), { kind: 'check', ability: 'str', dc: 30 }, ballots(2, 2)).success, false);
  const save = playTurn(state(), { kind: 'save', ability: 'dex', dc: 30, damage: '1d4+20' }, ballots(2, 2));
  assert.ok(save.party.sheets.p1.hp < fighter.hp, 'damage lands on the sheets');
  assert.notEqual(save.party.rng, 9);
});

test('a fight hook starts a fight; a rest hook rests', () => {
  const fight = playTurn(state(), { kind: 'fight', monsters: ['goblin-warrior'] }, ballots(5, 5));
  assert.equal(fight.fight, 'started');
  assert.deepEqual(Object.keys(fight.combat!.combatants).sort(), ['foe-1', 'p1', 'p2']);
  const hurt = state({ party: party({ p1: { ...fighter, hp: 1 } }) });
  assert.equal(playTurn(hurt, { kind: 'rest', rest: 'long' }, []).party.sheets.p1.hp, fighter.maxHp);
});

test('in a fight every vote is that hero’s action; a won fight ends and clears the room the foes were in', () => {
  const d = startDungeon('fixed', 3, [1, 1], 4);
  const there: DungeonState = { ...d, at: 'r4' };
  const started = startFight(party(), ['goblin-warrior']);
  const weak = { ...started.combat, combatants: { ...started.combat.combatants, 'foe-1': { ...started.combat.combatants['foe-1'], hp: 1, armorClass: 1 } } };
  const won = playTurn(state({ party: started.party, combat: weak, dungeon: there }), null, [
    { playerId: 'p1', choiceId: 'a', roll: 19 }, { playerId: 'p2', choiceId: 'a', roll: 19 }]);
  assert.equal(won.fight, 'victory');
  assert.equal(won.combat, null);
  assert.ok(won.dungeon!.cleared.includes('r4'));
  assert.ok(won.lines.some((l) => l.startsWith('Victory!')));
  assert.ok(won.lines.some((l) => l.startsWith('Treasure: 60 gp')), 'what the foes guarded');
  const going = playTurn(state({ party: started.party, combat: started.combat, dungeon: there }), null, []);
  assert.deepEqual([going.fight, going.combat!.round, going.dungeon!.cleared.includes('r4')], [null, 2, false]);
  const heroes = [{ playerId: 'p1', choiceId: 'a' as const, roll: 19 }, { playerId: 'p2', choiceId: 'a' as const, roll: 19 }];
  assert.equal(playTurn(state({ party: started.party, combat: weak }), null, heroes).fight, 'victory', 'no dungeon, no room to clear');
  const bare: DungeonState = { ...there, map: { ...there.map, nodes: { ...there.map.nodes, r4: { ...there.map.nodes.r4, contents: null } } } };
  const empty = playTurn(state({ party: started.party, combat: weak, dungeon: bare }), null, heroes);
  assert.deepEqual([empty.dungeon!.cleared.includes('r4'), empty.lines.some((l) => l.startsWith('Treasure'))], [true, false]);
  const doomed = { ...started.combat, combatants: Object.fromEntries(Object.entries(started.combat.combatants).map(([id, c]) => [id, id.startsWith('p') ? { ...c, hp: 0, status: 'dead' as const } : c])) };
  const lost = playTurn(state({ party: started.party, combat: { ...doomed, outcome: 'defeat' } }), null, []);
  assert.deepEqual([lost.fight, lost.combat], ['defeat', null]);
});

test('a way on: the party moves, and what is in the room springs: monsters fight, loot is taken and the room cleared', () => {
  const d = startDungeon('fixed', 3, [1, 1], 4);
  const boars = playTurn(state({ dungeon: d }), { kind: 'move', exit: 'r1' }, ballots(5, 5));
  assert.equal(boars.dungeon!.at, 'r1');
  assert.equal(boars.fight, 'started');
  assert.match(boars.lines[0], /^The party enters Cramped \(15 x 15 ft\.\): Failed experiment\.$/);
  assert.ok(!boars.dungeon!.cleared.includes('r1'), 'cleared once the boars are beaten');
  const loot = playTurn(state({ dungeon: d }), { kind: 'move', exit: 'r4' }, ballots(5, 5));
  assert.deepEqual([loot.fight, loot.dungeon!.cleared.includes('r4')], [null, true]);
  assert.equal(loot.lines[1], 'Treasure: 60 gp in coin (30 each).');
  const back = playTurn(state({ dungeon: clearRoom(d, 'r1') }), { kind: 'move', exit: 'r1' }, []);
  assert.deepEqual([back.fight, back.lines.length], [null, 1]);
});

test('a trapped room springs its SRD 5.2 trap (or the 5.2 counterpart of an old 5.1 id)', () => {
  const d = startDungeon('fixed', 3, [1, 1], 4);
  const r4 = d.map.nodes.r4;
  const trapped: DungeonState = { ...d, map: { ...d.map, nodes: { ...d.map.nodes, r4: { ...r4, contents: { ...r4.contents!, trap: 'pits', treasure: null } } } } };
  const blind = { ...state({ dungeon: trapped }), party: party({ p1: { ...fighter, skillBonuses: { ...fighter.skillBonuses, investigation: -5 } }, p2: { ...rogue, skillBonuses: { ...rogue.skillBonuses, investigation: -5 } } }) };
  const sprung = playTurn(blind, { kind: 'move', exit: 'r4' }, ballots(1, 1));
  assert.equal(sprung.lines[1], 'Nobody notices the Hidden Pit.');
  assert.match(sprung.lines[2], /^Damage \d bludgeoning: Bryn takes \d$/);
  assert.equal(sprung.success, false);
  assert.ok(sprung.dungeon!.cleared.includes('r4'));
});

const settledOrDead = (h: CharacterSheet) => h.dead === true || h.hp === 1;

test('the dead roll nothing; a hero the harm leaves at 0 HP is settled at once: stable and up with 1 HP, or dead', () => {
  const ghost = { ...rogue, hp: 0, dead: true };
  const alone = playTurn(state({ party: party({ p1: fighter, p2: ghost }) }), { kind: 'check', ability: 'str', dc: 5 }, ballots(15, 15));
  assert.equal(alone.lines.length, 1);
  assert.deepEqual(alone.party.sheets.p2, ghost);
  const frail = party({ p1: { ...fighter, hp: 1 }, p2: { ...rogue, hp: 1 } });
  const save = playTurn(state({ party: frail }), { kind: 'save', ability: 'dex', dc: 30, damage: '1d1+4' }, ballots(2, 2));
  assert.ok(Object.values(save.party.sheets).every(settledOrDead), save.lines.join(' | '));
  assert.ok(save.lines.length > 2, 'the settling is told');
  const fall = playTurn(state({ party: frail }), { kind: 'hazard', hazard: 'falling', feet: 10 }, ballots(1, 1));
  assert.ok(Object.values(fall.party.sheets).every(settledOrDead), fall.lines.join(' | '));
  assert.ok(fall.lines.length > 2);
});

test('a sprung trap that drops a hero settles them too', () => {
  const frail = party({ p1: { ...fighter, hp: 1 }, p2: { ...rogue, hp: 1 } });
  const blade = playTurn(state({ party: frail }), { kind: 'trap', trap: 'poisoned-needle' }, ballots(1, 1));
  assert.ok(Object.values(blade.party.sheets).every((h) => h.hp >= 1 || h.dead === true), blade.lines.join(' | '));
});

test('trap and hazard hooks from the DM', () => {
  const needle = playTurn(state(), { kind: 'trap', trap: 'poisoned-needle' }, ballots(10, 10));
  assert.ok(needle.lines.length >= 2);
  const fall = playTurn(state(), { kind: 'hazard', hazard: 'falling', feet: 10 }, ballots(1, 1));
  assert.deepEqual(fall.lines.map((l) => l.split(' falls')[0]), ['Bryn', 'Cleo']);
  assert.equal(fall.success, null);
  const thirst = playTurn(state(), { kind: 'hazard', hazard: 'dehydration' }, ballots(1, 1));
  assert.equal(thirst.lines.length, 2);
});

test('a way that is not there, or no dungeon at all: nothing happens but a line saying so', () => {
  const d = startDungeon('fixed', 3, [1, 1], 4);
  assert.deepEqual(playTurn(state({ dungeon: d }), { kind: 'move', exit: 'r3' }, []).lines, ['That way is closed.']);
  assert.deepEqual(playTurn(state(), { kind: 'move', exit: 'r1' }, []).lines, ['That way is closed.']);
});

test('trade hooks: buying, selling and drinking a potion change the sheets and say what happened', () => {
  const rich = state({ party: party({ p1: { ...fighter, gp: 100 }, p2: { ...rogue, gp: 0 } }) });
  const bought = playTurn(rich, { kind: 'buy', items: ['potion-of-healing'] }, ballots(5, 5));
  assert.deepEqual([bought.party.sheets.p1.gp, bought.lines, bought.success], [50, ['Bryn buys Potion of Healing for 50 GP.'], null]);
  const sold = playTurn(bought, { kind: 'sell', items: ['potion-of-healing'] }, ballots(5, 5));
  assert.deepEqual([sold.party.sheets.p1.gp, sold.lines], [75, ['Bryn sells 1 Potion of Healing for 25 GP.']]);
  const hurt = { ...bought, party: { ...bought.party, sheets: { ...bought.party.sheets, p2: { ...rogue, hp: 1 } } } };
  const drunk = playTurn(hurt, { kind: 'use', item: 'potion-of-healing' }, ballots(5, 5));
  assert.ok(drunk.party.sheets.p2.hp > 1);
  assert.match(drunk.lines[0], /^Bryn gives Cleo a Potion of Healing: \d+ HP back\.$/);
});
