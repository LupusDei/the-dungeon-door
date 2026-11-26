import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heroSheet } from '../characters.ts';
import { addItem } from '../rules/inventory.ts';
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

test('a story choice (no hook) only lets ten minutes pass', () => {
  const s = state();
  assert.deepEqual(playTurn(s, null, ballots(5, 5)), { ...s, party: { ...s.party, clock: 600 }, lines: [], success: null, fight: null });
});

test('time passes with every turn: a dark place is lit, the light burns, a rest does not burn it, a combat round is 6 seconds', () => {
  const torch = addItem({ ...fighter, equipment: [] }, 'torch', 2);
  const dungeon = startDungeon('fixed', 7, [1], 6);
  const into = playTurn(state({ party: party({ p1: torch }), dungeon }), { kind: 'move', exit: dungeon.map.nodes.r0.exits[0].id }, ballots(10, 10));
  assert.equal(into.lines[1], 'Bryn lights a Torch (1 hour).', 'lit on the way in, before anything springs');
  assert.equal(into.party.clock, 600);
  const rested = playTurn({ ...into, combat: null }, { kind: 'rest', rest: 'long' }, []);
  assert.deepEqual([rested.party.clock, rested.party.lit?.left], [600 + 8 * 3600, into.party.lit?.left]);
  const fight = startFight(party(), ['goblin-warrior']);
  const round = playTurn(state({ combat: fight.combat, party: { ...party(), lit: { source: 'torch', holder: 'p1', left: 60 } } }), null, ballots(10, 10));
  assert.deepEqual([round.party.clock, round.party.lit?.left], [6, 54]);
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

/** The fixed map's r1 holds three boars; here they guard 60 gp too. */
function boarRoom(): DungeonState {
  const d = startDungeon('fixed', 3, [1, 1], 4);
  const r1 = d.map.nodes.r1;
  return { ...d, map: { ...d.map, nodes: { ...d.map.nodes, r1: { ...r1, contents: { ...r1.contents!, treasure: { gp: 60, sp: 0, gems: 0, jewellery: 0, magicItem: null } } } } } };
}
const intoBoars = (rng: number) => playTurn({ ...state({ dungeon: boarRoom() }), party: { ...party(), rng } }, { kind: 'move', exit: 'r1' }, ballots(5, 5));
const boarMeetings = Array.from({ length: 40 }, (_, i) => intoBoars(i + 1));
const met = (attitude: string) => boarMeetings.find((t) => t.dungeon!.attitudes!.r1 === attitude)!;

test('a way on: the party moves, and what is in the room springs: monsters fight, loot is taken and the room cleared', () => {
  const d = startDungeon('fixed', 3, [1, 1], 4);
  const boars = met('hostile');
  assert.equal(boars.dungeon!.at, 'r1');
  assert.equal(boars.fight, 'started');
  assert.match(boars.lines[0], /^The party enters Cramped \(15 x 15 ft\.\): Failed experiment\.$/);
  assert.match(boars.lines[1], /^Boar ×3: hostile \(2d6: [2-5]\)\.$/);
  assert.match(boars.lines[2], /^A fight begins: /);
  assert.ok(!boars.dungeon!.cleared.includes('r1'), 'cleared once the boars are beaten');
  const loot = playTurn(state({ dungeon: d }), { kind: 'move', exit: 'r4' }, ballots(5, 5));
  assert.deepEqual([loot.fight, loot.dungeon!.cleared.includes('r4')], [null, true]);
  assert.equal(loot.lines[1], 'Treasure: 60 gp in coin (30 each).');
  const back = playTurn(state({ dungeon: clearRoom(d, 'r1') }), { kind: 'move', exit: 'r1' }, []);
  assert.deepEqual([back.fight, back.lines.length], [null, 1]);
});

test('foes who are not Hostile watch and wait: no fight, the room not cleared, its treasure untouched', () => {
  for (const attitude of ['indifferent', 'friendly']) {
    const calm = met(attitude);
    assert.equal(calm.fight, null);
    assert.match(calm.lines[1], new RegExp(`^Boar ×3: ${attitude} \\(2d6: \\d+\\)\\. They watch and wait\\.$`));
    assert.deepEqual([calm.dungeon!.cleared.includes('r1'), calm.party.sheets.p1.gp], [false, fighter.gp]);
    assert.notEqual(calm.party.rng, party().rng);
  }
  const s = met('indifferent');
  const away = { ...s, dungeon: { ...s.dungeon!, at: 'r0' } };
  const again = playTurn(away, { kind: 'move', exit: 'r1' }, ballots(5, 5));
  assert.deepEqual([again.lines[1], again.party.rng], ['Boar ×3: indifferent. They watch and wait.', away.party.rng], 'met before: their attitude is remembered');
});

test('undead, constructs and oozes always attack', () => {
  const d = boarRoom();
  const r1 = d.map.nodes.r1;
  const crypt = { ...d, map: { ...d.map, nodes: { ...d.map.nodes, r1: { ...r1, contents: { ...r1.contents!, encounter: { ...r1.contents!.encounter!, monsters: ['skeleton'] } } } } } };
  const t = playTurn(state({ dungeon: crypt }), { kind: 'move', exit: 'r1' }, ballots(5, 5));
  assert.deepEqual([t.lines[1], t.fight], ['Skeleton: hostile.', 'started']);
});

test('a parley with the foes waiting here: success clears the room (their treasure stays theirs); failure sours them', () => {
  const talks = (attitude: string, vote = 1) => Array.from({ length: 30 }, (_, i) => {
    const s = met(attitude);
    return playTurn({ ...s, party: { ...s.party, rng: i + 1 } }, { kind: 'parley' }, ballots(vote, vote));
  });
  const peace = talks('indifferent', 20).find((t) => t.success === true)!;
  assert.deepEqual([peace.dungeon!.cleared.includes('r1'), peace.party.sheets.p1.gp, peace.fight], [true, fighter.gp, null]);
  assert.equal(peace.lines.at(-1), 'The Boar ×3 let the party be.');
  const war = talks('indifferent').find((t) => t.success !== true)!;
  assert.deepEqual([war.fight, war.dungeon!.attitudes!.r1], ['started', 'hostile']);
  assert.match(war.lines.at(-1)!, /^A fight begins: /);
  const cooler = talks('friendly').find((t) => t.success === false)!;
  assert.deepEqual([cooler.fight, cooler.dungeon!.attitudes!.r1, cooler.dungeon!.cleared.includes('r1')], [null, 'indifferent', false]);
});

test('a parley the DM offers outside a room of waiting foes is with the monsters it names, who start Indifferent', () => {
  assert.deepEqual(playTurn(state(), { kind: 'parley' }, ballots(10, 10)).lines, ['There is no one here to talk to.']);
  assert.deepEqual(playTurn(state(), { kind: 'parley', monsters: [] }, ballots(10, 10)).lines, ['There is no one here to talk to.']);
  const offered = Array.from({ length: 30 }, (_, i) => playTurn({ ...state(), party: { ...party(), rng: i + 1 } }, { kind: 'parley', monsters: ['goblin-warrior'] }, ballots(1, 1)));
  const ok = playTurn(state(), { kind: 'parley', monsters: ['goblin-warrior'] }, ballots(20, 20));
  assert.deepEqual([ok.fight, ok.dungeon, ok.lines.at(-1)], [null, null, 'The Goblin Warrior let the party be.']);
  assert.equal(offered.find((t) => t.success !== true)!.fight, 'started');
  const cleared = { ...state({ dungeon: clearRoom(met('friendly').dungeon!, 'r1') }) };
  assert.deepEqual(playTurn(cleared, { kind: 'parley' }, ballots(10, 10)).lines, ['There is no one here to talk to.'], 'the room is dealt with');
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

test('a hero killed outside a fight may be Revivified on the spot; the revive hook raises the dead', () => {
  const cleric = heroSheet({ id: 'c', name: 'Mira', race: 'human', characterClass: 'cleric' });
  const slots = [4, 3, 2, 0, 1, 0, 0, 0, 0];
  const priest = { ...cleric, gp: 900, hp: 200, maxHp: 200, spellcasting: { ...cleric.spellcasting!, prepared: ['revivify', 'raise-dead'], slots, expended: slots.map(() => 0) } };
  const doomed = party({ p1: { ...fighter, hp: 1, maxHp: 1 }, p2: priest });
  const fall = playTurn(state({ party: doomed }), { kind: 'hazard', hazard: 'falling', feet: 60 }, ballots(1, 1));
  assert.deepEqual([fall.party.sheets.p1.dead, fall.party.sheets.p1.hp], [undefined, 1], fall.lines.join(' | '));
  assert.ok(fall.lines.includes('Mira casts Revivify on Bryn, using up a 300 gp diamond: Bryn lives again with 1 HP.'));
  const save = playTurn(state({ party: doomed }), { kind: 'save', ability: 'dex', dc: 30, damage: '1d4+20' }, ballots(1, 1));
  assert.equal(save.party.sheets.p1.hp, 1, save.lines.join(' | '));
  const trapped = playTurn(state({ party: party({ p1: { ...fighter, hp: 1, maxHp: 1 }, p2: priest }) }), { kind: 'trap', trap: 'poisoned-needle' }, ballots(1, 1));
  assert.notEqual(trapped.party.sheets.p1.dead, true, trapped.lines.join(' | '));
  const temple = playTurn(state({ party: party({ p1: { ...fighter, hp: 0, dead: true }, p2: priest }) }), { kind: 'revive' }, []);
  assert.deepEqual([temple.party.sheets.p1.revivalPenalty, temple.party.sheets.p2.gp], [4, 400]);
  assert.match(temple.lines[0], /^Mira casts Raise Dead on Bryn/);
});
