/** A streamlined game played through the API handlers: the telling is chosen at the door, kept on the game, and held by the engine. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, test } from 'node:test';

process.env.DD_FAKE_AI = '1';
delete process.env.DATABASE_URL;
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.DD_APP_KEY;
delete process.env.DD_FAKE_DELAY_MS;

import * as catalogApi from '../api/catalog.ts';
import * as joinApi from '../api/game-join.ts';
import * as startApi from '../api/game-start.ts';
import * as voteApi from '../api/game-vote.ts';
import * as gameApi from '../api/game.ts';
import * as gamesApi from '../api/games.ts';
import { call, gamePath, makeCharacter } from './api.fixture.ts';
import { settle } from './background.ts';
import { fakeDungeonMaster } from './dm/fake.ts';
import { registerDungeonMaster, unregisterDungeonMaster } from './dm/registry.ts';
import type { DMContext, DungeonMaster } from './dm/types.ts';
import { setDice } from './game.ts';
import { getStore, setStore } from './store/index.ts';
import { MemoryStore } from './store/memory.ts';
import { sentencesOf, STREAMLINED, wordCount } from './telling.ts';
import type { GameState } from './types.ts';

beforeEach(() => {
  setStore(new MemoryStore());
  setDice({ d20: () => 12, seed: () => 42 });
});
afterEach(async () => {
  await settle();
  unregisterDungeonMaster('chronicler');
  setDice();
});

const WORDY = 'Mist coils over the ford, silver in the last of the light, and the reeds whisper of older travellers who never reached the far bank.\n\n' +
  'A lean grey wolf stands in the shallows, and a giant rat gnaws at a courier\'s satchel beside it. Somewhere upstream a bell tolls twice. ' +
  'The road beyond climbs toward a door in the hillside. What do you do?';
const LONG_OUTCOME = 'The party wades in without a sound. The wolf lifts its head and lets them pass. Far behind them, the tavern lights wink out one by one.';
const LABEL = 'Creep along the far bank under cover of the reeds';
const DETAIL = 'Slow and cold, and the rat has sharp ears; one splash and both of them will be on you.';

/** A dungeon master who writes at length whatever it is asked, and keeps what it was told. */
function wordyDM(seen: DMContext[] = []): DungeonMaster {
  const wordy = <T extends { narration: string; choices?: { label: string; detail: string }[] }>(scene: T): T => ({
    ...scene, narration: WORDY, quip: 'Mind the rat, my dears, it bites.',
    ...(scene.choices ? { choices: scene.choices.map((c, i) => (i === 1 ? { ...c, label: LABEL, detail: DETAIL } : { ...c, detail: DETAIL })) } : {}),
  });
  return {
    ...fakeDungeonMaster,
    openingScene: async (ctx) => { seen.push(ctx); return wordy(await fakeDungeonMaster.openingScene({ ...ctx, telling: 'full' })); },
    nextScene: async (ctx, resolution) => { seen.push(ctx); return { ...wordy(await fakeDungeonMaster.nextScene({ ...ctx, telling: 'full' }, resolution)), outcome: LONG_OUTCOME }; },
  };
}

type Started = GameState & { error?: string };

/** A lobby of `n` fighters; `start` opens the door with the body given. */
async function lobby(n: number) {
  const players = Array.from({ length: n }, () => randomUUID());
  const characters = await Promise.all(players.map((p, i) => makeCharacter(p, `Hero ${i + 1}`, { race: 'human', characterClass: 'fighter' })));
  const { body } = await call<GameState>(gamesApi.POST, '/api/games', { player: players[0], body: { characterId: characters[0].id } });
  for (let i = 1; i < n; i++) await call(joinApi.POST, gamePath(body.code, 'join'), { player: players[i], body: { characterId: characters[i].id } });
  const start = async (extra: Record<string, unknown>) => {
    const started = await call<Started>(startApi.POST, gamePath(body.code, 'start'), { player: players[0], body: { sceneCount: 4, ...extra } });
    await settle();
    return started;
  };
  return { code: body.code, players, host: players[0], start, lobbyState: body };
}

const view = async (code: string, player: string) => (await call<GameState>(gameApi.GET, gamePath(code), { player })).body;
const asides = (state: GameState) => state.messages.filter((m) => m.kind === 'dm').map((m) => m.text);

test('the catalog offers the tellings, and a game is told in full until the host says otherwise', async () => {
  const { body } = await call<{ tellings: { id: string; name: string }[] }>(catalogApi.GET, '/api/catalog');
  assert.deepEqual(body.tellings.map((t) => t.id), ['full', 'streamlined']);

  const table = await lobby(1);
  assert.equal(table.lobbyState.telling, 'full', 'in the lobby');
  const started = await table.start({});
  assert.deepEqual([started.status, started.body.telling], [200, 'full'], 'a start that names no telling, as an older app sends it');
  const state = await view(table.code, table.host);
  assert.equal(state.telling, 'full');
  assert.match(state.scene!.narration, /\n\n/, 'the full story keeps its paragraphs');
  assert.ok(asides(state).length > 0, 'and the dungeon master\'s welcome');
  assert.equal((await getStore().getGame(table.code))!.telling, 'full');
});

test('an unknown telling is refused and the party stays at the door', async () => {
  const table = await lobby(1);
  const refused = await table.start({ telling: 'terse' });
  assert.equal(refused.status, 400);
  assert.match(refused.body.error!, /telling must be "full" or "streamlined"/);
  assert.equal((await view(table.code, table.host)).status, 'lobby');
});

test('a streamlined game: whatever the dungeon master writes, the table reads two sentences, short choices and no aside', async () => {
  const seen: DMContext[] = [];
  registerDungeonMaster('chronicler', wordyDM(seen));
  const table = await lobby(2);
  const started = await table.start({ telling: 'streamlined' });
  assert.deepEqual([started.status, started.body.telling], [200, 'streamlined']);
  assert.equal(seen[0].telling, 'streamlined', 'the dungeon master is told');

  const state = await view(table.code, table.players[1]);
  assert.equal(state.telling, 'streamlined', 'every player sees it');
  const scene = state.scene!;
  assert.equal(scene.narration, 'Mist coils over the ford, silver in the last of the light, and the reeds whisper of older travellers who never reached the far bank.');
  assert.ok(sentencesOf(scene.narration).length <= STREAMLINED.narration.sentences);
  assert.ok(wordCount(scene.narration) <= STREAMLINED.narration.words);
  assert.equal(scene.narration.includes('What do you do?'), false);
  assert.deepEqual(scene.choices.map((c) => c.label), ['Charge straight in', 'Creep along the far bank under…', 'Parley first']);
  assert.deepEqual(scene.choices.map((c) => c.detail), ['Slow and cold.', 'Slow and cold.', 'Slow and cold.']);
  assert.ok(scene.choices.every((c) => typeof c.rules === 'string' && c.rules.length > 0), 'each choice keeps its hook: the game under the words is the same');
  assert.deepEqual(asides(state), [], 'the quip is not posted');
});

test('a streamlined game: what happened is one sentence, the dice and the turn\'s result are as in any game', async () => {
  registerDungeonMaster('chronicler', wordyDM());
  const table = await lobby(2);
  await table.start({ telling: 'streamlined' });
  for (const p of table.players) await call(voteApi.POST, gamePath(table.code, 'vote'), { player: p, body: { sceneIndex: 0, choiceId: 'b' } });
  await settle();
  const state = await view(table.code, table.host);
  assert.equal(state.scene!.index, 1);
  const [turn] = state.chronicle;
  assert.equal(turn.outcome, 'The party wades in without a sound.');
  assert.deepEqual(asides(state), ['The party wades in without a sound.'], 'the outcome is told to the table; the quip is not');
  const result = turn.result!;
  assert.deepEqual([result.choice!.id, result.choice!.backers.length, result.heroes.length], ['b', 2, 2]);
  assert.ok(result.heroes.some((h) => h.rolls.length > 0), 'the choice\'s check was rolled');
  assert.ok(state.messages.some((m) => m.kind === 'system' && / vs DC \d+/.test(m.text)), 'and its dice are in the log');
  assert.ok(sentencesOf(state.scene!.narration).length <= 2);
});

test('the same dungeon master is left in full in a full game', async () => {
  const seen: DMContext[] = [];
  registerDungeonMaster('chronicler', wordyDM(seen));
  const table = await lobby(1);
  await table.start({ telling: 'full' });
  const state = await view(table.code, table.host);
  assert.equal(seen[0].telling, 'full');
  assert.equal(state.scene!.narration, WORDY);
  assert.equal(state.scene!.choices[1].label, LABEL);
  assert.equal(state.scene!.choices[1].detail, DETAIL);
  assert.deepEqual(asides(state), ['Mind the rat, my dears, it bites.']);
  await call(voteApi.POST, gamePath(table.code, 'vote'), { player: table.host, body: { sceneIndex: 0, choiceId: 'b' } });
  await settle();
  assert.equal((await view(table.code, table.host)).chronicle[0].outcome, LONG_OUTCOME);
});

test('the fake dungeon master, asked for a streamlined game, tells each scene in a line', async () => {
  const table = await lobby(1);
  await table.start({ telling: 'streamlined' });
  let state = await view(table.code, table.host);
  assert.equal(sentencesOf(state.scene!.narration).length, 1, state.scene!.narration);
  assert.ok(state.scene!.choices.every((c) => c.detail === ''));
  await call(voteApi.POST, gamePath(table.code, 'vote'), { player: table.host, body: { sceneIndex: 0, choiceId: 'a' } });
  await settle();
  state = await view(table.code, table.host);
  assert.equal(sentencesOf(state.chronicle[0].outcome).length, 1, state.chronicle[0].outcome);
  assert.deepEqual(asides(state), [state.chronicle[0].outcome]);
});
