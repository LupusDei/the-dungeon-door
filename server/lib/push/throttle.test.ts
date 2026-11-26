import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bodyOf, chatAllowedAt, dirty, EMPTY, gapAfter, nextAllowedAt, type Pending, type PushKind, type PushState, seen, step, withPending, without } from './throttle.ts';

const S = 1000;
const MIN = 60 * S;
const T0 = 1_800_000_000_000;

const push = (kind: PushKind, at: number, code = 'ABCDEF', extra: Partial<Pending> = {}): Pending => ({
  key: `${kind === 'combat' ? 'turn' : kind}:${code}`, kind, code, title: 'The Sunken Crypt', body: kind === 'chat' ? 'Corin: Are we going in?' : 'Your choice awaits.',
  dueAt: at, createdAt: at, count: 1, ...extra,
});

/** A player who never comes back, offered a new turn push whenever the last one has gone: when each is sent. */
function unansweredTimes(count: number, until: number): number[] {
  let state: PushState = EMPTY;
  const times: number[] = [];
  let now = T0;
  while (times.length < count && now <= T0 + until) {
    state = withPending(state, push('turn', now));
    const stepped = step(state, now);
    state = stepped.state;
    if (stepped.send) times.push(now - T0);
    now = stepped.send ? now + S : Math.max(now + S, stepped.wakeAt ?? now + S);
  }
  return times;
}

test('the gap doubles with each unanswered push, and is nothing once the player has been back', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(gapAfter), [0, 30 * S, MIN, 2 * MIN, 4 * MIN, 8 * MIN, 16 * MIN]);
  assert.equal(gapAfter(40), 6 * 60 * MIN, 'never longer than six hours');
});

test('a player who stays away is pushed at 0:00, 0:30, 1:30, 3:30, 7:30, then 15:30, 31:30…', () => {
  assert.deepEqual(unansweredTimes(7, 40 * MIN), [0, 30 * S, 90 * S, 210 * S, 450 * S, 930 * S, 1890 * S]);
});

test('never more than 2 in a minute or 5 in ten minutes, however the player comes and goes', () => {
  // The player answers every push at once (no gap is owed), and a new turn is offered every second.
  let state: PushState = EMPTY;
  const times: number[] = [];
  for (let now = T0; now < T0 + 25 * MIN; now += S) {
    state = seen(state, 'ABCDEF');
    state = withPending(state, push('turn', now));
    const stepped = step(state, now);
    state = stepped.state;
    if (stepped.send) times.push(now);
  }
  for (const t of times) {
    assert.ok(times.filter((u) => u > t - MIN && u <= t).length <= 2, 'two a minute');
    assert.ok(times.filter((u) => u > t - 10 * MIN && u <= t).length <= 5, 'five in ten minutes');
  }
  assert.deepEqual(times.slice(0, 6).map((t) => (t - T0) / S), [0, 1, 60, 61, 120, 600], 'as fast as the caps allow');
});

test('a push waits out its grace, and a player who looks at the game cancels it', () => {
  const waiting = withPending(EMPTY, push('turn', T0 + 8 * S, 'ABCDEF', { createdAt: T0 }));
  const early = step(waiting, T0 + 2 * S);
  assert.equal(early.send, null);
  assert.equal(early.wakeAt, T0 + 8 * S);
  assert.equal(step(waiting, T0 + 8 * S).send?.key, 'turn:ABCDEF');
  const looked = seen(waiting, 'ABCDEF');
  assert.deepEqual(looked.pending, []);
  assert.equal(step(looked, T0 + 8 * S).send, null);
});

test('one pending push per subject: a newer turn replaces the older, chat counts what it stands for', () => {
  let state = withPending(EMPTY, push('turn', T0, 'ABCDEF', { body: 'Scene 2' }));
  state = withPending(state, push('combat', T0 + S, 'ABCDEF', { body: 'Round 1' }));
  assert.deepEqual(state.pending.map((p) => [p.kind, p.body]), [['combat', 'Round 1']]);
  state = withPending(state, push('chat', T0 + 2 * S, 'ABCDEF', { body: 'Corin: One' }));
  state = withPending(state, push('chat', T0 + 3 * S, 'ABCDEF', { body: 'Bryn: Two' }));
  state = withPending(state, push('chat', T0 + 4 * S, 'ABCDEF', { body: 'Corin: Three' }));
  const chat = state.pending.find((p) => p.kind === 'chat')!;
  assert.equal(chat.count, 3);
  assert.equal(bodyOf(chat), 'Corin: Three (and 2 more messages)');
  assert.equal(bodyOf({ ...chat, count: 2 }), 'Corin: Three (and 1 more message)');
  assert.equal(chat.dueAt, T0 + 2 * S, 'the first message set when it is due');
});

test('a combat round goes before a turn, an invitation before chat', () => {
  let state = withPending(EMPTY, push('chat', T0));
  state = withPending(state, push('invite', T0, 'QQQQQQ'));
  state = withPending(state, push('turn', T0, 'ZZZZZZ'));
  state = withPending(state, push('combat', T0 + S, 'ABCDEF'));
  const order: string[] = [];
  let now = T0 + S;
  for (let i = 0; i < 40 && state.pending.length; i++) {
    state = seen(state, 'NOGAME'); // the player keeps answering: only the caps hold things back
    const stepped = step(state, now);
    state = stepped.state;
    if (stepped.send) order.push(stepped.send.kind);
    now = Math.max(now + S, stepped.wakeAt ?? now + S);
  }
  assert.deepEqual(order, ['combat', 'turn', 'invite', 'chat']);
});

test('chat never takes the last push of a minute or of ten minutes', () => {
  const one: PushState = { sent: [T0], unanswered: 0, pending: [] };
  assert.equal(nextAllowedAt(one, T0 + S), T0 + S, 'a turn may go at once');
  assert.equal(chatAllowedAt(one, T0 + S), T0 + MIN, 'chat waits for the minute to clear');
  const four: PushState = { sent: [T0, T0 + 2 * MIN, T0 + 4 * MIN, T0 + 6 * MIN], unanswered: 0, pending: [] };
  assert.equal(nextAllowedAt(four, T0 + 8 * MIN), T0 + 8 * MIN);
  assert.equal(chatAllowedAt(four, T0 + 8 * MIN), T0 + 10 * MIN, 'the fifth of ten minutes is kept for a turn');
});

test('a player with three unanswered pushes gets no chat, but still gets their turn', () => {
  const ignored: PushState = { sent: [T0, T0 + 30 * S, T0 + 90 * S], unanswered: 3, pending: [] };
  assert.equal(chatAllowedAt(ignored, T0 + 20 * MIN), null);
  const both = withPending(withPending(ignored, push('chat', T0 + 20 * MIN)), push('turn', T0 + 20 * MIN));
  const stepped = step(both, T0 + 20 * MIN);
  assert.equal(stepped.send?.kind, 'turn');
  assert.equal(stepped.wakeAt, null, 'the chat waits for the player, not for the clock');
  assert.equal(step(seen(stepped.state, 'OTHER1'), T0 + 31 * MIN).send?.kind, 'chat', 'and goes once they have been back');
});

test('stale pushes are dropped: chat after half an hour, a turn after six hours', () => {
  const old = withPending(withPending(EMPTY, push('chat', T0)), push('turn', T0));
  const blocked: PushState = { ...old, sent: [T0 - S, T0], unanswered: 9 };
  const later = step(blocked, T0 + 31 * MIN);
  assert.deepEqual(later.state.pending.map((p) => p.kind), ['turn']);
  assert.equal(later.send, null, 'the gap after nine unanswered pushes is over two hours, measured from the last push');
  assert.deepEqual(later.state.sent, [T0], 'which is kept though it is older than ten minutes');
  assert.deepEqual(step(blocked, T0 + 6 * 60 * MIN).state.pending, []);
});

test('without() drops what waits about one game; dirty() says whether a visit would change anything', () => {
  const state = withPending(withPending(withPending(EMPTY, push('turn', T0)), push('chat', T0)), push('invite', T0, 'QQQQQQ'));
  assert.deepEqual(without(state, 'ABCDEF').pending.map((p) => p.key), ['invite:QQQQQQ']);
  assert.deepEqual(without(state, 'ABCDEF', ['chat']).pending.map((p) => p.key), ['turn:ABCDEF', 'invite:QQQQQQ']);
  assert.equal(dirty(EMPTY), false);
  assert.equal(dirty(state), true);
  assert.equal(dirty({ ...EMPTY, unanswered: 1 }), true);
  assert.deepEqual(seen({ ...state, unanswered: 4 }, 'ABCDEF'), { sent: [], unanswered: 0, pending: [state.pending[2]] }, 'an invitation to another game still waits');
});
