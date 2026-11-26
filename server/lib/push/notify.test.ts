import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, verify } from 'node:crypto';
import { afterEach, beforeEach, test } from 'node:test';

process.env.DD_FAKE_AI = '1';
delete process.env.DATABASE_URL;
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.DD_APP_KEY;
delete process.env.DD_FAKE_DELAY_MS;

import * as companionsApi from '../../api/companions.ts';
import * as devicesApi from '../../api/devices.ts';
import * as inviteApi from '../../api/game-invites.ts';
import * as joinApi from '../../api/game-join.ts';
import * as leaveApi from '../../api/game-leave.ts';
import * as messagesApi from '../../api/game-messages.ts';
import * as startApi from '../../api/game-start.ts';
import * as voteApi from '../../api/game-vote.ts';
import * as gameApi from '../../api/game.ts';
import * as gamesApi from '../../api/games.ts';
import * as invitesApi from '../../api/invites.ts';
import { call, gamePath, makeCharacter } from '../api.fixture.ts';
import { settle } from '../background.ts';
import { setDice } from '../game.ts';
import { fakeDungeonMaster } from '../dm/fake.ts';
import { registerDungeonMaster } from '../dm/registry.ts';
import { getStore, setStore } from '../store/index.ts';
import { MemoryStore } from '../store/memory.ts';
import type { GameState } from '../types.ts';
import { apnsConfig, apnsRequest, providerToken, RecordingSender, setSender } from './apns.ts';
import { deliver, GRACE_MS, setPushClock } from './notify.ts';
import { getPushStore, MemoryPushStore, setPushStore } from './store.ts';

const S = 1000;
const MIN = 60 * S;
const T0 = 1_800_000_000_000;

let sender: RecordingSender;
let now = T0;
/** A clock the tests move: a sleep passes at once, and takes the time with it. */
const clock = { now: () => now, sleep: async (ms: number) => { now += ms; } };

beforeEach(() => {
  setStore(new MemoryStore());
  setPushStore(new MemoryPushStore());
  sender = new RecordingSender();
  setSender(sender);
  now = T0;
  setPushClock(clock);
  setDice({ d20: () => 10, seed: () => 42 });
  registerDungeonMaster('chronicler', fakeDungeonMaster);
});
afterEach(async () => {
  await settle();
  setDice();
  setSender();
  setPushClock();
  setPushStore();
});

const tokenOf = (n: number) => n.toString(16).padStart(2, '0').repeat(32);
const register = (player: string, n: number, environment = 'production') =>
  call(devicesApi.POST, '/api/devices', { player, body: { token: tokenOf(n), environment } });
const view = async (code: string, player: string) => (await call<GameState>(gameApi.GET, gamePath(code), { player })).body;
const say = (code: string, player: string, text: string) => call(messagesApi.POST, gamePath(code, 'messages'), { player, body: { text } });
const pushes = () => sender.sent.map(({ device, message }) => [device.token.slice(0, 2), message.kind, message.body]);

/** Three players in a lobby, each with a device ("01", "02", "03"). */
async function lobby(classes = ['fighter', 'wizard', 'cleric']) {
  const players = classes.map(() => randomUUID());
  const heroes = await Promise.all(players.map((p, i) => makeCharacter(p, ['Bryn', 'Corin', 'Ilsa'][i], { race: 'human', characterClass: classes[i] })));
  const { body } = await call<GameState>(gamesApi.POST, '/api/games', { player: players[0], body: { characterId: heroes[0].id } });
  for (const i of [1, 2]) await call(joinApi.POST, gamePath(body.code, 'join'), { player: players[i], body: { characterId: heroes[i].id } });
  await Promise.all(players.map((p, i) => register(p, i + 1)));
  return { code: body.code, players, heroes };
}
const start = async (code: string, host: string) => {
  await call(startApi.POST, gamePath(code, 'start'), { player: host, body: { sceneCount: 4, dungeon: null } });
  await settle();
};

// ---- devices ----

test('POST /api/devices registers a token; a bad token or environment is refused; DELETE forgets it', async () => {
  const me = randomUUID();
  assert.equal((await register(me, 1, 'sandbox')).status, 200);
  assert.deepEqual(await getPushStore().listDevices(me), [{ token: tokenOf(1), environment: 'sandbox' }]);
  assert.equal((await call(devicesApi.POST, '/api/devices', { player: me, body: { token: 'not hex', environment: 'sandbox' } })).status, 400);
  assert.equal((await call(devicesApi.POST, '/api/devices', { player: me, body: { token: tokenOf(1), environment: 'staging' } })).status, 400);
  const other = randomUUID();
  await register(other, 1);
  assert.deepEqual(await getPushStore().listDevices(me), [], 'a token belongs to the last player to register it');
  assert.equal((await call(devicesApi.DELETE, '/api/devices', { player: other, body: { token: tokenOf(1) } })).status, 200);
  assert.deepEqual(await getPushStore().listDevices(other), []);
});

// ---- your turn ----

test('a new scene pushes "your turn" to every player, after a moment of grace', async () => {
  const { code, players } = await lobby();
  await start(code, players[0]);
  assert.equal(now, T0 + GRACE_MS, 'each push waited out its grace');
  const sent = pushes();
  assert.equal(sent.length, 3);
  assert.deepEqual(sent.map((p) => p[1]), ['turn', 'turn', 'turn']);
  assert.match(sent.find((p) => p[0] === '02')![2], /^The adventure begins: .+\. What will Corin do\?$/);
  const { message } = sender.sent[0];
  assert.equal(message.code, code);
  assert.equal(message.title, (await view(code, players[0])).title);
});

test('a player who is looking at the game gets no push about it', async () => {
  const { code, players } = await lobby();
  // The clock stands still through the grace: Bryn's app fetches the game before her push is due.
  let fetched = false;
  setPushClock({ now: () => now, sleep: async (ms) => {
    if (!fetched) { fetched = true; await view(code, players[0]); await settle0(); }
    now += ms;
  } });
  await start(code, players[0]);
  assert.deepEqual(pushes().map((p) => p[0]).sort(), ['02', '03'], 'Corin and Ilsa are away; Bryn saw it herself');
  assert.equal((await getPushStore().getState(players[0])).state.unanswered, 0);
});
/** Lets background work that needs no time finish, without waiting on sleepers. */
const settle0 = () => new Promise<void>((done) => setImmediate(() => setImmediate(done)));

test('a combat round pushes each hero who can act, and names the round and the foes', async () => {
  const { code, players } = await lobby(['fighter', 'fighter', 'fighter']);
  const withFight = (scene: any) => ({ ...scene, choices: [{ label: 'Fight', detail: 'Draw steel.', rules: { kind: 'fight', monsters: ['goblin-warrior', 'goblin-warrior'] } }, ...scene.choices.slice(1)] });
  registerDungeonMaster('chronicler', {
    openingScene: async (ctx) => withFight(await fakeDungeonMaster.openingScene(ctx)),
    nextScene: (ctx, r) => fakeDungeonMaster.nextScene(ctx, r),
    finale: (ctx, r) => fakeDungeonMaster.finale(ctx, r),
  });
  await call(startApi.POST, gamePath(code, 'start'), { player: players[0], body: { sceneCount: 4, dungeon: 'none' } });
  await settle();
  sender.sent.length = 0;
  // Ilsa's hero is struck down before the fight; the party votes to fight.
  const game = (await getStore().getGame(code))!;
  await getStore().updateGame(code, {}, { party: { ...game.party!, sheets: { ...game.party!.sheets, [players[2]]: { ...game.party!.sheets[players[2]], hp: 0, dead: true } } } });
  now += 20 * MIN;
  for (const p of players) await call(voteApi.POST, gamePath(code, 'vote'), { player: p, body: { sceneIndex: 0, choiceId: 'a' } });
  await settle();
  const state = await view(code, players[0]);
  assert.equal(state.scene!.combat, true);
  const sent = pushes();
  assert.deepEqual(sent.map((p) => [p[0], p[1]]).sort(), [['01', 'combat'], ['02', 'combat']], 'the dead hero has no action to choose');
  assert.match(sent.find((p) => p[0] === '01')![2], /^Round 1: Bryn, choose your action\. Facing Goblin Warrior( ×2)?\.$/);
});

// ---- chat ----

test('a chat message pushes the rest of the party, not the one who spoke', async () => {
  const { code, players } = await lobby();
  await say(code, players[1], 'Are we going in?');
  await settle();
  assert.deepEqual(pushes().sort(), [['01', 'chat', 'Corin: Are we going in?'], ['03', 'chat', 'Corin: Are we going in?']]);
});

/** Lets everything that needs no time run. */
const idle = async () => { for (let i = 0; i < 300; i++) await new Promise<void>((done) => setImmediate(done)); };

/** A clock whose sleepers are woken in the order of their times, as real time would wake them. */
function timeline() {
  const sleepers: { at: number; wake: () => void }[] = [];
  return {
    clock: { now: () => now, sleep: (ms: number) => new Promise<void>((wake) => { sleepers.push({ at: now + ms, wake }); }) },
    async run() {
      for (;;) {
        await idle();
        const next = sleepers.sort((a, b) => a.at - b.at).shift();
        if (!next) return;
        now = Math.max(now, next.at);
        next.wake();
      }
    },
  };
}

test('chat in a burst becomes one push that counts the rest, and a turn goes before more chat', async () => {
  const { code, players } = await lobby();
  // Only Corin's pushes are followed: the others have no device here.
  await getPushStore().removeDevice(tokenOf(1));
  await getPushStore().removeDevice(tokenOf(3));
  const time = timeline();
  setPushClock(time.clock);
  // Three messages land inside the first one's grace.
  await say(code, players[0], 'One');
  await say(code, players[2], 'Two');
  await say(code, players[0], 'Three');
  await time.run();
  assert.deepEqual(pushes(), [['02', 'chat', 'Bryn: Three (and 2 more messages)']]);
  assert.equal(now, T0 + GRACE_MS);
  // Ten seconds on there is more chat, and then the adventure begins.
  sender.sent.length = 0;
  now += 10 * S;
  await say(code, players[2], 'Four');
  await call(startApi.POST, gamePath(code, 'start'), { player: players[0], body: { sceneCount: 4, dungeon: null } });
  const times: [string, number][] = [];
  const realSend = sender.send.bind(sender);
  sender.send = async (devices, message) => { times.push([message.kind, (now - T0) / S]); return realSend(devices, message); };
  await time.run();
  assert.deepEqual(times, [['turn', 38], ['chat', 98]],
    'his turn goes 30 s after the first push; the chat, which may not be the second push of a minute, a minute after that');
});

// ---- the limits, end to end ----

test('a player who stays away gets at most 2 pushes a minute and 5 in ten minutes, each later than the last', async () => {
  const me = randomUUID();
  await register(me, 9);
  const times: number[] = [];
  const store = getPushStore();
  // A new round is ready for them every 5 seconds for half an hour.
  for (let t = T0; t < T0 + 30 * MIN; t += 5 * S) {
    now = t;
    const held = await store.getState(me);
    const key = 'turn:ABCDEF';
    await store.putState(me, held.version, { ...held.state, pending: [...held.state.pending.filter((p) => p.key !== key), { key, kind: 'combat', code: 'ABCDEF', title: 'T', body: `Round at ${t}`, dueAt: t, createdAt: t, count: 1 }] });
    const before = sender.sent.length;
    setPushClock({ now: () => now, sleep: async () => { throw new Error('stop waiting'); } });
    await deliver(me).catch(() => {});
    if (sender.sent.length > before) times.push((t - T0) / S);
  }
  assert.deepEqual(times, [0, 30, 90, 210, 450, 930], 'at 0:00, 0:30, 1:30, 3:30, 7:30 and 15:30; the next would be 31:30');
  for (const t of times) {
    assert.ok(times.filter((u) => u > t - 60 && u <= t).length <= 2);
    assert.ok(times.filter((u) => u > t - 600 && u <= t).length <= 5);
  }
});

test('a dead token is forgotten when Apple says it is gone', async () => {
  const { code, players } = await lobby();
  sender.dead.add(tokenOf(2));
  await say(code, players[0], 'Hello');
  await settle();
  assert.deepEqual(await getPushStore().listDevices(players[1]), []);
  assert.deepEqual(pushes().map((p) => p[0]), ['03']);
});

test('leaving a game, or its end, drops what was waiting about it', async () => {
  const { code, players } = await lobby();
  setPushClock({ now: () => now, sleep: async () => { throw new Error('stop waiting'); } });
  await say(code, players[0], 'Hello');
  await settle();
  assert.equal((await getPushStore().getState(players[1])).state.pending.length, 1, 'waiting out its grace');
  await call(leaveApi.POST, gamePath(code, 'leave'), { player: players[1] });
  await settle();
  assert.deepEqual((await getPushStore().getState(players[1])).state.pending, []);
});

// ---- invitations ----

test('a player invites a companion: a push, an invitation on their home screen, gone once they join', async () => {
  const { code, players, heroes } = await lobby();
  await start(code, players[0]);
  sender.sent.length = 0;
  now += 30 * MIN;
  const [bryn, corin, ilsa] = players;
  const { body: met } = await call<{ companions: { playerId: string; name: string }[] }>(companionsApi.GET, '/api/companions', { player: bryn });
  assert.deepEqual(met.companions.map((c) => c.name).sort(), ['Corin', 'Ilsa']);
  // A new party: Bryn invites Corin.
  const { body: next } = await call<GameState>(gamesApi.POST, '/api/games', { player: bryn, body: { characterId: heroes[0].id } });
  const invited = await call<{ ok: boolean; alreadyInvited: boolean }>(inviteApi.POST, gamePath(next.code, 'invites'), { player: bryn, body: { playerId: corin } });
  assert.deepEqual([invited.status, invited.body.alreadyInvited], [200, false]);
  await settle();
  assert.deepEqual(pushes(), [['02', 'invite', `Bryn invites you to a new adventure. Door code ${next.code}.`]]);
  assert.equal(now, T0 + GRACE_MS + 30 * MIN, 'an invitation waits for no grace');
  const again = await call<{ alreadyInvited: boolean }>(inviteApi.POST, gamePath(next.code, 'invites'), { player: bryn, body: { playerId: corin } });
  await settle();
  assert.equal(again.body.alreadyInvited, true);
  assert.equal(pushes().length, 1, 'asking twice pushes once');
  const mine = await call<{ invites: { code: string; fromName: string; party: string[] }[] }>(invitesApi.GET, '/api/invites', { player: corin });
  assert.deepEqual(mine.body.invites.map((i) => [i.code, i.fromName, i.party]), [[next.code, 'Bryn', ['Bryn']]]);
  // A stranger cannot be invited, nor can a stranger invite.
  const stranger = randomUUID();
  assert.equal((await call(inviteApi.POST, gamePath(next.code, 'invites'), { player: bryn, body: { playerId: stranger } })).status, 403);
  assert.equal((await call(inviteApi.POST, gamePath(next.code, 'invites'), { player: ilsa, body: { playerId: corin } })).status, 403, 'only someone in the party invites');
  // Corin joins: the invitation is gone. Ilsa's, declined, is gone too.
  await call(inviteApi.POST, gamePath(next.code, 'invites'), { player: bryn, body: { playerId: ilsa } });
  await call(joinApi.POST, gamePath(next.code, 'join'), { player: corin, body: { characterId: heroes[1].id } });
  assert.deepEqual((await call<{ invites: unknown[] }>(invitesApi.GET, '/api/invites', { player: corin })).body.invites, []);
  assert.equal((await call<{ invites: unknown[] }>(invitesApi.GET, '/api/invites', { player: ilsa })).body.invites.length, 1);
  await call(invitesApi.DELETE, `/api/invites?code=${next.code}`, { player: ilsa });
  assert.deepEqual((await call<{ invites: unknown[] }>(invitesApi.GET, '/api/invites', { player: ilsa })).body.invites, []);
  assert.equal((await call(inviteApi.POST, gamePath(next.code, 'invites'), { player: bryn, body: { playerId: corin } })).status, 409, 'already in the party');
  await settle();
});

test('the catalog says whether this server pushes: only once it holds a push key', async () => {
  const { publicCatalog } = await import('../catalog.ts');
  assert.equal(publicCatalog().push, false);
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  Object.assign(process.env, { APNS_KEY_ID: 'ABC123DEFG', APNS_TEAM_ID: 'TEAM123456', APNS_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  try {
    assert.equal(publicCatalog().push, true);
  } finally {
    for (const key of ['APNS_KEY_ID', 'APNS_TEAM_ID', 'APNS_KEY']) delete process.env[key];
  }
});

// ---- Apple's side, without the network ----

test('the APNs request: a signed provider token, a collapse id per subject, the game in the payload', () => {
  assert.equal(apnsConfig({}), null, 'no key, no pushes');
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  for (const key of [pem, Buffer.from(pem).toString('base64'), pem.replaceAll('\n', '\\n')]) {
    const config = apnsConfig({ APNS_KEY_ID: 'ABC123DEFG', APNS_TEAM_ID: 'TEAM123456', APNS_KEY: key })!;
    assert.equal(config.topic, 'com.jmm.the-dungeon-door');
    const [head, claims, signature] = providerToken(config, T0).split('.');
    assert.deepEqual(JSON.parse(Buffer.from(head, 'base64url').toString()), { alg: 'ES256', kid: 'ABC123DEFG' });
    assert.deepEqual(JSON.parse(Buffer.from(claims, 'base64url').toString()), { iss: 'TEAM123456', iat: T0 / 1000 });
    assert.ok(verify('sha256', Buffer.from(`${head}.${claims}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')));
  }
  assert.equal(apnsConfig({ APNS_KEY_ID: 'A', APNS_TEAM_ID: 'T', APNS_KEY: 'not a key' }), null);
  const round = apnsRequest({ kind: 'combat', code: 'ABCDEF', title: 'The Sunken Crypt', body: 'Round 2: Bryn, choose your action.' }, 'com.example.app', T0);
  assert.equal(round.headers['apns-collapse-id'], 'turn-ABCDEF', 'a round replaces the scene before it on the lock screen');
  assert.equal(round.headers['apns-topic'], 'com.example.app');
  assert.equal(round.headers['apns-push-type'], 'alert');
  assert.equal(round.headers['apns-expiration'], String(T0 / 1000 + 6 * 3600));
  assert.deepEqual(round.payload, {
    aps: { alert: { title: 'The Sunken Crypt', body: 'Round 2: Bryn, choose your action.' }, sound: 'default', 'thread-id': 'ABCDEF' },
    kind: 'combat', code: 'ABCDEF',
  });
  assert.equal(apnsRequest({ kind: 'chat', code: 'ABCDEF', title: 'T', body: 'B' }, 't', T0).headers['apns-collapse-id'], 'chat-ABCDEF');
});
