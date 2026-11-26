import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, test } from 'node:test';

process.env.DD_FAKE_AI = '1';
delete process.env.DATABASE_URL;
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.DD_APP_KEY;
delete process.env.DD_FAKE_DELAY_MS;

import * as catalogApi from '../api/catalog.ts';
import * as imageApi from '../api/image.ts';
import * as narrationApi from '../api/game-narration.ts';
import * as startApi from '../api/game-start.ts';
import * as voteApi from '../api/game-vote.ts';
import * as gameApi from '../api/game.ts';
import * as gamesApi from '../api/games.ts';
import * as joinApi from '../api/game-join.ts';
import { call, gamePath, makeCharacter } from './api.fixture.ts';
import { settle } from './background.ts';
import { narrationText, type Narration, requestNarration, setDice, setNarrator } from './game.ts';
import { getStore, setStore } from './store/index.ts';
import { MemoryStore } from './store/memory.ts';
import type { GameState } from './types.ts';
import { silentWav } from './voice.ts';

let readings: string[] = [];
let readers: string[] = [];

beforeEach(() => {
  setStore(new MemoryStore());
  setDice({ d20: () => 10, seed: () => 42 });
  readings = [];
  readers = [];
  setNarrator(async (text, narrator) => { readings.push(text); readers.push(narrator!.id); return { bytes: silentWav(0.1), mediaType: 'audio/wav' }; });
});
afterEach(async () => {
  await settle();
  setDice();
  setNarrator();
});

/** Two players at the opening scene of a story. */
async function table() {
  const players = [randomUUID(), randomUUID()];
  const heroes = await Promise.all(players.map((p, i) => makeCharacter(p, `Hero ${i + 1}`, { race: 'human', characterClass: 'fighter' })));
  const { body } = await call<GameState>(gamesApi.POST, '/api/games', { player: players[0], body: { characterId: heroes[0].id } });
  await call(joinApi.POST, gamePath(body.code, 'join'), { player: players[1], body: { characterId: heroes[1].id } });
  await call(startApi.POST, gamePath(body.code, 'start'), { player: players[0], body: { sceneCount: 3, dungeon: null } });
  await settle();
  return { code: body.code, players };
}
const view = async (code: string, player: string) => (await call<GameState>(gameApi.GET, gamePath(code), { player })).body;
const ask = (code: string, player: string, sceneIndex: unknown, voice?: unknown) => call<Narration>(narrationApi.POST, gamePath(code, 'narration'), { player, body: voice === undefined ? { sceneIndex } : { sceneIndex, voice } });

test('a scene is read aloud when a player asks, once, and every player gets the same file', async () => {
  const { code, players } = await table();
  const before = await view(code, players[0]);
  assert.equal(before.scene!.voiceUrl, null, 'nothing is read until someone asks');
  assert.deepEqual(readings, []);

  const asked = await Promise.all([ask(code, players[0], 0), ask(code, players[1], 0), ask(code, players[0], 0)]);
  assert.deepEqual(asked.map((r) => r.status), [200, 200, 200]);
  assert.deepEqual(asked.map((r) => r.body.status).sort(), ['making', 'making', 'ready'], 'whoever started it is handed the file; the others are told it is being made');
  await settle();
  assert.equal(readings.length, 1, 'three requests at once, one reading');
  assert.equal(readings[0], before.scene!.narration.split(/\n+/).map((l) => l.trim()).filter(Boolean).join('\n\n'));

  const [mine, theirs] = await Promise.all(players.map((p) => view(code, p)));
  assert.ok(mine.scene!.voiceUrl, 'the voice is on the scene');
  assert.equal(theirs.scene!.voiceUrl, mine.scene!.voiceUrl);
  assert.equal(asked.find((r) => r.body.status === 'ready')!.body.voiceUrl, mine.scene!.voiceUrl);
  const again = await ask(code, players[1], 0);
  assert.deepEqual(again.body, { sceneIndex: 0, voice: 'george-storyteller', status: 'ready', voiceUrl: mine.scene!.voiceUrl });
  assert.deepEqual(mine.scene!.voices, { 'george-storyteller': mine.scene!.voiceUrl });
  assert.deepEqual(readers, ['george-storyteller'], 'no voice named: the default narrator reads');
  assert.equal(readings.length, 1, 'asked again, not read again');

  const file = await imageApi.GET(new Request(mine.scene!.voiceUrl!));
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('content-type'), 'audio/wav');
  assert.equal(Buffer.from(await file.arrayBuffer()).toString('latin1', 0, 4), 'RIFF');
});

test('the narrator reads what came of the last scene, then the new one; the chronicle keeps the voices', async () => {
  const { code, players } = await table();
  for (const p of players) await call(voteApi.POST, gamePath(code, 'vote'), { player: p, body: { sceneIndex: 0, choiceId: 'a' } });
  await settle();
  const state = await view(code, players[0]);
  assert.equal(state.scene!.index, 1);
  const outcome = state.chronicle[0].outcome;
  assert.ok(outcome.length > 0);

  await ask(code, players[0], 1);
  await ask(code, players[1], 0); // an earlier scene can be heard too
  await settle();
  const game = (await getStore().getGame(code))!;
  assert.equal(readings[0], narrationText(game, game.scenes[1]));
  assert.ok(readings[0].startsWith(outcome.split(/\n+/)[0].trim()) && readings[0].endsWith(state.scene!.narration.split(/\n+/).filter(Boolean).pop()!.trim()), readings[0]);
  assert.ok(!readings[1].includes(outcome.slice(0, 40)), 'the opening has nothing before it');
  const after = await view(code, players[0]);
  assert.ok(after.scene!.voiceUrl && after.chronicle[0].voiceUrl && after.scene!.voiceUrl !== after.chronicle[0].voiceUrl);
});

test('a reading that fails says so to whoever asked, gives its claim back, and the next request tries again', async () => {
  const { code, players } = await table();
  setNarrator(async () => { throw new Error('the narrator has a cold'); });
  const failed = await ask(code, players[0], 0);
  assert.equal(failed.status, 502);
  assert.match((failed.body as unknown as { error: string }).error, /could not read/);
  await settle();
  assert.equal((await view(code, players[0])).scene!.voiceUrl, null);

  setNarrator(async (text, narrator) => { readings.push(text); readers.push(narrator!.id); return { bytes: silentWav(0.1), mediaType: 'audio/wav' }; });
  assert.equal((await ask(code, players[1], 0)).body.status, 'ready');
  assert.equal(readings.length, 1);
  assert.ok((await view(code, players[0])).scene!.voiceUrl);
});

test('a slow reading: the asker is told it is being made, and it arrives on the scene', async () => {
  const { code, players } = await table();
  let finish = () => {};
  setNarrator((text) => new Promise((resolve) => { finish = () => { readings.push(text); resolve({ bytes: silentWav(0.1), mediaType: 'audio/wav' }); }; }));
  const first = await requestNarration(code, players[0], 0, undefined, 'http://localhost:3000', 20);
  assert.deepEqual(first, { sceneIndex: 0, voice: 'george-storyteller', status: 'making', voiceUrl: null });
  assert.equal((await ask(code, players[1], 0)).body.status, 'making', 'someone else asking meanwhile starts nothing');
  assert.equal((await view(code, players[1])).scene!.voiceUrl, null);
  finish();
  await settle();
  assert.equal(readings.length, 1);
  assert.ok((await view(code, players[1])).scene!.voiceUrl);
});

test('a scene has one reading per narrator: each voice is made once, and they sit side by side', async () => {
  const { code, players } = await table();
  const george = await ask(code, players[0], 0);
  const charon = await ask(code, players[1], 0, 'charon');
  assert.deepEqual([george.body.voice, george.body.status, charon.body.voice, charon.body.status], ['george-storyteller', 'ready', 'charon', 'ready']);
  assert.notEqual(george.body.voiceUrl, charon.body.voiceUrl);
  assert.deepEqual(readers, ['george-storyteller', 'charon']);
  assert.equal(readings[0], readings[1], 'the same words in both voices');

  const again = await Promise.all([ask(code, players[0], 0, 'charon'), ask(code, players[1], 0, 'george-storyteller'), ask(code, players[0], 0, 'algenib')]);
  assert.deepEqual(again.map((r) => r.body.voiceUrl === charon.body.voiceUrl || r.body.voiceUrl === george.body.voiceUrl), [true, true, false]);
  assert.deepEqual(readers, ['george-storyteller', 'charon', 'algenib'], 'only the voice not yet heard is read');
  const state = await view(code, players[1]);
  assert.deepEqual(Object.keys(state.scene!.voices).sort(), ['algenib', 'charon', 'george-storyteller']);
  assert.equal(state.scene!.voiceUrl, george.body.voiceUrl, 'voiceUrl stays the default narrator\u2019s, for apps without the picker');
  assert.equal((await ask(code, players[0], 0, 'nobody')).status, 400);
  assert.equal((await ask(code, players[0], 0, 7)).status, 400);
});

test('the catalog lists the narrators the app can offer', async () => {
  const { body } = await call<{ narrators: { id: string; name: string; description: string }[]; defaultNarrator: string }>(catalogApi.GET, '/api/catalog');
  assert.deepEqual(body.narrators.map((n) => n.id), ['george-storyteller', 'george', 'charon', 'algenib']);
  assert.equal(body.defaultNarrator, 'george-storyteller');
});

test('narration is for the party: strangers, missing scenes and bad requests are refused', async () => {
  const { code, players } = await table();
  assert.equal((await ask(code, randomUUID(), 0)).status, 403);
  assert.equal((await ask(code, players[0], 7)).status, 404);
  assert.equal((await ask(code, players[0], 'first')).status, 400);
  assert.equal((await ask('NOSUCH', players[0], 0)).status, 404);
  await settle();
  assert.deepEqual(readings, []);
});
