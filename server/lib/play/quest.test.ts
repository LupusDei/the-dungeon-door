/**
 * The quest: a goal chosen at the start, sized to the party, that ends the adventure when it is reached.
 * The scene count is pacing: the goal is placed so the shortest way to it fits, and wrong turns and rests may
 * take longer, up to the cap (play/quest.ts).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { candidates, stockedBudget } from '../rules/encounter.ts';
import { monster } from '../rules/monsters.ts';
import { SAMPLE } from '../rules/sheet.fixture.ts';
import { startDungeon } from './delve.ts';
import { confrontGoal, goalFound, goalText, overtime, planQuest, questAfter, questClosed, questView, towardTheGoal, type Quest } from './quest.ts';
import type { DungeonState, PartyState } from './state.ts';
import type { RulesTurn } from './turn.ts';
import type { StoredChoice } from '../types.ts';

const levels = [1, 1];
const fixed = (planned: number, seed = 42) => planQuest(seed, levels, planned, startDungeon('fixed', seed, levels, planned));
const party = (quest?: Quest): PartyState => ({ version: 1, rng: 1, sheets: {}, ...(quest ? { quest } : {}) });
const turn = (quest: Quest, dungeon: DungeonState | null, fight: RulesTurn['fight'] = null): RulesTurn =>
  ({ party: party(quest), combat: null, dungeon, lines: [], success: null, fight, rolled: [], checks: [], dice: [] });

test('a fixed map: the goal is the path room the planned scenes reach, the way to it the shortest', () => {
  assert.equal(fixed(4).quest.at, 'r2', 'the door scene, two rooms on, the goal, then the epilogue: 4 scenes');
  assert.equal(fixed(3).quest.at, 'r1');
  assert.equal(fixed(2).quest.at, 'r1', 'never the entrance');
  assert.equal(fixed(5).quest.at, 'r3', 'a short map’s last room');
  assert.equal(fixed(6).quest.at, 'r4', 'a standard map’s');
  assert.equal(fixed(8).quest.at, 'r5', 'a delve has no more path than that');
});

test('the goal room holds the goal’s foes, a high fight, and the map knows it as its goal', () => {
  const { quest, dungeon } = fixed(4);
  const room = dungeon!.map.nodes[quest.at!];
  assert.deepEqual(room.contents!.encounter!.monsters, quest.foes);
  assert.equal(room.contents!.encounter!.difficulty, 'high');
  assert.equal(dungeon!.map.goal, quest.at);
  assert.deepEqual(fixed(4), fixed(4), 'the same seed, the same quest');
});

test('the goal is a challenge for the party: a high fight for its level, more for a stronger party', () => {
  const low = planQuest(7, [1, 1, 1, 1], 4, null).quest;
  const high = planQuest(7, [5, 5, 5, 5], 4, null).quest;
  assert.equal(low.xp > 0 && low.xp <= stockedBudget([1, 1, 1, 1], 'high'), true);
  assert.equal(high.xp <= stockedBudget([5, 5, 5, 5], 'high'), true);
  assert.ok(high.xp > low.xp * 4, `${high.xp} vs ${low.xp}`);
  const lone = planQuest(7, [1], 4, null).quest;
  assert.ok(lone.xp <= stockedBudget([1], 'moderate'), 'a lone hero at level 1 meets no more than a moderate fight');
});

test('the goal is led by a boss: the toughest kind of monster the budget affords, its band from what is left', () => {
  for (const [seed, lv] of [[7, [1, 1]], [42, [1, 1]], [1, [3, 3, 3, 3]], [99, [5]], [3, [2, 2, 2]]] as const) {
    const { foes, xp } = planQuest(seed, [...lv], 4, null).quest;
    const budget = stockedBudget(lv, 'high');
    const best = Math.max(...candidates(lv, undefined).map((m) => m.xp).filter((x) => x <= budget));
    assert.equal(monster(foes[0]).xp, best, `seed ${seed}: ${foes.join(', ')}`);
    assert.ok(xp <= budget);
  }
});

test('slay, recover or rescue: a recovered item is the goal room’s treasure', () => {
  const quests = Array.from({ length: 30 }, (_, seed) => fixed(4, seed));
  assert.deepEqual([...new Set(quests.map((q) => q.quest.kind))].sort(), ['recover', 'rescue', 'slay']);
  const recover = quests.find((q) => q.quest.kind === 'recover')!;
  assert.equal(recover.dungeon!.map.nodes[recover.quest.at!].contents!.treasure!.magicItem, recover.quest.target);
});

test('explore mode: no goal room yet; it is found after the planned way in', () => {
  const dungeon = startDungeon('explore', 42, levels, 4);
  const { quest } = planQuest(42, levels, 4, dungeon);
  assert.deepEqual([quest.at, quest.findAfter], [null, 2]);
  assert.equal(planQuest(42, levels, 2, dungeon).quest.findAfter, 1);
});

test('explore mode: the first room entered once the party is far enough in becomes the goal', () => {
  const dungeon = startDungeon('explore', 42, levels, 4);
  const { quest } = planQuest(42, levels, 4, dungeon);
  const room = { ...dungeon.map.nodes.e, id: 'e.x1', type: 'room' as const };
  const near = { ...dungeon, visited: ['e', 'e.x1'] };
  assert.equal(goalFound(quest, near, room).quest.at, null, 'one area in: too soon');
  const far = { ...dungeon, visited: ['e', 'e.x1', 'e.x1.x1'] };
  const passage = { ...room, type: 'passage' as const, contents: null };
  assert.equal(goalFound(quest, far, passage).quest.at, null, 'a passage is no goal');
  const found = goalFound(quest, far, room);
  assert.equal(found.quest.at, 'e.x1');
  assert.deepEqual(found.node.contents!.encounter!.monsters, quest.foes);
  assert.equal(found.dungeon.map.nodes['e.x1'], found.node);
  assert.equal(found.dungeon.map.goal, 'e.x1');
  assert.equal(goalFound(found.quest, far, { ...room, id: 'e.x2' }).quest.at, 'e.x1', 'found once');
});

test('a tale told: the goal has its foes and no room', () => {
  const { quest, dungeon } = planQuest(42, levels, 4, null);
  assert.deepEqual([quest.at, dungeon, quest.reached], [null, null, false]);
  assert.ok(quest.foes.length > 0);
});

test('the goal room dealt with (won, fled or talked down): the quest is reached', () => {
  const { quest, dungeon } = fixed(4);
  const open = questAfter(turn(quest, dungeon!));
  assert.equal(open.party.quest!.reached, false);
  const done = questAfter(turn(quest, { ...dungeon!, cleared: [...dungeon!.cleared, quest.at!] }));
  assert.equal(done.party.quest!.reached, true);
  assert.deepEqual(done.lines, [`The quest is done: ${goalText(quest)}.`]);
  assert.deepEqual(questAfter(done).lines, done.lines, 'said once');
});

test('a tale told: the goal’s fight is begun on the DM’s goal hook, and winning it, or the foes fleeing, reaches the goal', () => {
  const { quest } = planQuest(42, levels, 4, null);
  const heroes: PartyState = { ...party(quest), sheets: { p: SAMPLE } };
  const started = confrontGoal({ party: heroes, combat: null, dungeon: null });
  assert.equal(started.fight, 'started');
  assert.equal(started.party.quest!.fighting, true);
  assert.deepEqual(Object.values(started.combat!.combatants).filter((c) => c.side === 'foes').length, quest.foes.length);
  const fighting = { ...quest, fighting: true as const };
  assert.equal(questAfter(turn(fighting, null, 'victory')).party.quest!.reached, true);
  assert.equal(questAfter(turn(fighting, null, 'fled')).party.quest!.reached, true);
  const lost = questAfter(turn(fighting, null, 'defeat')).party.quest!;
  assert.deepEqual([lost.reached, lost.fighting], [false, undefined]);
});

test('the goal hook outside a tale told, or once the quest is done, changes nothing', () => {
  const { quest, dungeon } = fixed(4);
  const s = { party: party(quest), combat: null, dungeon };
  assert.deepEqual(confrontGoal(s).lines, ['The quest’s goal is in the dungeon, not here.']);
  const tale = planQuest(42, levels, 4, null).quest;
  assert.deepEqual(confrontGoal({ party: party({ ...tale, reached: true }), combat: null, dungeon: null }).lines, ['The quest is already done.']);
});

test('overtime: as many scenes again as planned while the goal is open; none once reached or the ending called', () => {
  const { quest } = fixed(4);
  assert.equal(overtime(quest), 4);
  assert.equal(overtime({ ...quest, reached: true }), 0);
  assert.equal(overtime({ ...quest, called: true }), 0);
  assert.equal(overtime(undefined), 0);
});

test('the goal said plainly', () => {
  const base = { foes: ['owlbear', 'wolf', 'wolf'], at: null, planned: 4, xp: 0, reached: false };
  assert.equal(goalText({ ...base, kind: 'slay', target: 'Owlbear' }), 'Slay or drive off the Owlbear and its band (Owlbear, Wolf ×2)');
  assert.equal(goalText({ ...base, kind: 'slay', target: 'Owlbear', foes: ['owlbear'] }), 'Slay or drive off the Owlbear');
  assert.equal(goalText({ ...base, kind: 'recover', target: 'Wand of Magic Missiles' }), 'Recover the Wand of Magic Missiles from its keepers (Owlbear, Wolf ×2)');
  assert.equal(goalText({ ...base, kind: 'rescue', target: 'a captured merchant' }), 'Rescue a captured merchant from the captors (Owlbear, Wolf ×2)');
});


test('the quest as the table sees it: the goal, where it lies, and whether it is done', () => {
  const { quest, dungeon } = fixed(4);
  const s = { party: party(quest), combat: null, dungeon };
  assert.deepEqual(questView(s), { kind: quest.kind, goal: goalText(quest), reached: false, where: `in the ${dungeon!.map.nodes[quest.at!].purpose!.toLowerCase()}` });
  const explore = startDungeon('explore', 42, levels, 4);
  const lost = planQuest(42, levels, 4, explore);
  assert.equal(questView({ party: party(lost.quest), combat: null, dungeon: lost.dungeon })!.where, 'deeper in the dungeon');
  const tale = planQuest(42, levels, 4, null).quest;
  assert.deepEqual(questView({ party: party({ ...tale, reached: true }), combat: null, dungeon: null }), { kind: tale.kind, goal: goalText(tale), reached: true, where: null });
  assert.equal(questView({ party: party(), combat: null, dungeon: null }), null, 'no quest: a game with no set length');
});

test('a tale told past its plan: the first choice becomes the goal, so the party can always reach it', () => {
  const quest = planQuest(42, levels, 4, null).quest;
  const s = { party: party(quest), combat: null, dungeon: null };
  const dm: StoredChoice[] = [{ id: 'a', label: 'Rest', detail: 'Camp.' }, { id: 'b', label: 'Wander', detail: 'On.' }];
  assert.equal(towardTheGoal(dm, s, 4, 6), dm, 'within the plan: the DM’s choices');
  const pressed = towardTheGoal(dm, s, 5, 6);
  assert.deepEqual(pressed[0], { id: 'a', label: 'Face the goal', detail: `${goalText(quest)}.`, hook: { kind: 'goal' }, rules: 'The quest’s goal: face its foes' });
  assert.deepEqual(pressed.slice(1), dm.slice(1));
  const offered: StoredChoice[] = [{ ...dm[0], hook: { kind: 'goal' } }, dm[1]];
  assert.equal(towardTheGoal(offered, s, 5, 6), offered, 'the DM already offers it');
  assert.equal(towardTheGoal(dm, { ...s, party: party({ ...quest, reached: true }) }, 5, 6), dm, 'reached');
  const inDungeon = fixed(4);
  assert.equal(towardTheGoal(dm, { party: party(inDungeon.quest), combat: null, dungeon: inDungeon.dungeon }, 5, 6), dm, 'a dungeon’s goal is walked to');
  assert.equal(towardTheGoal(dm, { party: party(), combat: null, dungeon: null }, 5, 6), dm, 'no quest');
});

test('the ending called, by the host or the cap: the quest is closed, the count no longer a plan', () => {
  const { quest } = fixed(4);
  assert.deepEqual(questClosed(party(quest)).quest, { ...quest, called: true });
  const done = party({ ...quest, reached: true });
  assert.equal(questClosed(done), done);
  assert.equal(questClosed(party()).quest, undefined);
});
