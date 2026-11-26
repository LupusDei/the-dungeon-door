import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pick, scriptedRng, seededRng } from './rng.ts';

const faces = (rng: { die(s: number): number }, sides: number, n: number) => Array.from({ length: n }, () => rng.die(sides));

test('a seeded rng gives the same rolls for the same seed', () => {
  assert.deepEqual(faces(seededRng(42), 20, 8), faces(seededRng(42), 20, 8));
});

test('a seeded rng gives different rolls for different seeds', () => {
  assert.notDeepEqual(faces(seededRng(1), 20, 8), faces(seededRng(2), 20, 8));
});

test('seeded rolls are pinned, so a stored game replays the same dice after an upgrade', () => {
  assert.deepEqual(faces(seededRng(42), 20, 8), [13, 9, 18, 14, 4, 11, 6, 13]);
});

test('every face of a die comes up and nothing outside it does', () => {
  const rng = seededRng(7);
  const seen = new Set(faces(rng, 6, 600));
  assert.deepEqual([...seen].sort(), [1, 2, 3, 4, 5, 6]);
});

test('an rng resumed from its state continues exactly where it left off', () => {
  const rng = seededRng(99);
  faces(rng, 20, 5);
  const resumed = seededRng(rng.state());
  assert.deepEqual(faces(resumed, 20, 5), faces(rng, 20, 5));
});

test('the state of a fresh rng is its seed, as an unsigned 32-bit number', () => {
  assert.equal(seededRng(5).state(), 5);
  assert.equal(seededRng(-1).state(), 4294967295);
});

test('a scripted rng replays its faces in order', () => {
  const rng = scriptedRng([20, 1, 7]);
  assert.deepEqual(faces(rng, 20, 3), [20, 1, 7]);
});

test('a scripted rng refuses a face its die does not have', () => {
  assert.throws(() => scriptedRng([7]).die(6), /7 is not a face of a d6/);
  assert.throws(() => scriptedRng([0]).die(6), /0 is not a face of a d6/);
});

test('a scripted rng that runs out says so', () => {
  const rng = scriptedRng([3]);
  rng.die(6);
  assert.throws(() => rng.die(6), /out of scripted dice/);
});

test('a scripted rng reports how many faces it has used as its state', () => {
  const rng = scriptedRng([3, 4]);
  rng.die(6);
  assert.equal(rng.state(), 1);
});

test('pick takes the element the die points at', () => {
  assert.equal(pick(scriptedRng([1]), ['a', 'b', 'c']), 'a');
  assert.equal(pick(scriptedRng([3]), ['a', 'b', 'c']), 'c');
});
