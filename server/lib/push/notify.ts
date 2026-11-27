/**
 * The push service: what a game event tells whom, and getting it to their devices within the limits
 * (throttle.ts). See docs/push.md.
 *
 * An event makes a pending push for each player it concerns who has a device. A push about a game waits a
 * few seconds first: a player who is looking at that game fetches it every two seconds, and that fetch
 * cancels the push (and tells the service the player is back). What may not go yet stays pending and goes at
 * the next opening, while this request's background time lasts or when the game next stirs.
 *
 * Nothing here may break a game: every entry point runs in the background and swallows its errors.
 */
import { runInBackground } from '../background.ts';
import { canSee } from '../chat.ts';
import { canAct } from '../play/your-turn.ts';
import { getStore } from '../store/index.ts';
import type { Game, Message, StoredScene } from '../types.ts';
import { getSender, type PushMessage } from './apns.ts';
import { getPushStore } from './store.ts';
import { bodyOf, dirty, type Pending, type PushKind, type PushState, seen, step, withPending, without } from './throttle.ts';

/** How long a push about a game waits for a player who is looking at it to cancel it. */
export const GRACE_MS = 8_000;
/** How long a delivery waits in the background for the next opening before leaving it to a later event. */
const WATCH_MS = 150_000;
/** A visit is noted at most this often per player and game (per server instance). */
const VISIT_EVERY_MS = 5_000;
/** The rest of a party's waiting pushes are looked at again at most this often per game (per server instance). */
const STIR_EVERY_MS = 30_000;

export interface PushClock { now(): number; sleep(ms: number): Promise<void> }
const REAL_CLOCK: PushClock = { now: () => Date.now(), sleep: (ms) => new Promise((done) => setTimeout(done, ms)) };
let clock = REAL_CLOCK;

/** Tests: replace (or with no argument, reset) the clock, and forget noted visits. */
export function setPushClock(next: PushClock = REAL_CLOCK): void {
  clock = next;
  visits.clear();
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** Changes a player's push state, retrying if someone else changed it first. `change` returns null to leave it. */
async function update(playerId: string, change: (state: PushState) => PushState | null): Promise<void> {
  const store = getPushStore();
  for (let attempt = 0; attempt < 6; attempt++) {
    const held = await store.getState(playerId);
    const next = change(held.state);
    if (next === null || (await store.putState(playerId, held.version, next))) return;
  }
  console.error(`push state for ${playerId} would not settle`);
}

/**
 * Sends what is due for a player, one push at a time as the limits allow, waiting here for openings that
 * are close. Safe to run more than once at a time: only one of them wins each push.
 */
export async function deliver(playerId: string): Promise<void> {
  const store = getPushStore();
  for (let turn = 0; turn < 20; turn++) {
    const held = await store.getState(playerId);
    const now = clock.now();
    const stepped = step(held.state, now);
    const changed = stepped.send !== null || stepped.state.pending.length !== held.state.pending.length;
    if (changed && !(await store.putState(playerId, held.version, stepped.state))) continue; // someone else moved first: look again
    if (stepped.send) await send(playerId, stepped.send);
    if (stepped.wakeAt === null) return;
    const wait = stepped.wakeAt - clock.now();
    if (wait > WATCH_MS) return;
    if (wait > 0) await clock.sleep(wait);
  }
}

async function send(playerId: string, push: Pending): Promise<void> {
  const store = getPushStore();
  const devices = await store.listDevices(playerId);
  if (devices.length === 0) return;
  const message: PushMessage = { kind: push.kind, code: push.code, title: push.title, body: bodyOf(push) };
  const results = await getSender().send(devices, message);
  await Promise.all(devices.filter((_, i) => results[i] === 'gone').map((d) => store.removeDevice(d.token)));
}

interface Notice { kind: PushKind; code: string; title: string; body: string; grace: boolean }

/** Queues a push for a player who has a device, and starts its delivery. */
async function notify(playerId: string, notice: Notice): Promise<void> {
  if ((await getPushStore().listDevices(playerId)).length === 0) return;
  const now = clock.now();
  const subject = notice.kind === 'combat' ? 'turn' : notice.kind;
  const push: Pending = {
    key: `${subject}:${notice.code}`, kind: notice.kind, code: notice.code, title: notice.title, body: notice.body,
    dueAt: notice.grace ? now + GRACE_MS : now, createdAt: now, count: 1,
  };
  await update(playerId, (state) => withPending(state, push));
  await deliver(playerId);
}

const inBackground = (label: string, task: () => Promise<void>) => runInBackground(`push: ${label}`, task);

const titleOf = (game: Pick<Game, 'title' | 'code'>) => game.title ?? `Party ${game.code}`;
const heroOf = (game: Game, playerId: string) => game.players.find((p) => p.playerId === playerId)?.character.name ?? 'your hero';

/** "Zombie, Giant Rat ×2": the foes still standing, in initiative order. */
function standingFoes(game: Game): string {
  const names = (game.combat?.order ?? []).map((id) => game.combat!.combatants[id]).filter((c) => c.side === 'foes' && c.status === 'up').map((c) => c.name.replace(/ \d+$/, ''));
  return [...new Set(names)].map((name) => { const n = names.filter((x) => x === name).length; return n > 1 ? `${name} ×${n}` : name; }).join(', ');
}

/** What a new scene tells one player. Null when there is nothing for them to do in it. */
export function sceneNotice(game: Game, scene: StoredScene, playerId: string): Notice | null {
  if (scene.isFinale || scene.choices.length === 0) return null;
  const hero = heroOf(game, playerId);
  if (game.combat) {
    if (!canAct(game.combat, playerId)) return null; // a fallen hero has no action to choose
    const foes = standingFoes(game);
    return { kind: 'combat', code: game.code, title: titleOf(game), body: clip(`Round ${game.combat.round}: ${hero}, choose your action.${foes ? ` Facing ${foes}.` : ''}`, 170), grace: true };
  }
  const opening = scene.index === 0 ? 'The adventure begins: ' : '';
  return { kind: 'turn', code: game.code, title: titleOf(game), body: clip(`${opening}${scene.title}. What will ${hero} do?`, 170), grace: true };
}

/** A scene is ready for votes: every player with something to do in it hears, unless they are looking. */
export function pushSceneReady(code: string): void {
  inBackground(`scene ${code}`, async () => {
    const game = await getStore().getGame(code);
    const scene = game?.scenes.find((s) => s.index === game.sceneIndex);
    if (!game || !scene || game.status !== 'voting') return;
    await Promise.all(game.players.map(async ({ playerId }) => {
      const notice = sceneNotice(game, scene, playerId);
      if (notice) await notify(playerId, notice);
      // A player with no turn in this round has none left over from the last one either.
      else await update(playerId, (state) => (state.pending.some((p) => p.code === code && p.kind !== 'chat') ? without(state, code, ['turn', 'combat']) : null));
    }));
  });
}

/** A player spoke: the rest of the party hears, unless they are looking. A whisper reaches only who it names. */
export function pushChat(game: Game, message: Message): void {
  if (message.kind !== 'chat' || !message.playerId) return;
  const hearers = game.players.filter((p) => p.playerId !== message.playerId && canSee(message, p.playerId));
  const name = message.characterName ?? 'Someone';
  const body = message.whisperTo?.length
    ? clip(`${name} whispers: ${message.text}`, 170)
    : message.emote
      ? clip(`*${name} ${message.text}*`, 170)
      : clip(`${name}: ${message.text}`, 170);
  inBackground(`chat ${game.code}`, async () => {
    await Promise.all(hearers.map((p) => notify(p.playerId, { kind: 'chat', code: game.code, title: titleOf(game), body, grace: true })));
  });
}

/** An invitation to a party in its lobby. No grace: the home screen does not watch for these. */
export function pushInvite(code: string, toPlayerId: string, fromName: string): void {
  inBackground(`invite ${code}`, () => notify(toPlayerId, {
    kind: 'invite', code, title: 'An invitation', body: clip(`${fromName} invites you to a new adventure. Door code ${code}.`, 170), grace: false,
  }));
}

/** The game is over, or these players left it: nothing more about it is pushed to them. */
export function pushForget(code: string, playerIds: readonly string[]): void {
  if (playerIds.length === 0) return;
  inBackground(`forget ${code}`, async () => {
    await Promise.all(playerIds.map((id) => update(id, (state) => (state.pending.some((p) => p.code === code) ? without(state, code) : null))));
  });
}

const visits = new Map<string, number>();

/** True at most once per `every` ms for this key (per server instance). */
function due(key: string, every: number): boolean {
  const now = clock.now();
  if (now - (visits.get(key) ?? -Infinity) < every) return false;
  visits.set(key, now);
  if (visits.size > 5000) for (const [k, at] of visits) if (now - at > STIR_EVERY_MS) visits.delete(k);
  return true;
}

/**
 * The player fetched this game: they are looking at it. What waited about it is cancelled and they owe no
 * answers. Now and then the fetch also stirs the rest of the party's pushes that had to wait longer than
 * their own request could.
 */
export function pushSeen(game: Pick<Game, 'code' | 'players'>, playerId: string): void {
  if (due(`${playerId} ${game.code}`, VISIT_EVERY_MS)) {
    inBackground(`seen ${game.code}`, async () => {
      if (await getPushStore().getDirtyState(playerId)) await update(playerId, (state) => (dirty(state) ? seen(state, game.code) : null));
    });
  }
  if (game.players.length > 1 && due(`stir ${game.code}`, STIR_EVERY_MS)) {
    inBackground(`stir ${game.code}`, async () => {
      const others = game.players.map((p) => p.playerId).filter((id) => id !== playerId);
      await Promise.all((await getPushStore().waitingAmong(others)).map(deliver));
    });
  }
}

const TOKEN = /^[0-9a-f]{32,200}$/i;

/** POST /api/devices: this device will take pushes for this player. */
export async function registerDevice(playerId: string, token: unknown, environment: unknown): Promise<void> {
  if (typeof token !== 'string' || !TOKEN.test(token)) throw new RangeError('token must be the device token as hex');
  if (environment !== 'sandbox' && environment !== 'production') throw new RangeError('environment must be "sandbox" or "production"');
  await getPushStore().saveDevice(playerId, token.toLowerCase(), environment);
}

/** DELETE /api/devices: this device takes no more pushes. */
export async function unregisterDevice(token: unknown): Promise<void> {
  if (typeof token !== 'string' || !TOKEN.test(token)) throw new RangeError('token must be the device token as hex');
  await getPushStore().removeDevice(token.toLowerCase());
}
