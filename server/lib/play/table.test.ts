import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heroSheet } from '../characters.ts';
import type { Resolution } from '../dm/types.ts';
import { generateDungeon } from '../rules/dungeon.ts';
import type { Game, GamePlayer, StoredScene } from '../types.ts';
import { dungeonLevel } from './delve.ts';
import { startFight } from './fight.ts';
import type { PartyState } from './state.ts';
import { meetOnTheRoad, planTrek } from './trek.ts';
import { choiceView, dungeonMode, endingOf, endQuest, engineStep, newRules, rulesStateOf, sceneCountAfter, storedChoice, writeBack } from './table.ts';
import type { RulesState } from './turn.ts';
import type { Quest } from './quest.ts';

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

test('every game starts on the road from the tavern, two seeded stretches with the first already met: to the dungeon door, or in a tale told to where the tale begins', () => {
  const players = [player('p1', 'A'), player('p2', 'B')];
  for (const [mode, end] of [['fixed', 'door'], ['explore', 'door'], ['none', 'tale']] as const) {
    const r = newRules(players, mode, 7, 4);
    const { facing, ...trek } = r.party.trek!;
    assert.deepEqual(trek, planTrek(7, [1, 1], 1, end), mode);
    const met = meetOnTheRoad({ version: 1, rng: 7, sheets: r.party.sheets, trek });
    assert.deepEqual([r.party.rng, facing], [met.party.rng, met.party.trek!.facing], 'the first stretch is met as the game starts');
    assert.equal(r.dungeon === null, mode === 'none', 'the road is kept apart from any dungeon');
  }
  assert.equal(newRules([player('p1', 'A')], 'none', 7, 4).party.trek!.legs.length, 2, 'a lone hero walks it too');
});

test('a game stored with the road in its dungeon (before a tale told had one) reads with the road, and its foes, kept by the party', () => {
  const r = newRules([player('p1', 'A')], 'fixed', 7, 4);
  const { trek, ...party } = r.party;
  const { leadsTo: _, facing, ...road } = trek!;
  const hostile = { monsters: ['bandit'], attitude: 'hostile' as const };
  const old = { party, combat: null, dungeon: { ...r.dungeon!, trek: road, facing: hostile } } as unknown as Game;
  const read = rulesStateOf(old)!;
  assert.deepEqual(read.party.trek, { ...road, leadsTo: 'door', facing: hostile });
  assert.deepEqual([Object.hasOwn(read.dungeon!, 'trek'), Object.hasOwn(read.dungeon!, 'facing')], [false, false]);
  const quiet = rulesStateOf({ ...old, dungeon: { ...r.dungeon!, trek: road } } as unknown as Game)!;
  assert.deepEqual(quiet.party.trek, { ...road, leadsTo: 'door' });
  assert.equal(facing === undefined || facing.monsters.length > 0, true);
  const inside = rulesStateOf({ party, combat: null, dungeon: { ...r.dungeon!, facing: hostile } } as unknown as Game)!;
  assert.deepEqual([inside.party.trek, inside.dungeon!.facing], [undefined, hostile], 'wanderers met in the dungeon stay there');
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

test('a way on is labelled where it was offered, by the way and not the exit id, and keeps that label once the party has moved', () => {
  const d = newRules([], 'fixed', 3, 4).dungeon!;
  const exit = d.map.nodes[d.at].exits[0].id;
  const go = storedChoice({ id: 'a', label: 'Onward', detail: '' }, { kind: 'move', exit }, d);
  assert.match(choiceView(go).rules!, /^Go on \([a-z ]+\)$/);
  assert.equal(go.rules, choiceView(go).rules, 'stored with the choice, so a resolved scene still reads as it did');
  assert.equal(choiceView({ ...go, rules: undefined }).rules, 'Go on', 'a choice stored before labels were: never the exit id');
  assert.equal(storedChoice({ id: 'b', label: 'x', detail: 'y' }, null, d).rules, null);
});

const scene = (choices: StoredScene['choices']): StoredScene => ({ index: 0, title: '', narration: '', imagePrompt: '', imageUrl: null, voices: {}, choices, isFinale: false, votes: [], outcome: null, chosenChoiceId: null, createdAt: '' });
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

/**
 * A whole game of `sceneCount` scenes, as lib/game.ts plays it (a scene is the epilogue once next >= count - 1):
 * the party takes a fight in every story scene listed in `fightIn` (by story scene, from 0), each lasting
 * `rounds` rounds and ending in `end`. What each scene was.
 */
function play(sceneCount: number, fightIn: number[], rounds: number, end: 'victory' | 'defeat' | 'fled' = 'victory'): string[] {
  const base = { party, combat: null, dungeon: null };
  const { combat } = startFight(party, ['goblin-warrior']);
  const scenes: string[] = [];
  let [count, story, left] = [sceneCount, 0, 0];
  for (let i = 0; i < 100; i++) {
    if (i >= count - 1) return [...scenes, 'epilogue'];
    let step: Parameters<typeof sceneCountAfter>[0];
    if (left > 0) {
      left--;
      scenes.push('round');
      step = left > 0 ? { state: { ...base, combat }, fight: null } : { state: base, fight: end };
    } else {
      scenes.push('story');
      const fights = fightIn.includes(story++);
      if (fights) left = rounds;
      step = fights ? { state: { ...base, combat }, fight: 'started' } : { state: base, fight: null };
    }
    count = sceneCountAfter(step, i + 1, count);
  }
  return scenes;
}

test('a fight taken in the last story scene and won is followed by the epilogue, however many rounds it lasts', () => {
  assert.deepEqual(play(4, [2], 1), ['story', 'story', 'story', 'round', 'epilogue']);
  assert.deepEqual(play(4, [2], 3), ['story', 'story', 'story', 'round', 'round', 'round', 'epilogue']);
  assert.deepEqual(play(4, [2], 2, 'fled'), ['story', 'story', 'story', 'round', 'round', 'epilogue'], 'the foes fled');
});

test('a fight lost is followed by the epilogue, wherever it was taken', () => {
  assert.deepEqual(play(4, [2], 2, 'defeat'), ['story', 'story', 'story', 'round', 'round', 'epilogue']);
  assert.deepEqual(play(6, [0], 1, 'defeat'), ['story', 'round', 'epilogue']);
});

test('rounds never use up the story: N - 1 story scenes, then the epilogue, with a fight taken in every one', () => {
  assert.deepEqual(play(4, [0], 2), ['story', 'round', 'round', 'story', 'story', 'epilogue']);
  const every = play(4, [0, 1, 2], 2);
  assert.deepEqual([every.filter((s) => s === 'story').length, every.filter((s) => s === 'round').length, every.at(-1), every.length], [3, 6, 'epilogue', 4 + 6]);
  assert.deepEqual(play(2, [0], 1), ['story', 'round', 'epilogue'], 'sceneCount 2: the opening, then the epilogue');
});

test('a fight still on is never followed by the epilogue, even in a game counted before this rule', () => {
  const { combat } = startFight(party, ['goblin-warrior']);
  assert.equal(sceneCountAfter({ state: { party, combat, dungeon: null }, fight: null }, 5, 4), 7, 'a count left too low: one more round, then the epilogue');
  assert.equal(sceneCountAfter({ state: { party, combat, dungeon: null }, fight: null }, 2, 6), 7);
});

test('a lost fight: the scene after it is the last, the epilogue, however many were planned', () => {
  assert.equal(sceneCountAfter({ state: { party, combat: null, dungeon: null }, fight: 'defeat' }, 3, 9), 4);
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

const voted = (choices: StoredScene['choices'], votes: StoredScene['votes'], index = 2): StoredScene => ({ ...scene(choices), index, votes });
const two: PartyState = { version: 1, rng: 3, sheets: { p1: fighter, p2: { ...fighter, name: 'Cleo' } } };

test('the engine step pays XP outside a fight: to each hero who declared, more for a check that came good; the DM and the table hear it', () => {
  const choices = [storedChoice({ id: 'a', label: 'Climb', detail: '' }, { kind: 'check', ability: 'str', skill: 'athletics', dc: 10 }, null, 'discovery')];
  const step = engineStep({ party: two, combat: null, dungeon: null }, voted(choices, [{ playerId: 'p1', choiceId: 'a', roll: 18 }]), resolution(['a'], [['p1', 'a', 18]]));
  const xpLines = step.state.party.results!.filter((l) => l.startsWith('+'));
  assert.deepEqual(xpLines, ['+5 XP: taking part (Bryn).', '+10 XP: a success (Bryn).', '+10 XP: a discovery (Bryn).'], 'Cleo did not declare');
  assert.deepEqual(step.resolution.rules!.lines, step.state.party.results);
  assert.deepEqual([step.state.party.sheets.p1.xp, step.state.party.sheets.p2.xp], [25, 0]);
  assert.deepEqual(step.state.party.xpAwards!.map((a) => a.playerId), ['p1']);
});

test('a tag pays only when its dice do not fail; a failed check is a brave failure', () => {
  const choices = [storedChoice({ id: 'a', label: 'Climb', detail: '' }, { kind: 'check', ability: 'str', skill: 'athletics', dc: 30 }, null, 'discovery')];
  const step = engineStep({ party: two, combat: null, dungeon: null }, voted(choices, [{ playerId: 'p1', choiceId: 'a', roll: 2 }]), resolution(['a'], [['p1', 'a', 2]]));
  assert.equal(step.resolution.rules!.success, false);
  assert.deepEqual(step.state.party.results!.filter((l) => l.startsWith('+')), ['+5 XP: taking part (Bryn).', '+5 XP: a brave failure (Bryn).']);
});

test('a story choice tagged by the DM pays its tag; a fight tagged a milestone pays nothing of it; a stray tag is dropped', () => {
  const story = [storedChoice({ id: 'a', label: 'Win them over', detail: '' }, null, null, 'social')];
  const talk = engineStep({ party: two, combat: null, dungeon: null }, voted(story, [{ playerId: 'p1', choiceId: 'a', roll: 9 }, { playerId: 'p2', choiceId: 'a', roll: 3 }]), resolution(['a'], [['p1', 'a', 9], ['p2', 'a', 3]]));
  assert.deepEqual(talk.state.party.results, ['+5 XP: taking part (Bryn, Cleo).', '+25 XP: a clever parley (Bryn, Cleo).']);
  const brawl = [storedChoice({ id: 'a', label: 'Fight', detail: '' }, { kind: 'fight', monsters: ['goblin-warrior'] }, null, 'milestone')];
  const fought = engineStep({ party: two, combat: null, dungeon: null }, voted(brawl, [{ playerId: 'p1', choiceId: 'a', roll: 9 }]), resolution(['a'], [['p1', 'a', 9]]));
  assert.deepEqual(fought.state.party.results!.filter((l) => l.startsWith('+')), ['+5 XP: taking part (Bryn).']);
  assert.equal(storedChoice({ id: 'a', label: '', detail: '' }, null, null, 'loot').reward, undefined);
  assert.equal('reward' in choiceView(story[0]), false, 'the tag is the engine’s, not shown to the players');
});

test('a hero whose die the clock threw earns half; a round of a fight earns a little for the action, with no line for it', () => {
  const story = [storedChoice({ id: 'a', label: 'Go on', detail: '' }, null)];
  const idle = engineStep({ party: two, combat: null, dungeon: null }, voted(story, [{ playerId: 'p1', choiceId: 'a', roll: 9 }, { playerId: 'p2', choiceId: 'a', roll: 3, autoRolled: true }]), resolution(['a'], [['p1', 'a', 9], ['p2', 'a', 3]]));
  assert.deepEqual(idle.state.party.results, ['+5 XP: taking part (Bryn).', '+2 XP: taking part, halved: their die was left to the clock (Cleo).']);
  const { party: p, combat } = startFight(two, ['goblin-warrior']);
  const round = engineStep({ party: p, combat, dungeon: null }, voted([], [{ playerId: 'p1', choiceId: 'c', roll: 10 }]), resolution(['c'], [['p1', 'c', 10]]));
  assert.ok(!round.state.party.results!.some((l) => l.startsWith('+')), round.state.party.results!.join(' | '));
  assert.equal(round.state.party.earned!.p1, 1, 'Bryn dodged: in the fight, 2% of a unit');
  assert.deepEqual(round.state.party.xpAwards, [{ playerId: 'p1', idle: false, xp: 1, reasons: [{ reason: 'in-fight', xp: 1 }] }]);
  assert.equal(round.state.party.earned!.p2 ?? 0, 0, 'Cleo declared nothing this round');
  // The result card says it under the hero, in the dice log's words.
  assert.deepEqual(round.result!.heroes.map((h) => [h.name, h.xp]), [
    ['Bryn', { total: 1, idle: false, reasons: [{ reason: 'in-fight', label: 'in the fight', xp: 1 }], chance: null }],
    ['Cleo', null],
  ]);
  assert.deepEqual(idle.result!.heroes.map((h) => [h.name, h.xp?.total, h.xp?.idle, h.xp?.reasons.map((r) => r.label)]), [
    ['Bryn', 5, false, ['taking part']], ['Cleo', 2, true, ['taking part']],
  ]);
});

test('new ground in a dungeon: the party enters a room it has not seen', () => {
  const rules = newRules([player('p1', 'Bryn', fighter)], 'fixed', 7, 6);
  const atDoor: RulesState = { ...rules, party: (({ trek: _, ...rest }) => rest)(rules.party) };
  const exit = atDoor.dungeon!.map.nodes[atDoor.dungeon!.at].exits[0].id;
  const choices = [storedChoice({ id: 'a', label: 'Go on', detail: '' }, { kind: 'move', exit }, atDoor.dungeon)];
  const step = engineStep(atDoor, voted(choices, [{ playerId: 'p1', choiceId: 'a', roll: 12 }]), resolution(['a'], [['p1', 'a', 12]]));
  assert.ok(step.state.party.results!.includes('+5 XP: new ground (Bryn).'), step.state.party.results!.join(' | '));
});

test('at the quest’s end each living hero who took part gets the adventure’s end, and it can carry them to the next level', () => {
  const ready: PartyState = { ...two, sheets: { p1: { ...fighter, xp: 260 }, p2: { ...fighter, name: 'Cleo', xp: 260 } } };
  const story = engineStep({ party: ready, combat: null, dungeon: null }, voted([{ id: 'a', label: '', detail: '' }], [{ playerId: 'p1', choiceId: 'a', roll: 9 }]), resolution(['a'], [['p1', 'a', 9]]));
  const ended = endQuest(story);
  assert.deepEqual([ended.state.party.sheets.p1.level, ended.state.party.sheets.p1.xp, ended.state.party.sheets.p2.level, ended.state.party.sheets.p2.xp], [2, 315, 1, 260]);
  const lines = ended.state.party.results!;
  assert.deepEqual(lines.slice(0, 2), ['+5 XP: taking part (Bryn).', '+50 XP: the adventure’s end (Bryn).']);
  assert.match(lines[2], /^Bryn reaches level 2 \(\+\d+ max HP\)\.$/);
  assert.deepEqual(ended.resolution.rules!.lines, lines);
});

test('a new game has a quest for the scenes asked for; one with no set length has none', () => {
  const players = [player('p1', 'Bryn'), player('p2', 'Ann')];
  for (const mode of ['none', 'fixed', 'explore'] as const) {
    const quest = newRules(players, mode, 7, 4).party.quest!;
    assert.deepEqual([quest.planned, quest.reached], [4, false], mode);
  }
  const fixed = newRules(players, 'fixed', 7, 4);
  assert.equal(fixed.dungeon!.map.goal, fixed.party.quest!.at);
  assert.equal(newRules(players, 'fixed', 7, 8, false).party.quest, undefined);
});

const QUEST: Quest = { kind: 'slay', target: 'Ogre', foes: ['ogre'], xp: 450, at: 'r2', planned: 4, reached: false };
const withQuest = (quest?: Quest) => ({ state: { party: { ...party, ...(quest ? { quest } : {}) }, combat: null, dungeon: null }, fight: null });

test('the scene count is pacing while the quest is open: the planned finale passes, as many scenes again are allowed, then the ending', () => {
  assert.deepEqual(endingOf(withQuest(QUEST), 5, 6), { isFinale: false, sceneCount: 6 }, 'past the plan: overtime');
  assert.deepEqual(endingOf(withQuest(QUEST), 8, 6), { isFinale: false, sceneCount: 6 });
  assert.deepEqual(endingOf(withQuest(QUEST), 9, 6), { isFinale: true, sceneCount: 10 }, 'the cap: twice the planned tale');
});

test('the goal reached: the next scene is the epilogue, however early', () => {
  assert.deepEqual(endingOf(withQuest({ ...QUEST, reached: true }), 3, 6), { isFinale: true, sceneCount: 4 });
});

test('the ending called, or no quest: the scene count is the end, as before', () => {
  assert.deepEqual(endingOf(withQuest({ ...QUEST, called: true }), 5, 6), { isFinale: true, sceneCount: 6 });
  assert.deepEqual(endingOf(withQuest(), 5, 6), { isFinale: true, sceneCount: 6 });
  assert.deepEqual(endingOf(withQuest(), 4, 6), { isFinale: false, sceneCount: 6 });
});

test('a round in overtime adds one scene, as anywhere; a lost fight ends it', () => {
  const { combat } = startFight(party, ['goblin-warrior']);
  const round = { state: { party: { ...party, quest: QUEST }, combat, dungeon: null }, fight: 'started' as const };
  assert.deepEqual(endingOf(round, 8, 6), { isFinale: false, sceneCount: 7 });
  assert.deepEqual(endingOf({ ...withQuest(QUEST), fight: 'defeat' }, 7, 6), { isFinale: true, sceneCount: 8 });
});

test('at the end a quest still open is closed, the goal not reached; one reached stays reached', () => {
  const step = (quest: Quest) => engineStep({ party: { ...party, quest }, combat: null, dungeon: null }, scene([]), resolution([], []));
  assert.deepEqual(endQuest(step(QUEST)).state.party.quest, { ...QUEST, called: true });
  assert.deepEqual(endQuest(step({ ...QUEST, reached: true })).state.party.quest, { ...QUEST, reached: true });
});
