/** Where a scene falls: the road from the tavern counted apart from the tale (the dungeon's or the one told). */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { markRoadEnd, sceneProgress } from './progress.ts';
import type { PartyState } from './state.ts';
import { NO_SET_LENGTH } from '../length.ts';
import { planTrek } from './trek.ts';

const onLeg = (leg: number) => ({ trek: { ...planTrek(7, [1, 1], 1, 'door'), leg } });
const party = (fields: Partial<PartyState> = {}): PartyState => ({ version: 1, rng: 1, sheets: {}, ...fields });

test('on the road: the stretch of it, and the tale still all to come', () => {
  assert.deepEqual(sceneProgress(onLeg(0), 0, 6), { part: 'road', scene: 1, of: 2, tale: 4 });
  assert.deepEqual(sceneProgress(onLeg(1), 1, 6), { part: 'road', scene: 2, of: 2, tale: 4 });
});

test('a fight on the road adds its rounds to the road, not to the tale', () => {
  assert.deepEqual(sceneProgress(onLeg(0), 1, 7), { part: 'road', scene: 1, of: 2, tale: 4 }, 'a round: one scene more');
  assert.deepEqual(sceneProgress(onLeg(0), 2, 8), { part: 'road', scene: 1, of: 2, tale: 4 }, 'two rounds');
  assert.deepEqual(sceneProgress({ roadScenes: 3 }, 3, 7), { part: 'tale', scene: 1, of: 4 });
});

test('after the road the tale is counted from its own first scene', () => {
  assert.deepEqual(sceneProgress({ roadScenes: 2 }, 2, 6), { part: 'tale', scene: 1, of: 4 });
  assert.deepEqual(sceneProgress({ roadScenes: 2 }, 5, 6), { part: 'tale', scene: 4, of: 4 });
});

test('a game with no road, or no rules, counts every scene', () => {
  assert.deepEqual(sceneProgress({}, 0, 4), { part: 'tale', scene: 1, of: 4 });
  assert.deepEqual(sceneProgress(null, 3, 4), { part: 'tale', scene: 4, of: 4 });
});

test('a party lost on the road: the epilogue is the tale’s one scene', () => {
  assert.deepEqual(sceneProgress(onLeg(0), 2, 3), { part: 'tale', scene: 1, of: 1 });
});

test('the road ends: the next scene is where the tale begins', () => {
  const walking = party(onLeg(1));
  assert.equal(markRoadEnd(walking, party(), 2).roadScenes, 2);
  assert.equal(markRoadEnd(walking, party(), 3).roadScenes, 3, 'after a fight on the road');
});

test('still on the road, or long past it: nothing changes', () => {
  const walking = party(onLeg(0));
  const still = party(onLeg(1));
  assert.equal(markRoadEnd(walking, still, 1), still);
  const past = party({ roadScenes: 2 });
  assert.equal(markRoadEnd(past, past, 4), past);
});

test('no set length: the stretches and the scene, with nothing to count them against', () => {
  assert.deepEqual(sceneProgress(onLeg(0), 0, NO_SET_LENGTH), { part: 'road', scene: 1, of: 2, tale: null });
  assert.deepEqual(sceneProgress({ roadScenes: 2 }, 9, NO_SET_LENGTH + 3), { part: 'tale', scene: 8, of: null });
});

test('the ending called on the road: the tale is its epilogue', () => {
  assert.deepEqual(sceneProgress(onLeg(0), 0, 2), { part: 'road', scene: 1, of: 2, tale: 1 });
});

const QUEST = { kind: 'slay' as const, target: 'Ogre', foes: ['ogre'], xp: 450, at: null, planned: 4, reached: false };

test('with the quest open the tale’s length is about so many scenes, and goes past it until the goal is reached', () => {
  const open = { roadScenes: 2, quest: QUEST };
  assert.deepEqual(sceneProgress(open, 2, 6), { part: 'tale', scene: 1, of: 4, about: true });
  assert.deepEqual(sceneProgress(open, 7, 6), { part: 'tale', scene: 6, of: 4, about: true }, 'past the plan');
  assert.deepEqual(sceneProgress({ ...onLeg(0), quest: QUEST }, 0, 6), { part: 'road', scene: 1, of: 2, tale: 4 }, 'the road is counted as it was');
});

test('the epilogue, or the goal reached, or the ending called: the count is the count', () => {
  assert.deepEqual(sceneProgress({ roadScenes: 2, quest: { ...QUEST, called: true } }, 7, 8), { part: 'tale', scene: 6, of: 6 }, 'the epilogue at the cap');
  assert.deepEqual(sceneProgress({ roadScenes: 2, quest: { ...QUEST, reached: true } }, 3, 6), { part: 'tale', scene: 2, of: 4 });
  assert.deepEqual(sceneProgress({ roadScenes: 2, quest: { ...QUEST, called: true } }, 3, 6), { part: 'tale', scene: 2, of: 4 });
});
