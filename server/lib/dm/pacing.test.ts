/** How the DM is told where a scene falls: the road's stretches apart from the tale's scenes. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adventureLength, isClimax, sceneHeading, sceneLabel } from './pacing.ts';

const road = { sceneIndex: 1, sceneCount: 6, progress: { part: 'road' as const, scene: 2, of: 2, tale: 4 } };
const tale = (scene: number, of = 4) => ({ sceneIndex: scene + 1, sceneCount: of + 2, progress: { part: 'tale' as const, scene, of } });
const old = (sceneIndex: number) => ({ sceneIndex, sceneCount: 4 });

test('on the road: the stretch, and the tale’s scenes still to come', () => {
  assert.equal(sceneLabel(road), 'stretch 2 of 2 of the road from the tavern; the tale’s 4 scenes follow');
  assert.equal(adventureLength(road), 'The adventure opens on the road from the tavern (a scene for each stretch of it); then the tale has 4 scenes: an opening, middle scenes, and a final epilogue scene.');
  assert.equal(isClimax(road), false);
});

test('in the tale: scenes counted from the tale’s first, the climax the one before the epilogue', () => {
  assert.equal(sceneLabel(tale(1)), 'scene 1 of 4');
  assert.equal(adventureLength(tale(1)), 'After the road from the tavern, the tale has 4 scenes: an opening, middle scenes, and a final epilogue scene.');
  assert.deepEqual([1, 2, 3, 4].map((n) => isClimax(tale(n))), [false, false, true, false]);
});

test('a game told nothing of the road counts every scene', () => {
  assert.equal(sceneLabel(old(0)), 'scene 1 of 4');
  assert.equal(adventureLength(old(0)), 'The adventure has 4 scenes: an opening, middle scenes, and a final epilogue scene.');
  assert.equal(adventureLength({ ...old(0), progress: { part: 'tale', scene: 1, of: 4 } }), 'The adventure has 4 scenes: an opening, middle scenes, and a final epilogue scene.', 'a game from before the road');
  assert.deepEqual([0, 1, 2, 3].map((i) => isClimax(old(i))), [false, false, true, false]);
});

test('a scene’s heading: on the road, or the tale’s scene number', () => {
  assert.deepEqual([sceneHeading(road), sceneHeading(tale(1)), sceneHeading(old(2))], ['On the road', 'Scene 1', 'Scene 3']);
});

test('no set length: no count, no climax, the story goes on until the table calls the ending', () => {
  const open = { sceneIndex: 3, sceneCount: 100_000, openEnded: true, progress: { part: 'tale' as const, scene: 2, of: null } };
  const walking = { sceneIndex: 0, sceneCount: 100_000, openEnded: true, progress: { part: 'road' as const, scene: 1, of: 2, tale: null } };
  assert.equal(sceneLabel(open), 'scene 2; the adventure has no set length, so the story goes on');
  assert.equal(sceneLabel(walking), 'stretch 1 of 2 of the road from the tavern; the tale follows, with no set length');
  assert.match(adventureLength(open), /^The adventure has no set number of scenes: an opening, then as many scenes as the table plays/);
  assert.equal(isClimax(open), false);
  assert.equal(sceneHeading(open), 'Scene 2');
});

test('with the quest open the tale has about so many scenes; past them the DM steers to the goal', () => {
  const about = (scene: number) => ({ sceneIndex: scene + 1, sceneCount: 6, progress: { part: 'tale' as const, scene, of: 4, about: true as const } });
  assert.equal(sceneLabel(about(2)), 'scene 2 of about 4');
  assert.equal(sceneLabel(about(4)), 'scene 4 of about 4, past the plan: steer the party to the quest’s goal');
  assert.equal(sceneLabel(about(6)), 'scene 6 of about 4, past the plan: steer the party to the quest’s goal');
  assert.equal(adventureLength(about(1)), 'After the road from the tavern, the tale has about 4 scenes: an opening, middle scenes, and a final epilogue scene. It goes on past them until the quest’s goal is reached.');
  assert.deepEqual([3, 5].map((n) => isClimax(about(n))), [true, false]);
});
