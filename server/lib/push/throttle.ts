/**
 * How often a player may be pushed, as a pure rule (docs/push.md). Nothing here sends anything.
 *
 * Three limits hold together, per player:
 *  - at most 2 pushes in any minute;
 *  - at most 5 in any ten minutes;
 *  - a gap after each push that doubles while the player stays away: 30 s after the first they have not
 *    answered, then 1, 2, 4, 8 minutes and so on, up to six hours. Coming back to the app ends it.
 * Left alone, the gap alone gives pushes at 0:00, 0:30, 1:30, 3:30 and 7:30: two in the first minute and
 * five in the first ten, which is exactly the two caps. The caps still hold when the player comes and goes.
 *
 * What cannot go yet waits as a pending push, one per subject (the player's turn in a game, that game's
 * chat, an invitation), newest content kept. A turn, a combat round or an invitation takes the next
 * opening. Chat only goes when it leaves room for those: never the last push of a minute or of ten
 * minutes, and never to a player who already has three unanswered.
 */

export type PushKind = 'combat' | 'turn' | 'invite' | 'chat';

export interface Pending {
  /** One per subject: "turn:ABCDEF" (a scene or a combat round), "chat:ABCDEF", "invite:ABCDEF". */
  key: string;
  kind: PushKind;
  /** The game it is about. */
  code: string;
  title: string;
  body: string;
  /** Not before this (epoch ms): a moment's grace lets a player who is looking at the game cancel it. */
  dueAt: number;
  createdAt: number;
  /** Chat only: how many messages this stands for. */
  count: number;
}

export interface PushState {
  /** When pushes went out (epoch ms), oldest first: the last ten minutes' worth, and always the latest. */
  sent: number[];
  /** Pushes since the player was last seen in the app. */
  unanswered: number;
  pending: Pending[];
}

export const EMPTY: PushState = { sent: [], unanswered: 0, pending: [] };

export const LIMITS = {
  perMinute: 2,
  perTenMinutes: 5,
  /** The gap after the first unanswered push; it doubles with each one after. */
  firstGapMs: 30_000,
  longestGapMs: 6 * 60 * 60_000,
  /** A player with this many unanswered pushes gets no chat pushes. */
  chatUnansweredLimit: 3,
} as const;

const MINUTE = 60_000;
const TEN_MINUTES = 10 * MINUTE;

/** How long a pending push is worth sending. */
const SHELF_LIFE: Record<PushKind, number> = { combat: 6 * 60 * MINUTE, turn: 6 * 60 * MINUTE, invite: 24 * 60 * MINUTE, chat: 30 * MINUTE };
/** Who goes first when several wait. */
const RANK: Record<PushKind, number> = { combat: 0, turn: 1, invite: 2, chat: 3 };

/** The gap owed after the last push: nothing once the player has been back, else doubling with each unanswered push. */
export function gapAfter(unanswered: number): number {
  if (unanswered <= 0) return 0;
  return Math.min(LIMITS.longestGapMs, LIMITS.firstGapMs * 2 ** Math.min(unanswered - 1, 30));
}

/** When the window of `size` pushes in `span` next has room, leaving `spare` of it free; 0 when it has now. */
function windowOpensAt(sent: readonly number[], now: number, span: number, size: number, spare = 0): number {
  const recent = sent.filter((t) => t > now - span);
  const room = size - spare;
  return recent.length < room ? 0 : recent[recent.length - room] + span;
}

/** The earliest moment a turn, a combat round or an invitation may be pushed. */
export function nextAllowedAt(state: PushState, now: number): number {
  const last = state.sent.at(-1);
  return Math.max(
    now,
    last === undefined ? 0 : last + gapAfter(state.unanswered),
    windowOpensAt(state.sent, now, MINUTE, LIMITS.perMinute),
    windowOpensAt(state.sent, now, TEN_MINUTES, LIMITS.perTenMinutes),
  );
}

/** The earliest moment chat may be pushed: as above, and one push of each window is kept for a turn. Null while the player has too many unanswered. */
export function chatAllowedAt(state: PushState, now: number): number | null {
  if (state.unanswered >= LIMITS.chatUnansweredLimit) return null;
  return Math.max(
    nextAllowedAt(state, now),
    windowOpensAt(state.sent, now, MINUTE, LIMITS.perMinute, 1),
    windowOpensAt(state.sent, now, TEN_MINUTES, LIMITS.perTenMinutes, 1),
  );
}

/** Adds a pending push, in place of one on the same subject. Chat keeps count of what it replaces. */
export function withPending(state: PushState, push: Pending): PushState {
  const old = state.pending.find((p) => p.key === push.key);
  const next = old && push.kind === 'chat' ? { ...push, count: old.count + push.count, createdAt: old.createdAt, dueAt: Math.min(old.dueAt, push.dueAt) } : push;
  return { ...state, pending: [...state.pending.filter((p) => p.key !== push.key), next] };
}

/** Drops what waits about a game: all of it, or only the given kinds. */
export function without(state: PushState, code: string, kinds?: readonly PushKind[]): PushState {
  return { ...state, pending: state.pending.filter((p) => p.code !== code || (kinds !== undefined && !kinds.includes(p.kind))) };
}

/** The player is looking at this game: nothing about it need be pushed, and nothing is unanswered. */
export function seen(state: PushState, code: string): PushState {
  return { ...without(state, code, ['combat', 'turn', 'chat']), unanswered: 0 };
}

/** True when a visit by the player would change the state: something is unanswered or waiting. */
export const dirty = (state: PushState): boolean => state.unanswered > 0 || state.pending.length > 0;

/** "Corin: Are we going in?" → "… (and 2 more messages)". */
export function bodyOf(push: Pending): string {
  if (push.kind !== 'chat' || push.count <= 1) return push.body;
  const more = push.count - 1;
  return `${push.body} (and ${more} more message${more === 1 ? '' : 's'})`;
}

export interface Step {
  state: PushState;
  /** The push to send now, already counted in `state`. */
  send: Pending | null;
  /** When to look again for what still waits; null when nothing does, or nothing can until the player returns. */
  wakeAt: number | null;
}

/** One look at a player's pending pushes: stale ones go, and at most one is sent. */
export function step(state: PushState, now: number): Step {
  const fresh = state.pending.filter((p) => now - p.createdAt < SHELF_LIFE[p.kind]);
  // The last push is kept however old it is: a long gap is measured from it.
  const kept: PushState = { sent: state.sent.filter((t, i) => t > now - TEN_MINUTES || i === state.sent.length - 1), unanswered: state.unanswered, pending: fresh };
  const opensAt = (p: Pending): number | null => {
    const allowed = p.kind === 'chat' ? chatAllowedAt(kept, now) : nextAllowedAt(kept, now);
    return allowed === null ? null : Math.max(allowed, p.dueAt);
  };
  const ready = fresh
    .filter((p) => { const at = opensAt(p); return at !== null && at <= now; })
    .sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.createdAt - b.createdAt);
  const send = ready[0] ?? null;
  const after: PushState = send
    ? { sent: [...kept.sent, now], unanswered: kept.unanswered + 1, pending: fresh.filter((p) => p !== send) }
    : kept;
  const waits = after.pending
    .map((p) => {
      const allowed = p.kind === 'chat' ? chatAllowedAt(after, now) : nextAllowedAt(after, now);
      return allowed === null ? null : Math.max(allowed, p.dueAt);
    })
    .filter((t): t is number => t !== null);
  return { state: after, send, wakeAt: waits.length ? Math.min(...waits) : null };
}
