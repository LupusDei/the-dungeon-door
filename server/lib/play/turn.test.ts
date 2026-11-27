import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heroSheet } from '../characters.ts';
import { addItem } from '../rules/inventory.ts';
import { monster } from '../rules/monsters.ts';
import type { CharacterSheet } from '../rules/sheet.ts';
import { clearRoom, startDungeon } from './delve.ts';
import { startFight } from './fight.ts';
import type { DungeonState, PartyState } from './state.ts';
import type { Trek, TrekLeg } from './trek.ts';
import { confrontationChoices, pickChoice, playTurn, type RulesState, type RulesTurn } from './turn.ts';

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
  assert.equal(into.lines[0], 'Bryn lights a Torch (1 hour).', 'lit in the dim entrance before setting out');
  const dark = playTurn(state({ party: party({ p1: torch }), dungeon }), { kind: 'fight', monsters: ['goblin-warrior'] }, ballots(10, 10));
  assert.deepEqual(dark.lines.slice(0, 1), ['Bryn lights a Torch (1 hour).'], 'before the fight begins');
  assert.equal(dark.lines.some((l) => l.includes('cannot see')), false, 'so nobody fights Blinded');
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
  const contents = { ...r1.contents!, kind: 'monster' as const, trap: null, encounter: { difficulty: 'moderate' as const, budget: 75, xp: 75, monsters: ['boar', 'boar', 'boar'] }, treasure: { gp: 60, sp: 0, gems: 0, jewellery: 0, magicItem: null } };
  return { ...d, map: { ...d.map, nodes: { ...d.map.nodes, r1: { ...r1, name: 'Cramped (15 x 15 ft.)', purpose: 'Failed experiment', contents } } } };
}
const intoBoars = (rng: number) => playTurn({ ...state({ dungeon: boarRoom() }), party: { ...party(), rng } }, { kind: 'move', exit: 'r1' }, ballots(5, 5));
const boarMeetings = Array.from({ length: 40 }, (_, i) => intoBoars(i + 1));
const met = (attitude: string) => boarMeetings.find((t) => t.dungeon!.attitudes!.r1 === attitude)!;

test('a way on: the party moves, and what is in the room springs: monsters fight, loot is taken and the room cleared', () => {
  const d = startDungeon('fixed', 3, [1, 1], 4);
  const boars = met('hostile');
  assert.equal(boars.dungeon!.at, 'r1');
  assert.equal(boars.fight, null, 'hostile foes bar the way; they do not attack yet');
  assert.equal(boars.combat, null);
  assert.match(boars.lines[0], /^The party enters Cramped \(15 x 15 ft\.\): Failed experiment\.$/);
  assert.match(boars.lines[1], /^Boar ×3: hostile \(2d6: [2-5]\)\. They bar the way\.$/);
  assert.deepEqual(confrontationChoices(boars)?.map((c) => c.label), ['Engage', 'Run', 'Parley']);
  assert.ok(!boars.dungeon!.cleared.includes('r1'), 'not cleared until the boars are beaten or swayed');
  const ran = playTurn(boars, { kind: 'run' }, ballots(5, 5));
  assert.equal(ran.dungeon!.at, 'r0', 'back the way they came');
  assert.equal(ran.dungeon!.cleared.includes('r1'), false);
  assert.equal(ran.party.sheets.p1.gp, fighter.gp);
  assert.equal(ran.party.sheets.p1.xp, fighter.xp);
  assert.equal(ran.combat, null);
  const said = (s: RulesState) => playTurn(s, { kind: 'run' }, []).lines;
  assert.deepEqual([said(state({ dungeon: null })), said(state({ dungeon: d })), said(met('indifferent'))], [['There is no one to run from.'], ['There is no one to run from.'], ['There is no one to run from.']]);
  const cornered = { ...boars, dungeon: { ...boars.dungeon!, cameFrom: undefined } };
  assert.deepEqual([said(cornered), playTurn(cornered, { kind: 'run' }, []).dungeon!.at], [['There is no way back.'], 'r1']);
  const engaged = playTurn(boars, { kind: 'engage', monsters: ['boar', 'boar', 'boar'] }, ballots(5, 5));
  assert.equal(engaged.fight, 'started');
  assert.equal(Object.values(engaged.combat!.combatants).filter((c) => c.side === 'foes').length, 3, 'the boars that are there, not a capped subset');
  const r4 = d.map.nodes.r4;
  const looted = { ...d, map: { ...d.map, nodes: { ...d.map.nodes, r4: { ...r4, contents: { ...r4.contents!, kind: 'empty' as const, encounter: null, trap: null, treasure: { gp: 60, sp: 0, gems: 0, jewellery: 0, magicItem: null } } } } } };
  const loot = playTurn(state({ dungeon: looted }), { kind: 'move', exit: 'r4' }, ballots(5, 5));
  assert.deepEqual([loot.fight, loot.dungeon!.cleared.includes('r4')], [null, true]);
  assert.ok(loot.lines.includes('Treasure: 60 gp in coin (30 each).'));
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

test('undead, constructs and oozes are always hostile, and they bar the way', () => {
  const d = boarRoom();
  const r1 = d.map.nodes.r1;
  const crypt = { ...d, map: { ...d.map, nodes: { ...d.map.nodes, r1: { ...r1, contents: { ...r1.contents!, encounter: { ...r1.contents!.encounter!, monsters: ['skeleton'] } } } } } };
  const t = playTurn(state({ dungeon: crypt }), { kind: 'move', exit: 'r1' }, ballots(5, 5));
  assert.deepEqual([t.lines[1], t.fight], ['Skeleton: hostile. They bar the way.', null]);
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
  assert.deepEqual([war.fight, war.combat, war.dungeon!.attitudes!.r1], [null, null, 'hostile']);
  assert.equal(war.lines.at(-1), 'The talk goes badly: the Boar ×3 turn hostile.');
  assert.deepEqual(confrontationChoices(war)?.map((c) => c.label), ['Engage', 'Run', 'Parley']);
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
  const pit = sprung.lines.indexOf('Nobody notices the Hidden Pit.');
  assert.ok(pit > 0);
  assert.match(sprung.lines[pit + 1], /^Damage \d bludgeoning: Bryn takes \d$/);
  assert.equal(sprung.success, false);
  assert.ok(sprung.dungeon!.cleared.includes('r4'));
});

const settledOrDead = (h: CharacterSheet) => h.dead === true || h.hp === 1;

test('the dead roll nothing; a hero the harm leaves at 0 HP is settled at once: stable and up with 1 HP, or dead', () => {
  const ghost = { ...rogue, hp: 0, dead: true, diedAt: 0 };
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
  assert.deepEqual(thirst.lines.slice(0, 2).map((l) => l.split(' has')[0]), ['Bryn', 'Cleo']);
  assert.equal(thirst.lines[2], 'A new day.', 'a day passes, and the morning comes');
});

test('each morning by the clock the heroes eat their Rations, or go without', () => {
  const late = { ...party(), clock: 86_400 - 600 };
  const morning = playTurn(state({ party: late }), null, []);
  assert.equal(morning.lines[0], 'A new day.', morning.lines.join(' | '));
  assert.ok(morning.lines.some((l) => /^Bryn (eats a day.s Rations \(\d+ left\)|goes hungry but holds up)\.$/.test(l)), morning.lines.join(' | '));
  const noon = playTurn(state({ party: { ...party(), clock: 600 } }), null, []);
  assert.equal(noon.lines.includes('A new day.'), false);
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

/** A lone hero on their last hit point, blind to traps, moving into r4 (by way of r0-r4) where treasure lies: the trap is in `where`. */
function lastLegs(where: 'room' | 'corridor'): RulesState {
  const d = startDungeon('fixed', 3, [1], 4);
  const [r4, c] = [d.map.nodes.r4, d.map.nodes['r0-r4']];
  const treasure = { gp: 60, sp: 0, gems: 2, jewellery: 0, magicItem: null };
  const nodes = {
    ...d.map.nodes,
    'r0-r4': { ...c, contents: { ...c.contents!, kind: 'empty' as const, special: null, trap: where === 'corridor' ? c.contents!.trap : null } },
    r4: { ...r4, contents: { ...r4.contents!, kind: 'empty' as const, encounter: null, trap: where === 'room' ? 'pits' : null, treasure } },
  };
  const hero = { ...fighter, hp: 1, maxHp: 1, skillBonuses: { ...fighter.skillBonuses, investigation: -5, perception: -5 } };
  return { party: { version: 1, rng: 1, sheets: { p1: hero } }, combat: null, dungeon: { ...d, map: { ...d.map, nodes } } };
}

test('a trap that kills the last hero standing ends the move: nobody takes the treasure, nobody walks on', () => {
  const alone = [{ playerId: 'p1', choiceId: 'a' as const, roll: 1 }];
  const room = playTurn(lastLegs('room'), { kind: 'move', exit: 'r4' }, alone);
  assert.equal(room.party.sheets.p1.dead, true, room.lines.join(' | '));
  assert.equal(room.lines.some((l) => l.startsWith('Treasure')), false, 'the dead take nothing');
  assert.equal(room.party.sheets.p1.gp, fighter.gp);
  assert.equal(room.dungeon!.cleared.includes('r4'), false, 'its treasure still lies there');
  const corridor = playTurn(lastLegs('corridor'), { kind: 'move', exit: 'r4' }, alone);
  assert.equal(corridor.party.sheets.p1.dead, true, corridor.lines.join(' | '));
  assert.equal(corridor.dungeon!.at, 'r0-r4', 'the dead go no further');
  assert.equal(corridor.lines.some((l) => l.startsWith('The party enters') || l.startsWith('Treasure')), false, corridor.lines.join(' | '));
});

test('a corridor is passed through on the way to the room: its trap springs, ten more minutes pass, it is on the map', () => {
  const d = startDungeon('fixed', 3, [1, 1], 4);
  assert.equal(d.map.nodes['r0-r4'].name, 'Winding passage');
  const gone = playTurn(state({ dungeon: d }), { kind: 'move', exit: 'r4' }, ballots(5, 5));
  assert.equal(gone.lines[0], 'The party goes by way of a winding passage.');
  assert.ok(gone.lines.includes('Nobody notices the Spiked Pit.') || gone.lines.some((l) => l.includes('spots a Spiked Pit')));
  assert.equal(gone.lines.filter((l) => l.startsWith('The party enters Cramped')).length, 1);
  assert.deepEqual([gone.dungeon!.at, gone.dungeon!.visited, gone.party.clock], ['r4', ['r0', 'r0-r4', 'r4'], 1200]);
  assert.ok(gone.dungeon!.cleared.includes('r0-r4'), 'its trap is spent');
  const again = playTurn({ ...gone, combat: null }, { kind: 'move', exit: 'r0' }, []);
  assert.deepEqual([again.dungeon!.at, again.lines.some((l) => l.includes('Spiked Pit'))], ['r0', false]);
});

const inDungeon = (rng: number, over: Partial<DungeonState> = {}) => ({ ...state({ dungeon: { ...startDungeon('fixed', 3, [1, 1], 4), ...over } }), party: { ...party(), rng } });
const seeds = Array.from({ length: 80 }, (_, i) => i + 1);

test('wandering monsters: a check every half hour in a dungeon; on a 1 a band comes, and Hostile ones bar the way', () => {
  const quiet = playTurn(inDungeon(1), null, []);
  assert.deepEqual([quiet.dungeon!.wander, quiet.party.rng], [600, 1], 'ten minutes toward the next check, no dice');
  const turns = seeds.map((rng) => playTurn(inDungeon(rng, { wander: 1200 }), null, []));
  assert.ok(turns.every((t) => t.dungeon!.wander === 0));
  const came = turns.filter((t) => t.lines.some((l) => l.startsWith('Wandering monsters (d6: 1): ')));
  assert.ok(came.length > 3 && came.length < 30, String(came.length));
  const wandering = (t: RulesTurn) => t.lines.find((l) => l.startsWith('Wandering'))!;
  const barred = came.find((t) => wandering(t).includes('hostile') && wandering(t).includes('2d6'))!;
  assert.match(wandering(barred), /They are hostile \(2d6: [2-5]\)\. They bar the way\.$/);
  assert.equal(barred.fight, null);
  assert.ok(barred.dungeon!.facing);
  const slipped = playTurn(barred, { kind: 'run' }, []);
  assert.equal(slipped.dungeon!.facing, undefined);
  assert.equal(slipped.dungeon!.at, barred.dungeon!.at, 'wanderers are slipped past; the party stays');
  assert.equal(slipped.fight, null);
  const passed = came.find((t) => !t.dungeon!.facing)!;
  assert.match(passed.lines.at(-1)!, /They are (indifferent|friendly) \(2d6: \d+\)\. They go their way\.$/);
  assert.equal(playTurn({ ...state(), party: { ...party(), rng: barred.party.rng } }, null, []).dungeon, null, 'none outside a dungeon');
});

test('noise brings a check at once, 2 in 6: after a fight ends or a trap goes off', () => {
  const loudTurns = seeds.map((rng) => playTurn(inDungeon(rng, { noise: true }), null, []));
  assert.ok(loudTurns.every((t) => t.dungeon!.noise === undefined && t.dungeon!.wander === 600));
  const came = loudTurns.filter((t) => t.lines.some((l) => /^Wandering monsters \(d6: [12]\)/.test(l))).length;
  assert.ok(came > 15 && came < 45, String(came));
  const d = startDungeon('fixed', 3, [1, 1], 4);
  const pit = playTurn({ ...inDungeon(5), dungeon: d }, { kind: 'trap', trap: 'spiked-pit' }, ballots(1, 1));
  assert.equal(pit.success, false);
  assert.notEqual(pit.party.rng, playTurn({ ...inDungeon(5), dungeon: d, party: { ...party(), rng: 5 } }, { kind: 'check', ability: 'str', dc: 1 }, ballots(1, 1)).party.rng);
});

test('a rest in a dungeon gets one check first; wanderers who come interrupt it, and no time passes', () => {
  const rests = seeds.map((rng) => playTurn(inDungeon(rng, { wander: 1500 }), { kind: 'rest', rest: 'long' }, []));
  const broken = rests.find((t) => t.dungeon!.facing)!;
  assert.deepEqual([broken.lines[0], broken.party.clock, broken.lines.some((l) => l.startsWith('The party takes a long rest'))], ['Before the party can rest:', 0, false]);
  const slept = rests.find((t) => t.lines.some((l) => l.startsWith('The party takes a long rest')))!;
  assert.deepEqual([slept.party.clock, slept.dungeon!.wander], [8 * 3600, 0]);
});

test('spoor in a corridor makes a check on the way, 2 in 6; Hostile wanderers stop the party there', () => {
  const d = startDungeon('fixed', 3, [1, 1], 4);
  const c = d.map.nodes['r0-r4'];
  const spoored = { ...d.map.nodes, 'r0-r4': { ...c, contents: { ...c.contents!, trap: null, kind: 'empty' as const, special: 'spoor' } } };
  const walks = seeds.map((rng) => playTurn({ ...inDungeon(rng), dungeon: { ...d, map: { ...d.map, nodes: spoored } } }, { kind: 'move', exit: 'r4' }, []));
  const stopped = walks.find((t) => t.dungeon!.facing && t.dungeon!.at === 'r0-r4')!;
  assert.match(stopped.lines[1], /^Wandering monsters \(d6: [12]\)/);
  assert.ok(walks.some((t) => t.dungeon!.at === 'r4'));
});

test('foes waiting in the room keep wanderers off', () => {
  const t = met('indifferent');
  const turns = seeds.map((rng) => playTurn({ ...t, combat: null, party: { ...t.party, rng }, dungeon: { ...t.dungeon!, wander: 1700 } }, null, []));
  assert.ok(turns.every((x) => !x.lines.some((l) => l.startsWith('Wandering'))));
});

test('every turn outside a fight a netted hero tries to break free, and timed conditions wear off', () => {
  const netted = { ...fighter, conditions: [{ condition: 'restrained' as const, until: { kind: 'escape' as const, ability: 'str' as const, skill: 'athletics', dc: 10 } }, { condition: 'poisoned' as const, until: { kind: 'time' as const, left: 600 } }] };
  const t = playTurn(state({ party: party({ p1: netted, p2: rogue }) }), null, []);
  assert.ok(t.lines.some((l) => /^Bryn (breaks free|is still Restrained) \(Athletics \d+ vs DC 10\)\.$/.test(l)));
  assert.ok(t.lines.includes('Bryn is no longer Poisoned.'));
  const rested = playTurn(state({ party: party({ p1: netted, p2: rogue }) }), { kind: 'rest', rest: 'short' }, []);
  assert.ok(!rested.lines.some((l) => l.includes('Athletics')), 'no tries during a rest');
});

test('a hero who dies in a turn is marked with the clock at its start; one already marked keeps its time', () => {
  const frail = party({ p1: { ...fighter, hp: 1, maxHp: 1 }, p2: { ...rogue, hp: 0, dead: true, diedAt: 5 } });
  const later = { ...frail, clock: 7200 };
  const fall = playTurn(state({ party: later }), { kind: 'hazard', hazard: 'falling', feet: 60 }, ballots(1, 1));
  assert.equal(fall.party.sheets.p1.dead, true, fall.lines.join(' | '));
  assert.equal(fall.party.sheets.p1.diedAt, 7200);
  assert.equal(fall.party.sheets.p2.diedAt, 5);
});

const tough = () => party({ p1: { ...fighter, hp: 500, maxHp: 500 }, p2: { ...rogue, hp: 500, maxHp: 500 } });
const pitLoss = (level: number) => seeds.reduce((lost, rng) => {
  const d = { ...startDungeon('fixed', 3, [1, 1], 4), level };
  const t = playTurn({ ...state({ dungeon: d }), party: { ...tough(), rng } }, { kind: 'trap', trap: 'spiked-pit' }, ballots(1, 1));
  return lost + 1000 - t.party.sheets.p1.hp - t.party.sheets.p2.hp;
}, 0);

test('in a dungeon, a trap is scaled to the dungeon’s level, not the party’s', () => {
  assert.ok(pitLoss(5) > pitLoss(1) * 1.3, `${pitLoss(5)} vs ${pitLoss(1)}`);
});

test('wanderers in a deeper dungeon are a band for its level', () => {
  const foes = (t: RulesTurn) => t.dungeon?.facing?.monsters ?? [];
  const turns = seeds.map((rng) => playTurn({ ...inDungeon(rng, { wander: 1200, level: 6 }), party: { ...tough(), rng } }, null, []));
  const bands = turns.flatMap(foes);
  assert.ok(bands.length > 0);
  const shallow = seeds.map((rng) => playTurn({ ...inDungeon(rng, { wander: 1200 }), party: { ...tough(), rng } }, null, [])).flatMap(foes);
  const xp = (ids: string[]) => ids.reduce((n, id) => n + monster(id).xp, 0) / Math.max(1, ids.length);
  assert.ok(xp(bands) > xp(shallow), `${xp(bands)} vs ${xp(shallow)}`);
});

test('going deeper is told: the line after the party enters names the new level', () => {
  const found = Array.from({ length: 120 }, (_, i) => startDungeon('fixed', i + 1, [1, 1], 6))
    .map((d) => ({ d, door: d.map.nodes[d.at].exits.find((x) => x.connection.endsWith('-door') && d.map.nodes[x.to!].type === 'room') }))
    .filter(({ door }) => door)
    .map(({ d, door }) => playTurn(state({ dungeon: d }), { kind: 'move', exit: door!.id }, ballots(5, 5)))
    .find((t) => t.dungeon!.level === 2)!;
  assert.ok(found);
  assert.equal(found.lines[1], 'The way leads deeper: dungeon level 2.');
});

test('a fight the DM proposes is held to a high encounter at the dungeon level (outside one, at the heroes’ levels)', () => {
  const foes = (t: RulesTurn) => Object.values(t.combat!.combatants).filter((c) => c.side === 'foes').length;
  const goblins = { kind: 'fight' as const, monsters: Array(5).fill('goblin-warrior') };
  assert.equal(foes(playTurn(state(), goblins, ballots(5, 5))), 1, 'two level-1 heroes meet one foe');
  const d = startDungeon('explore', 3, [1, 1], 4);
  assert.equal(foes(playTurn(state({ dungeon: d }), goblins, ballots(5, 5))), 1);
  assert.equal(foes(playTurn(state({ dungeon: { ...d, level: 5 } }), goblins, ballots(5, 5))), 4, 'at dungeon level 5, twice the party');
});

// The road from the tavern (play/trek.ts): to the dungeon door, or in a tale told (no dungeon) to where the tale begins
const leg = (event: TrekLeg['event'], monsters: string[] = [], treasure: TrekLeg['treasure'] = null): TrekLeg => ({ event, roll: 1, monsters, treasure, wares: [] });
const ENDS = ['door', 'tale'] as const;
const onTheRoad = (legs: TrekLeg[], end: (typeof ENDS)[number], facing?: Trek['facing']): RulesState => {
  const base = state({ dungeon: end === 'door' ? startDungeon('fixed', 3, [1, 1], 4) : null });
  return { ...base, party: { ...base.party, trek: { terrain: 'a forest road', leg: 0, legs, leadsTo: end, ...(facing ? { facing } : {}) } } };
};
const look = { kind: 'check' as const, ability: 'wis' as const, skill: 'perception', dc: 5 };
const gold = { sp: 0, gp: 40, gems: 0, jewellery: 0, magicItem: null };
const hostile = { monsters: ['bandit'], attitude: 'hostile' as const };

test('on the road the party goes on by itself after each scene: the next stretch is met, then the dungeon door or where the tale begins', () => {
  for (const end of ENDS) {
    const start = onTheRoad([leg('quiet'), leg('quiet')], end);
    const first = playTurn(start, look, ballots(10, 10));
    assert.equal(first.party.trek!.leg, 1, end);
    assert.ok(first.lines.includes('On the road (d12: 1): a quiet stretch.'));
    assert.ok(first.party.clock! - (start.party.clock ?? 0) >= 2 * 3600, 'a stretch of road takes two hours');
    const there = playTurn(first, null, []);
    assert.equal(there.party.trek, undefined);
    assert.equal(there.lines.at(-1), end === 'door' ? 'The party reaches the dungeon door.' : 'The road ends where the tale begins.');
    assert.equal(there.dungeon?.at ?? null, end === 'door' ? start.dungeon!.map.entrance : null);
    assert.equal(playTurn(there, null, []).party.trek, undefined, 'and stays there');
  }
});

test('on the road there are no exits to take, no dungeon wanderers, and daylight', () => {
  const road = onTheRoad([leg('quiet'), leg('quiet')], 'door');
  const moved = playTurn(road, { kind: 'move', exit: road.dungeon!.map.nodes[road.dungeon!.map.entrance].exits[0].id }, []);
  assert.equal(moved.lines[0], 'The road leads on; the dungeon door is still ahead.');
  assert.equal(moved.dungeon!.at, road.dungeon!.at);
  const torch = { ...fighter, equipment: [...fighter.equipment, { id: 'torch', name: 'Torch', count: 1 }] };
  for (const end of ENDS) {
    const r = onTheRoad([leg('quiet'), leg('quiet')], end);
    const rested = playTurn({ ...r, party: { ...r.party, sheets: { p1: torch } } }, { kind: 'rest', rest: 'short' }, []);
    assert.ok(!rested.lines.some((l) => /Wandering|Before the party can rest|lights/.test(l)), rested.lines.join(' | '));
  }
});

test('foes barring the road, with or without a dungeon: Engage, Run or Parley; Run slips past and the party goes on; a failed Parley and they attack', () => {
  for (const end of ENDS) {
    const barred = onTheRoad([leg('bandits', ['bandit']), leg('quiet')], end, hostile);
    assert.deepEqual(confrontationChoices(barred)!.map((c) => c.hook), [{ kind: 'engage', monsters: ['bandit'] }, { kind: 'run' }, { kind: 'parley' }], end);
    assert.equal(confrontationChoices(onTheRoad([leg('bandits', ['bandit']), leg('quiet')], end, { ...hostile, attitude: 'indifferent' })), null);
    const ran = playTurn(barred, { kind: 'run' }, []);
    assert.deepEqual([ran.party.trek!.leg, ran.party.trek!.facing, ran.fight], [1, undefined, null]);
    assert.ok(ran.lines.includes('The party slips past. The wanderers do not pursue.'));
    const talked = playTurn(barred, { kind: 'parley' }, ballots(1, 1));
    assert.equal(talked.fight, 'started');
    assert.ok(talked.combat);
    assert.deepEqual([talked.party.trek!.leg, talked.party.trek!.facing], [0, undefined], 'the party goes on once the fight is over');
    assert.ok(talked.lines.includes('They will not let the party pass: they attack.'));
    assert.ok(talked.lines.includes('Both sides begin far, about 60 feet apart.'));
    assert.ok(Object.values(talked.combat!.combatants).every((c) => c.place?.band === 'far'));
    const swayed = playTurn(barred, { kind: 'parley' }, ballots(20, 20));
    assert.deepEqual([swayed.fight, swayed.party.trek!.leg, swayed.party.trek!.facing], [null, 1, undefined], 'swayed, they let the party by');
  }
});

test('a fight on the road: XP as any fight, the stretch\u2019s treasure for the victors, then the road goes on', () => {
  for (const end of ENDS) {
    const road = onTheRoad([leg('band', ['goblin-minion'], gold), leg('quiet')], end, { monsters: ['goblin-minion'], attitude: 'hostile' });
    let t: RulesTurn = playTurn(road, { kind: 'engage', monsters: ['goblin-minion'] }, ballots(15, 15));
    assert.deepEqual([t.fight, t.party.trek!.facing], ['started', undefined]);
    for (let i = 0; i < 20 && t.combat; i++) t = playTurn(t, null, ballots(18, 18));
    assert.equal(t.fight, 'victory');
    assert.equal(t.party.trek!.leg, 1);
    const before = Object.values(road.party.sheets).reduce((gp, s) => gp + s.gp, 0);
    assert.equal(Object.values(t.party.sheets).reduce((gp, s) => gp + s.gp, 0), before + 40);
    assert.ok(Object.values(t.party.sheets).every((s) => s.xp > 0));
  }
});
