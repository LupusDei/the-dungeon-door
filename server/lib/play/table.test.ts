import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heroSheet } from '../characters.ts';
import type { Resolution } from '../dm/types.ts';
import { generateDungeon } from '../rules/dungeon.ts';
import type { Game, GamePlayer, StoredScene } from '../types.ts';
import { dungeonLevel } from './delve.ts';
import { startFight } from './fight.ts';
import type { PartyState } from './state.ts';
import { choiceView, dungeonMode, endQuest, engineStep, newRules, rulesStateOf, sceneCountAfter, storedChoice, writeBack } from './table.ts';

const fighter = heroSheet({ id: 'f', name: 'Bryn', race: 'human', characterClass: 'fighter' });
const player = (playerId: string, name: string, sheet?: typeof fighter): GamePlayer => ({
  playerId, joinedAt: '', character: { id: `c-${playerId}`, ownerId: playerId, name, race: 'human', characterClass: 'fighter', gender: 'male', temperament: 'stoic', alignment: 'neutral', backstory: '', description: '', appearance: '', portraitUrl: null, createdAt: '', updatedAt: '', ...(sheet ? { sheet } : {}) } as GamePlayer['character'],
});

test('the dungeon option at start: none (the default), fixed or explore; anything else is refused', () => {
  assert.deepEqual([dungeonMode(undefined), dungeonMode(null), dungeonMode('fixed'), dungeonMode('explore'), dungeonMode('none')], ['none', 'none', 'fixed', 'explore', 'none']);
  assert.throws(() => dungeonMode('maze'), /dungeon must be "none", "fixed" or "explore"/);
});

test('a new game’s rules: every hero’s sheet (built for a hero saved before the engine), a dungeon if asked for', () => {
  const players = [player('p1', 'Bryn', { ...fighter, level: 1, xp: 120 }), player('p2', 'Old Hero')];
  const plain = newRules(players, 'none', 7, 4);
  assert.deepEqual([plain.party.version, plain.party.rng, plain.combat, plain.dungeon], [1, 7, null, null]);
  assert.equal(plain.party.sheets.p1.xp, 120, 'the hero’s own sheet');
  assert.equal(plain.party.sheets.p2.name, 'Old Hero', 'built for a legacy hero');
  assert.equal(newRules(players, 'fixed', 7, 4).dungeon!.map.mode, 'fixed');
  assert.equal(newRules(players, 'explore', 7, 4).dungeon!.map.mode, 'explore');
});

test('a new game’s dungeon starts at the living heroes’ average level, rounded down; new heroes start at 1', () => {
  const at = (level: number, dead = false) => ({ ...fighter, level, ...(dead ? { dead: true } : {}) });
  const party = [player('p1', 'A', at(3)), player('p2', 'B', at(6)), player('p3', 'C', at(12, true))];
  for (const mode of ['fixed', 'explore'] as const) {
    const d = newRules(party, mode, 7, 4).dungeon!;
    assert.deepEqual([dungeonLevel(d), d.map.nodes[d.at].depth], [4, 4], mode);
  }
  assert.equal(dungeonLevel(newRules([player('p1', 'A'), player('p2', 'B')], 'fixed', 7, 4).dungeon!), 1);
});

test('a game from before the engine has no rules state', () => {
  const party: PartyState = { version: 1, rng: 1, sheets: {} };
  assert.equal(rulesStateOf({ party: null, combat: null, dungeon: null } as unknown as Game), null);
  assert.deepEqual(rulesStateOf({ party, combat: null, dungeon: null } as unknown as Game), { party, combat: null, dungeon: null });
  const map = generateDungeon(7, 'delve', [3]);
  const room = Object.values(map.nodes).find((n) => n.contents !== null)!;
  const old = { ...map, nodes: { ...map.nodes, [room.id]: { ...room, contents: { ...room.contents!, trap: 'pits' } } } };
  const dungeon = { version: 1, map: old, at: map.entrance, visited: [], cleared: [] };
  assert.equal(rulesStateOf({ party, combat: null, dungeon } as unknown as Game)!.dungeon!.map.nodes[room.id].contents!.trap, 'hidden-pit', 'a 5.1 trap id read as its 5.2 one');
  const packed = { ...party, sheets: { ...party.sheets, p9: { ...heroSheet({ id: 'x', name: 'Ann', race: 'human', characterClass: 'fighter' }), equipment: [{ id: 'dungeoneer-pack', name: 'Pack', count: 1 }] } } };
  const read = rulesStateOf({ party: packed, combat: null, dungeon: null } as unknown as Game)!.party;
  assert.equal(read.sheets.p9.equipment.some((e) => e.id === 'torch'), true, 'packs opened as the game is read');
  assert.deepEqual(Object.keys(read.sheets), Object.keys(packed.sheets));
});

test('a choice keeps a hook that holds up and shows it as a label; a bad hook or none is pure story', () => {
  const good = storedChoice({ id: 'a', label: 'Climb', detail: 'Up.' }, { kind: 'check', ability: 'str', skill: 'athletics', dc: 12 });
  assert.deepEqual(choiceView(good), { id: 'a', label: 'Climb', detail: 'Up.', rules: 'Athletics check, DC 12' });
  assert.deepEqual(storedChoice({ id: 'b', label: 'x', detail: 'y' }, { kind: 'check', ability: 'str', dc: 99 }).hook, null);
  assert.deepEqual(choiceView({ id: 'c', label: 'x', detail: 'y' }), { id: 'c', label: 'x', detail: 'y', rules: null });
});

const scene = (choices: StoredScene['choices']): StoredScene => ({ index: 0, title: '', narration: '', imagePrompt: '', imageUrl: null, voiceUrl: null, choices, isFinale: false, votes: [], outcome: null, chosenChoiceId: null, createdAt: '' });
const resolution = (leaders: Resolution['leaders'], votes: [string, 'a' | 'b' | 'c', number][]): Resolution => ({
  scene: {} as Resolution['scene'], tally: { a: 0, b: 0, c: 0 }, abstained: [], rules: null, leaders,
  votes: votes.map(([playerId, choiceId, roll]) => ({ playerId, characterName: playerId, choiceId, choiceLabel: '', roll })),
});
const party: PartyState = { version: 1, rng: 3, sheets: { p1: fighter } };

test('the engine step: the tie goes to the higher roll, the chosen hook is rolled, the DM hears the results', () => {
  const choices = [storedChoice({ id: 'a', label: 'Rest', detail: '' }, { kind: 'rest', rest: 'long' }),
    storedChoice({ id: 'b', label: 'Climb', detail: '' }, { kind: 'check', ability: 'str', skill: 'athletics', dc: 5 })];
  const step = engineStep({ party, combat: null, dungeon: null }, scene(choices), resolution(['a', 'b'], [['p1', 'b', 18], ['p2', 'a', 4]]));
  assert.deepEqual(step.resolution.leaders, ['b']);
  assert.deepEqual([step.resolution.rules!.chosen, step.resolution.rules!.success, step.resolution.rules!.fight], ['b', true, null]);
  assert.match(step.resolution.rules!.lines[0], /^Bryn: Athletics 18/);
  assert.deepEqual(step.state.party.results, step.resolution.rules!.lines);
  assert.equal(step.round, false);
  const story = engineStep({ party, combat: null, dungeon: null }, scene([{ id: 'a', label: '', detail: '' }]), resolution(['a'], [['p1', 'a', 2]]));
  assert.deepEqual([story.resolution.rules!.lines, story.state.party.results], [[], []]);
});

test('in a fight the step is a combat round, whatever the choices say', () => {
  const { party: p, combat } = startFight(party, ['goblin-warrior']);
  const choices = [storedChoice({ id: 'a', label: 'Attack', detail: '' }, { kind: 'rest', rest: 'long' })];
  const step = engineStep({ party: p, combat, dungeon: null }, scene(choices), resolution(['a'], [['p1', 'a', 10]]));
  assert.equal(step.resolution.rules!.chosen, null);
  assert.deepEqual(step.resolution.leaders, ['a'], 'the chronicle still names the choice');
  assert.ok(step.state.combat === null || step.state.combat.round === 2);
  assert.equal(step.round, true);
});

test('scene count: each combat round adds a scene, a fight on is never followed by the epilogue, defeat ends it', () => {
  const base = { party, combat: null, dungeon: null };
  const { combat } = startFight(party, ['goblin-warrior']);
  assert.equal(sceneCountAfter({ state: base, fight: null, round: false }, 2, 4), 4);
  assert.equal(sceneCountAfter({ state: { ...base, combat }, fight: 'started', round: false }, 1, 4), 4);
  assert.equal(sceneCountAfter({ state: { ...base, combat }, fight: 'started', round: false }, 3, 4), 5, 'not the epilogue yet');
  assert.equal(sceneCountAfter({ state: { ...base, combat }, fight: null, round: true }, 2, 4), 5);
  assert.equal(sceneCountAfter({ state: base, fight: 'victory', round: true }, 2, 4), 5);
  assert.equal(sceneCountAfter({ state: base, fight: 'defeat', round: true }, 1, 4), 2);
});

test('at the end the heroes go home: their sheets after a long rest (the fallen too), for the players still at the table', () => {
  const hurt: PartyState = { version: 1, rng: 1, sheets: { p1: { ...fighter, hp: 0, xp: 300, level: 1 }, gone: fighter } };
  const back = writeBack(hurt, [player('p1', 'Bryn')]);
  assert.deepEqual(back.map((b) => [b.characterId, b.sheet.hp, b.sheet.xp]), [['c-p1', fighter.maxHp, 300]]);
});

test('the dead go home dead: no rest, no HP', () => {
  const ghost = { ...fighter, hp: 0, dead: true, hitDiceSpent: 1 };
  assert.deepEqual(writeBack({ version: 1, rng: 1, sheets: { p1: ghost } }, [player('p1', 'Bryn')])[0].sheet, ghost);
});

test('at the quest’s end the living heroes level up as far as their XP reaches; the dead do not; the lines go to the table and the DM', () => {
  const party: PartyState = { version: 1, rng: 1, sheets: { p1: { ...fighter, xp: 300 }, p2: { ...fighter, name: 'Cleo', xp: 900, dead: true }, p3: { ...fighter, name: 'Dag', xp: 299 } } };
  const story = engineStep({ party, combat: null, dungeon: null }, scene([{ id: 'a', label: '', detail: '' }]), resolution(['a'], [['p1', 'a', 2]]));
  const ended = endQuest(story);
  const gained = ended.state.party.sheets.p1.maxHp - fighter.maxHp;
  assert.deepEqual([ended.state.party.sheets.p1.level, ended.state.party.sheets.p2.level, ended.state.party.sheets.p3.level], [2, 1, 1]);
  assert.deepEqual(ended.state.party.levelUps, [{ playerId: 'p1', from: 1, to: 2 }]);
  assert.deepEqual(ended.state.party.results, [...story.state.party.results!, `Bryn reaches level 2 (+${gained} max HP).`]);
  assert.deepEqual(ended.resolution.rules!.lines, ended.state.party.results);
  assert.deepEqual(endQuest({ ...story, resolution: { ...story.resolution, rules: null } }).resolution.rules, null);
  const none = endQuest(engineStep({ party: { ...party, sheets: { p3: party.sheets.p3 } }, combat: null, dungeon: null }, scene([]), resolution([], [])));
  assert.deepEqual(none.state.party.levelUps, []);
  const fresh = endQuest({ ...story, state: { ...story.state, party } }); // a party with no lines yet
  assert.deepEqual(fresh.state.party.results, [`Bryn reaches level 2 (+${gained} max HP).`]);
});
