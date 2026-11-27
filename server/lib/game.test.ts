import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, test } from 'node:test';

// Offline, in-memory, no app key — whatever the shell has set.
process.env.DD_FAKE_AI = '1';
delete process.env.DATABASE_URL;
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.DD_APP_KEY;
delete process.env.DD_FAKE_DELAY_MS;

import * as catalogApi from '../api/catalog.ts';
import * as charactersApi from '../api/characters.ts';
import * as advanceApi from '../api/game-advance.ts';
import * as dmApi from '../api/game-dungeon-master.ts';
import * as joinApi from '../api/game-join.ts';
import * as leaveApi from '../api/game-leave.ts';
import * as messagesApi from '../api/game-messages.ts';
import * as startApi from '../api/game-start.ts';
import * as voteApi from '../api/game-vote.ts';
import * as gameApi from '../api/game.ts';
import * as gamesApi from '../api/games.ts';
import * as imageApi from '../api/image.ts';
import * as portraitApi from '../api/portrait.ts';
import { call, gamePath, makeCharacter } from './api.fixture.ts';
import { settle } from './background.ts';
import { setDice } from './game.ts';
import { TREK_SCENES } from './play/trek.ts';
import { TURN_SECONDS } from './play/turn-clock.ts';
import { fakeDungeonMaster } from './dm/fake.ts';
import { registerDungeonMaster, unregisterDungeonMaster } from './dm/registry.ts';
import type { DungeonMaster } from './dm/types.ts';
import { MemoryStore } from './store/memory.ts';
import { getStore, setStore } from './store/index.ts';
import type { Character, GameState, Message } from './types.ts';

async function table(n: number) {
  const players = Array.from({ length: n }, () => randomUUID());
  const characters = await Promise.all(players.map((p, i) => makeCharacter(p, `Hero ${i + 1}`)));
  const created = await call<GameState>(gamesApi.POST, '/api/games', { player: players[0], body: { characterId: characters[0].id } });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const code = created.body.code;
  for (let i = 1; i < n; i++) {
    const joined = await call(joinApi.POST, gamePath(code, 'join'), { player: players[i], body: { characterId: characters[i].id } });
    assert.equal(joined.status, 200, JSON.stringify(joined.body));
  }
  return { code, players, characters, host: players[0] };
}

const view = async (code: string, player: string, since?: number) =>
  (await call<GameState>(gameApi.GET, gamePath(code, undefined, since === undefined ? '' : `&since=${since}`), { player })).body;

beforeEach(() => {
  setStore(new MemoryStore());
  setDice({ d20: () => randomInt(1, 21), seed: () => 5 }); // a road from the tavern with no one on it: a quiet stretch, then a vendor
});
afterEach(async () => {
  await settle();
  setDice();
  for (const id of ['chronicler', 'trickster', 'grim-warden', 'bard']) unregisterDungeonMaster(id);
  delete process.env.DD_APP_KEY;
});

test('an account out of credit is told to the table as that, in the lobby and mid-game, not as a fumble to retry', async () => {
  const broke = () => Object.assign(new Error('A positive credit balance is required for all requests, including BYOK.'), { statusCode: 402 });
  let paid = false;
  const unpaid: DungeonMaster = {
    openingScene: async (ctx) => { if (!paid) throw broke(); return fakeDungeonMaster.openingScene(ctx); },
    nextScene: async () => { throw new Error('Failed after 3 attempts', { cause: broke() }); },
    finale: fakeDungeonMaster.finale,
  };
  registerDungeonMaster('chronicler', unpaid);
  const { code, players, host } = await table(2);
  await call(startApi.POST, gamePath(code, 'start'), { player: host, body: {} });
  await settle();
  let state = await view(code, host);
  assert.equal(state.status, 'lobby', 'the party is back at the door');
  const said = (text: RegExp) => state.messages.some((m: Message) => m.kind === 'system' && text.test(m.text));
  assert.ok(said(/could not begin\. The game's AI account has run out of credit/), JSON.stringify(state.messages.map((m: Message) => m.text)));
  assert.equal(said(/lost their notes/), false);

  paid = true;
  await call(startApi.POST, gamePath(code, 'start'), { player: host, body: {} });
  await settle();
  state = await view(code, host);
  assert.equal(state.status, 'voting');
  for (const p of players) await call(voteApi.POST, gamePath(code, 'vote'), { player: p, body: { sceneIndex: 0, choiceId: 'a' } });
  await settle();
  state = await view(code, host);
  assert.equal(state.status, 'voting', 'votes reopen');
  assert.ok(said(/could not go on\. The game's AI account has run out of credit/), JSON.stringify(state.messages.map((m: Message) => m.text).slice(-4)));
  assert.equal(said(/fumbled their dice/), false);
});

test('catalog lists the options and hides server-only DM fields', async () => {
  const { status, body } = await call(catalogApi.GET, '/api/catalog');
  assert.equal(status, 200);
  assert.ok(body.races.length >= 9 && body.classes.length >= 12 && body.temperaments.length >= 8);
  assert.equal(body.alignments.length, 9);
  assert.deepEqual(body.genders.map((g: { id: string }) => g.id), ['female', 'male', 'nonbinary']);
  assert.deepEqual(body.dungeonMasters.map((d: { id: string }) => d.id), ['chronicler', 'trickster', 'grim-warden', 'bard']);
  for (const dm of body.dungeonMasters) {
    assert.deepEqual(Object.keys(dm).sort(), ['accent', 'description', 'id', 'name', 'symbol', 'tagline']);
  }
  assert.ok(body.classes.every((c: { symbol?: string }) => c.symbol));
});

test('auth: player id required, app key checked only when configured', async () => {
  assert.equal((await call(charactersApi.GET, '/api/characters')).status, 401);
  assert.equal((await call(charactersApi.GET, '/api/characters', { player: 'not-a-uuid' })).status, 401);
  assert.equal((await call(charactersApi.GET, '/api/characters', { player: randomUUID() })).status, 200);
  process.env.DD_APP_KEY = 'sesame';
  assert.equal((await call(catalogApi.GET, '/api/catalog')).status, 401);
  assert.equal((await call(catalogApi.GET, '/api/catalog', { headers: { 'x-dd-key': 'sesamE' } })).status, 401);
  assert.equal((await call(catalogApi.GET, '/api/catalog', { headers: { 'x-dd-key': 'sesame' } })).status, 200);
  assert.equal((await call(charactersApi.GET, '/api/characters', { player: randomUUID() })).status, 401);
  assert.equal((await call(charactersApi.GET, '/api/characters', { player: randomUUID(), headers: { 'x-dd-key': 'sesame' } })).status, 200);
});

test('characters: upsert, list newest first, owner-only update and delete', async () => {
  const me = randomUUID();
  const other = randomUUID();
  const a = await makeCharacter(me, 'Astrid');
  await new Promise((r) => setTimeout(r, 5));
  const b = await makeCharacter(me, 'Borin');
  assert.equal(a.ownerId, me);
  assert.equal(a.appearance, null);

  const list = await call<{ characters: Character[] }>(charactersApi.GET, '/api/characters', { player: me });
  assert.deepEqual(list.body.characters.map((c) => c.name), ['Borin', 'Astrid']);

  const updated = await call<Character>(charactersApi.PUT, '/api/characters', { player: me, method: 'PUT', body: { ...a, name: 'Astrid the Bold', ownerId: other } });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.ownerId, me);
  assert.equal(updated.body.createdAt, a.createdAt);

  assert.equal((await call(charactersApi.PUT, '/api/characters', { player: other, method: 'PUT', body: a })).status, 403);
  assert.equal((await call(charactersApi.PUT, '/api/characters', { player: me, method: 'PUT', body: { ...a, race: 'robot' } })).status, 400);
  assert.equal((await call(charactersApi.PUT, '/api/characters', { player: me, method: 'PUT', body: { ...a, name: '' } })).status, 400);
  assert.equal((await call(charactersApi.PUT, '/api/characters', { player: me, method: 'PUT', body: { ...a, backstory: 'x'.repeat(601) } })).status, 400);

  assert.equal((await call(charactersApi.DELETE, `/api/characters?id=${b.id}`, { player: other, method: 'DELETE' })).status, 403);
  assert.equal((await call(charactersApi.DELETE, `/api/characters?id=${b.id}`, { player: me, method: 'DELETE' })).status, 200);
  assert.equal((await call(charactersApi.DELETE, `/api/characters?id=${b.id}`, { player: me, method: 'DELETE' })).status, 404);
});

test('portrait: fake AI returns an appearance and a loadable PNG', async () => {
  const character = { name: 'Vex', race: 'tiefling', characterClass: 'warlock', gender: 'nonbinary', temperament: 'cunning', alignment: 'chaotic-neutral', backstory: 'Sold a shadow.', description: 'violet eyes' };
  const { status, body } = await call(portraitApi.POST, '/api/portrait', { player: randomUUID(), body: { character } });
  assert.equal(status, 200, JSON.stringify(body));
  assert.match(body.appearance, /violet eyes/);
  assert.match(body.portraitUrl, /^http:\/\/localhost:3000\/api\/image\?id=/);
  const image = await imageApi.GET(new Request(body.portraitUrl));
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');
  const bytes = new Uint8Array(await image.arrayBuffer());
  assert.deepEqual([...bytes.slice(1, 4)], [0x50, 0x4e, 0x47]);

  const reroll = await call(portraitApi.POST, '/api/portrait', { player: randomUUID(), body: { character, previousAppearance: body.appearance, note: 'darker cloak' } });
  assert.match(reroll.body.appearance, /darker cloak/);
  assert.equal((await call(portraitApi.POST, '/api/portrait', { player: randomUUID(), body: { character: { ...character, race: 'robot' } } })).status, 400);
});

test('a full game: lobby, chat, start, votes, auto-resolve, host advance, finale', async () => {
  const { code, players, host } = await table(3);
  const [, p2, p3] = players;
  const outsider = randomUUID();

  let state = await view(code, host);
  assert.equal(state.status, 'lobby');
  assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(state.players.length, 3);
  assert.deepEqual(state.players.map((p) => p.isHost), [true, false, false]);
  assert.equal(state.scene, null);
  assert.deepEqual(state.chronicle, []);
  assert.equal(state.dungeonMaster, 'chronicler');

  // Only players can see the game; unknown codes are 404.
  assert.equal((await call(gameApi.GET, gamePath(code), { player: outsider })).status, 403);
  assert.equal((await call(gameApi.GET, gamePath('ZZZZZZ'), { player: host })).status, 404);

  // Chat
  const msg = await call<Message>(messagesApi.POST, gamePath(code, 'messages'), { player: p2, body: { text: '  Hello there!  ' } });
  assert.equal(msg.status, 200);
  assert.equal(msg.body.kind, 'chat');
  assert.equal(msg.body.text, 'Hello there!');
  assert.equal(msg.body.characterName, 'Hero 2');
  assert.equal(msg.body.voice, 'in');
  assert.equal(msg.body.replyTo, null);
  assert.deepEqual(msg.body.reactions, []);
  assert.equal((await call(messagesApi.POST, gamePath(code, 'messages'), { player: p2, body: { text: '' } })).status, 400);
  assert.equal((await call(messagesApi.POST, gamePath(code, 'messages'), { player: p2, body: { text: 'x'.repeat(501) } })).status, 400);
  assert.equal((await call(messagesApi.POST, gamePath(code, 'messages'), { player: outsider, body: { text: 'hi' } })).status, 403);
  const since = await view(code, host, msg.body.id - 1);
  assert.deepEqual(since.messages.map((m) => m.id), [msg.body.id]);
  assert.ok(state.messages.every((m, i) => i === 0 || m.id > state.messages[i - 1].id));

  // Dungeon master: host only, known ids only
  assert.equal((await call(dmApi.POST, gamePath(code, 'dungeon-master'), { player: p2, body: { dungeonMaster: 'bard' } })).status, 403);
  assert.equal((await call(dmApi.POST, gamePath(code, 'dungeon-master'), { player: host, body: { dungeonMaster: 'nope' } })).status, 400);
  state = (await call<GameState>(dmApi.POST, gamePath(code, 'dungeon-master'), { player: host, body: { dungeonMaster: 'grim-warden' } })).body;
  assert.equal(state.dungeonMaster, 'grim-warden');

  // Start: host only, valid scene counts, then preparing → voting in the background
  assert.equal((await call(startApi.POST, gamePath(code, 'start'), { player: p2, body: {} })).status, 403);
  assert.equal((await call(startApi.POST, gamePath(code, 'start'), { player: host, body: { sceneCount: 9 } })).status, 400);
  assert.equal((await call(startApi.POST, gamePath(code, 'start'), { player: host, body: { sceneCount: 1 } })).status, 400);
  const started = await call<GameState>(startApi.POST, gamePath(code, 'start'), { player: host, body: { sceneCount: 3 } });
  assert.equal(started.status, 200);
  assert.equal(started.body.status, 'preparing');
  assert.equal(started.body.sceneCount, 3 + TREK_SCENES, 'the road from the tavern, then the tale');
  assert.equal((await call(startApi.POST, gamePath(code, 'start'), { player: host, body: {} })).status, 409);
  assert.equal((await call(dmApi.POST, gamePath(code, 'dungeon-master'), { player: host, body: { dungeonMaster: 'bard' } })).status, 409);
  await settle();

  state = await view(code, host);
  assert.equal(state.status, 'voting');
  assert.ok(state.title);
  assert.equal(state.scene?.index, 0);
  assert.deepEqual(state.scene?.choices.map((c) => c.id), ['a', 'b', 'c']);
  assert.ok(state.scene?.actions.some((a) => a.id === 'choice:a' && a.kind === 'choice' && a.available));
  assert.ok(state.scene?.imageUrl, 'scene art painted');
  assert.equal(state.scene?.isFinale, false);
  assert.equal(state.scene?.myVote, null);
  assert.ok(state.messages.some((m) => m.kind === 'dm'));
  assert.ok(state.messages.some((m) => m.kind === 'system'));

  // Late joiners are turned away; existing players re-joining just get the state
  const late = randomUUID();
  const lateChar = await makeCharacter(late, 'Latecomer');
  assert.equal((await call(joinApi.POST, gamePath(code, 'join'), { player: late, body: { characterId: lateChar.id } })).status, 409);

  // Votes: validation, wrong scene, vote changes keep the roll
  assert.equal((await call(voteApi.POST, gamePath(code, 'vote'), { player: host, body: { sceneIndex: 0, choiceId: 'd' } })).status, 400);
  assert.equal((await call(voteApi.POST, gamePath(code, 'vote'), { player: host, body: { sceneIndex: 0, actionId: 'nope' } })).status, 400);
  const refused = await call<{ error: string }>(voteApi.POST, gamePath(code, 'vote'), { player: host, body: { sceneIndex: 0, actionId: 'common:dodge' } });
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /Not in a fight/);
  assert.equal((await call(voteApi.POST, gamePath(code, 'vote'), { player: host, body: { sceneIndex: 1, choiceId: 'a' } })).status, 409);
  assert.equal((await call(voteApi.POST, gamePath(code, 'vote'), { player: outsider, body: { sceneIndex: 0, choiceId: 'a' } })).status, 403);
  // Advance needs at least one vote
  assert.equal((await call(advanceApi.POST, gamePath(code, 'advance'), { player: host })).status, 409);

  state = (await call<GameState>(voteApi.POST, gamePath(code, 'vote'), { player: host, body: { sceneIndex: 0, choiceId: 'a' } })).body;
  assert.equal(state.scene?.myVote, 'a');
  assert.deepEqual(state.scene?.myAction, { id: 'choice:a', targets: [] });
  const roll = state.scene!.votes[0].roll;
  assert.ok(roll >= 1 && roll <= 20);
  state = (await call<GameState>(voteApi.POST, gamePath(code, 'vote'), { player: host, body: { sceneIndex: 0, actionId: 'choice:b' } })).body;
  assert.equal(state.scene?.myVote, 'b');
  assert.deepEqual(state.scene?.myAction, { id: 'choice:b', targets: [] });
  assert.equal(state.scene?.votes.length, 1);
  assert.equal(state.scene?.votes[0].roll, roll);
  assert.equal(state.status, 'voting');

  await call(voteApi.POST, gamePath(code, 'vote'), { player: p2, body: { sceneIndex: 0, choiceId: 'b' } });
  state = (await call<GameState>(voteApi.POST, gamePath(code, 'vote'), { player: p3, body: { sceneIndex: 0, choiceId: 'c' } })).body;
  assert.equal(state.status, 'resolving', 'everyone voted → resolves');
  assert.equal((await call(voteApi.POST, gamePath(code, 'vote'), { player: p3, body: { sceneIndex: 0, choiceId: 'a' } })).status, 409);
  await settle();

  state = await view(code, p2);
  assert.equal(state.status, 'voting');
  assert.equal(state.scene?.index, 1);
  assert.equal(state.scene?.myVote, null);
  assert.equal(state.chronicle.length, 1);
  assert.equal(state.chronicle[0].index, 0);
  assert.ok(state.chronicle[0].outcome);
  assert.equal(started.body.scene, null);
  assert.equal(state.chronicle[0].choiceLabel, 'Look for another way', 'most-voted choice (b)');

  // Host advances with only some votes in (an AFK player). Non-hosts can't.
  await call(voteApi.POST, gamePath(code, 'vote'), { player: p2, body: { sceneIndex: 1, choiceId: 'c' } });
  assert.equal((await call(advanceApi.POST, gamePath(code, 'advance'), { player: p2 })).status, 403);
  state = (await call<GameState>(advanceApi.POST, gamePath(code, 'advance'), { player: host })).body;
  assert.equal(state.status, 'resolving');
  await settle();

  // sceneCount 3 after the two stretches of road: scenes 0–3 have choices, scene 4 is the epilogue
  for (const sceneIndex of [2, 3]) {
    for (const player of players) await call(voteApi.POST, gamePath(code, 'vote'), { player, body: { sceneIndex, choiceId: 'a' } });
    await settle();
  }
  state = await view(code, p3);
  assert.equal(state.status, 'ended');
  assert.equal(state.scene?.index, 4);
  assert.equal(state.scene?.isFinale, true);
  assert.deepEqual(state.scene?.choices, []);
  assert.ok(state.scene?.imageUrl);
  assert.equal(state.chronicle.length, 4);
  assert.equal(state.chronicle[1].choiceLabel, 'Parley first');
  assert.equal((await call(voteApi.POST, gamePath(code, 'vote'), { player: host, body: { sceneIndex: 4, choiceId: 'a' } })).status, 409);
  assert.equal((await call(advanceApi.POST, gamePath(code, 'advance'), { player: host })).status, 409);
});

test('join rules: lobby only, max 6, re-join swaps character', async () => {
  const { code, players } = await table(6);
  const seventh = randomUUID();
  const char = await makeCharacter(seventh, 'Seventh');
  assert.equal((await call(joinApi.POST, gamePath(code, 'join'), { player: seventh, body: { characterId: char.id } })).status, 409);

  // Someone else's character can't be used
  assert.equal((await call(joinApi.POST, gamePath(code, 'join'), { player: seventh, body: { characterId: randomUUID() } })).status, 404);

  const swap = await makeCharacter(players[1], 'Hero 2 Reborn');
  const state = (await call<GameState>(joinApi.POST, gamePath(code, 'join'), { player: players[1], body: { characterId: swap.id } })).body;
  assert.equal(state.players.length, 6);
  assert.equal(state.players.find((p) => p.playerId === players[1])?.character.name, 'Hero 2 Reborn');
  assert.equal((await call(joinApi.POST, gamePath('ABCDE2', 'join'), { player: seventh, body: { characterId: char.id } })).status, 404);
});

test('leave: the earliest remaining player becomes host; leaving can complete a vote', async () => {
  const { code, players, host } = await table(3);
  const left = await call(leaveApi.POST, gamePath(code, 'leave'), { player: host, body: {} });
  assert.deepEqual(left.body, { ok: true });
  let state = await view(code, players[1]);
  assert.equal(state.hostId, players[1]);
  assert.deepEqual(state.players.map((p) => p.isHost), [true, false]);
  assert.equal((await call(gameApi.GET, gamePath(code), { player: host })).status, 403);

  await call(startApi.POST, gamePath(code, 'start'), { player: players[1], body: { sceneCount: 2 } });
  await settle();
  await call(voteApi.POST, gamePath(code, 'vote'), { player: players[1], body: { sceneIndex: 0, choiceId: 'a' } });
  assert.equal((await view(code, players[1])).status, 'voting');
  await call(leaveApi.POST, gamePath(code, 'leave'), { player: players[2], body: {} });
  await settle();
  state = await view(code, players[1]);
  assert.deepEqual([state.status, state.scene?.index, state.chronicle.length], ['voting', 1, 1], 'the vote completed: the scene resolved');
});

test('concurrent votes resolve the scene exactly once', async () => {
  let opened = 0;
  let resolved = 0;
  const counting: DungeonMaster = {
    openingScene: async (ctx) => (opened++, fakeDungeonMaster.openingScene(ctx)),
    nextScene: async (ctx, r) => (resolved++, fakeDungeonMaster.nextScene(ctx, r)),
    finale: async (ctx, r) => (resolved++, fakeDungeonMaster.finale(ctx, r)),
  };
  registerDungeonMaster('chronicler', counting);
  const { code, players, host } = await table(6);
  await Promise.all([
    call(startApi.POST, gamePath(code, 'start'), { player: host, body: {} }),
    call(startApi.POST, gamePath(code, 'start'), { player: host, body: {} }),
  ]);
  await settle();
  assert.equal(opened, 1);

  // Everyone votes at once while the host also mashes advance.
  const results = await Promise.all([
    ...players.map((p, i) => call(voteApi.POST, gamePath(code, 'vote'), { player: p, body: { sceneIndex: 0, choiceId: 'abc'[i % 3] } })),
    call(advanceApi.POST, gamePath(code, 'advance'), { player: host }),
    call(advanceApi.POST, gamePath(code, 'advance'), { player: host }),
  ]);
  await settle();
  assert.equal(resolved, 1, 'DM resolved the scene once');
  const state = await view(code, host);
  assert.equal(state.scene?.index, 1);
  assert.equal(state.chronicle.length, 1);
  assert.ok(results.slice(0, 6).every((r) => r.status === 200 || r.status === 409));
  const dmOutcomes = state.messages.filter((m) => m.kind === 'dm' && m.text === state.chronicle[0].outcome);
  assert.equal(dmOutcomes.length, 1);
});

test('DM failures drop back to the previous status with a system message', async () => {
  let failOpen = true;
  let failNext = true;
  const flaky: DungeonMaster = {
    openingScene: async (ctx) => { if (failOpen) throw new Error('boom'); return fakeDungeonMaster.openingScene(ctx); },
    nextScene: async (ctx, r) => { if (failNext) throw new Error('boom'); return fakeDungeonMaster.nextScene(ctx, r); },
    finale: fakeDungeonMaster.finale,
  };
  registerDungeonMaster('chronicler', flaky);
  const { code, players, host } = await table(2);

  await call(startApi.POST, gamePath(code, 'start'), { player: host, body: {} });
  await settle();
  let state = await view(code, host);
  assert.equal(state.status, 'lobby');
  assert.match(state.messages.at(-1)!.text, /try again/);
  assert.equal(state.messages.at(-1)!.kind, 'system');

  failOpen = false;
  await call(startApi.POST, gamePath(code, 'start'), { player: host, body: {} });
  await settle();
  assert.equal((await view(code, host)).status, 'voting');

  await call(voteApi.POST, gamePath(code, 'vote'), { player: host, body: { sceneIndex: 0, choiceId: 'a' } });
  await call(voteApi.POST, gamePath(code, 'vote'), { player: players[1], body: { sceneIndex: 0, choiceId: 'a' } });
  await settle();
  state = await view(code, host);
  assert.equal(state.status, 'voting');
  assert.equal(state.scene?.index, 0);
  assert.equal(state.scene?.votes.length, 2, 'votes kept');
  assert.equal(state.messages.at(-1)!.kind, 'system');

  failNext = false;
  await call(advanceApi.POST, gamePath(code, 'advance'), { player: host });
  await settle();
  state = await view(code, host);
  assert.equal(state.scene?.index, 1);
  assert.equal(state.chronicle[0].choiceLabel, 'Charge straight in');
});

test('in a game from before the rules engine, ties are broken by the DM pick, but only among the leaders', async () => {
  const picky: DungeonMaster = {
    ...fakeDungeonMaster,
    nextScene: async (ctx, r) => ({ ...(await fakeDungeonMaster.nextScene(ctx, r)), chosenChoiceId: 'b' }),
  };
  registerDungeonMaster('chronicler', picky);
  const { code, players, host } = await table(2);
  await call(startApi.POST, gamePath(code, 'start'), { player: host, body: { sceneCount: 4 } });
  await settle();
  await getStore().updateGame(code, {}, { party: null, combat: null, dungeon: null }); // a legacy game
  await call(voteApi.POST, gamePath(code, 'vote'), { player: host, body: { sceneIndex: 0, choiceId: 'a' } });
  await call(voteApi.POST, gamePath(code, 'vote'), { player: players[1], body: { sceneIndex: 0, choiceId: 'b' } });
  await settle();
  let state = await view(code, host);
  assert.equal(state.chronicle[0].choiceLabel, 'Look for another way', 'tie a/b → DM picked b');

  await call(voteApi.POST, gamePath(code, 'vote'), { player: host, body: { sceneIndex: 1, choiceId: 'c' } });
  await call(voteApi.POST, gamePath(code, 'vote'), { player: players[1], body: { sceneIndex: 1, choiceId: 'c' } });
  await settle();
  state = await view(code, host);
  assert.equal(state.chronicle[1].choiceLabel, 'Parley first', 'DM pick b ignored: c won outright');
});

test('the choice window is on the view before anyone votes, and gone while the next turn is written', async () => {
  const { code, players, host } = await table(2);
  const lobby = await view(code, host);
  assert.equal(lobby.status, 'lobby');
  assert.equal(lobby.turn, null);
  assert.equal(lobby.players.length, 2);

  const started = await call<GameState>(startApi.POST, gamePath(code, 'start'), { player: host, body: { sceneCount: 2 } });
  assert.equal(started.body.status, 'preparing');
  assert.equal(started.body.turn, null);
  await settle();

  const open = await view(code, host);
  assert.equal(open.status, 'voting');
  assert.equal(open.scene?.votes.length, 0, 'nobody has chosen yet');
  assert.equal(open.players.length, 2, 'both heroes are on the view before either responds');
  assert.equal(open.turn?.seconds, TURN_SECONDS);
  const stored = await getStore().getGame(code);
  const scene = stored?.scenes.find((s) => s.index === open.scene?.index);
  assert.ok(scene);
  assert.equal(Date.parse(open.turn!.deadline), Date.parse(scene.createdAt) + TURN_SECONDS * 1000);
  assert.ok(Math.abs(Date.parse(open.turn!.now) - Date.now()) < 5_000);

  await call(voteApi.POST, gamePath(code, 'vote'), { player: host, body: { sceneIndex: open.scene!.index, choiceId: 'a' } });
  const mid = await view(code, players[1]);
  assert.equal(mid.status, 'voting');
  assert.equal(mid.turn?.deadline, open.turn!.deadline, 'one vote does not move the window');
  assert.equal(mid.scene?.votes.length, 1);
  assert.equal(mid.players.length, 2, 'the hero who has not chosen is still listed');
  assert.equal(mid.players.some((p) => p.playerId === players[1]), true);

  const resolving = (await call<GameState>(voteApi.POST, gamePath(code, 'vote'), {
    player: players[1], body: { sceneIndex: open.scene!.index, choiceId: 'b' },
  })).body;
  assert.equal(resolving.status, 'resolving');
  assert.equal(resolving.turn, null, 'the window closes while the next turn is written');
});
