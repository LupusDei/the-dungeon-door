import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TURN_SECONDS, turnWindow } from './turn-clock.ts';

const scene = { createdAt: '2026-11-27T00:00:00.000Z', isFinale: false };
const now = new Date('2026-11-27T00:00:10.000Z');

test('choosing opens a 90 second window from when the scene began', () => {
  assert.equal(TURN_SECONDS, 90);
  const window = turnWindow('voting', scene, now);
  assert.ok(window);
  assert.equal(window.seconds, 90);
  assert.equal(window.deadline, '2026-11-27T00:01:30.000Z');
  assert.equal(window.now, '2026-11-27T00:00:10.000Z');
});

test('a deadline already past is still reported: the window does not close itself', () => {
  const later = new Date('2026-11-27T00:02:00.000Z');
  const window = turnWindow('voting', scene, later);
  assert.ok(window);
  assert.ok(Date.parse(window.deadline) < later.getTime());
  assert.equal(window.seconds, 90);
});

test('there is no window unless the table is choosing a scene', () => {
  for (const status of ['lobby', 'preparing', 'resolving', 'ended'] as const) {
    assert.equal(turnWindow(status, scene, now), null, status);
  }
  assert.equal(turnWindow('voting', null, now), null);
  assert.equal(turnWindow('voting', { ...scene, isFinale: true }, now), null);
  assert.equal(turnWindow('voting', { createdAt: 'not-a-time', isFinale: false }, now), null);
});
