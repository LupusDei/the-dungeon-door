import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, test } from 'node:test';

// Offline, in-memory, no app key — whatever the shell has set.
process.env.DD_FAKE_AI = '1';
delete process.env.DATABASE_URL;
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.DD_APP_KEY;
delete process.env.DD_FAKE_DELAY_MS;

import * as endingApi from '../api/game-ending.ts';
import * as joinApi from '../api/game-join.ts';
import * as startApi from '../api/game-start.ts';
import * as voteApi from '../api/game-vote.ts';
import * as gameApi from '../api/game.ts';
import * as gamesApi from '../api/games.ts';
import { call, gamePath, makeCharacter, withoutQuest } from './api.fixture.ts';
import { settle } from './background.ts';
import { fakeDungeonMaster } from './dm/fake.ts';
import { registerDungeonMaster, unregisterDungeonMaster } from './dm/registry.ts';
import type { DungeonMaster } from './dm/types.ts';
import { setDice } from './game.ts';
import { hasNoSetLength, NO_SET_LENGTH, scenesLeft } from './length.ts';
import { MemoryStore } from './store/memory.ts';
import { getStore, setStore } from './store/index.ts';
import type { GameState, Message } from './types.ts';

beforeEach(() => {
  setStore(new MemoryStore());
  setDice({ d20: () => 15, seed: () => 5 }); // a quiet road from the tavern
});
afterEach(async () => {
  await settle();
  setDice();
  unregisterDungeonMaster('chronicler');
});

async function table(n = 2) {
  const players = Array.from({ length: n }, () => randomUUID());
  const heroes = await Promise.all(players.map((p, i) => makeCharacter(p, `Hero ${i + 1}`)));
  const created = await call<GameState>(gamesApi.POST, '/api/games', { player: players[0], body: { characterId: heroes[0].id } });
  const code = created.body.code;
  for (let i = 1; i < n; i++) await call(joinApi.POST, gamePath(code, 'join'), { player: players[i], body: { characterId: heroes[i].id } });
  const view = async (player = players[0]) => (await call<GameState>(gameApi.GET, gamePath(code), { player })).body;
  /** Everyone votes "a" on the scene being played, and the table waits for what comes of it. */
  const turn = async () => {
    const at = (await view()).scene!.index;
    for (const player of players) await call(voteApi.POST, gamePath(code, 'vote'), { player, body: { sceneIndex: at, choiceId: 'a' } });
    await settle();
    return view();
  };
  return { code, players, host: players[0], view, turn };
}

test('scenes left: the scenes with choices still to come before the epilogue', () => {
  // Five scenes: 0 to 3 have choices, 4 is the epilogue.
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => scenesLeft(5, i)), [3, 2, 1, 0, 0]);
  assert.equal(scenesLeft(5, -1), null, 'not begun');
  assert.equal(scenesLeft(NO_SET_LENGTH, 0), null, 'no set length');
  assert.equal(scenesLeft(NO_SET_LENGTH + 7, 40), null, 'a fight has added rounds to it');
  assert.equal(hasNoSetLength(NO_SET_LENGTH), true);
  assert.equal(hasNoSetLength(60), false);
});

test('a game with a set length counts its scenes down to the epilogue', async () => {
  const { code, host, view, turn } = await table();
  let state = await view();
  assert.equal(state.scenesLeft, null, 'nothing to count in the lobby');
  assert.equal(state.openEnded, false);
  assert.equal((await call(startApi.POST, gamePath(code, 'start'), { player: host, body: { sceneCount: 9 } })).status, 400);
  assert.equal((await call(startApi.POST, gamePath(code, 'start'), { player: host, body: { sceneCount: 1 } })).status, 400);
  await call(startApi.POST, gamePath(code, 'start'), { player: host, body: { sceneCount: 3 } });
  await settle();
  await withoutQuest(code); // past the plan a quest's count is none: play/quest-game.test.ts
  state = await view();
  assert.equal(state.sceneCount, 5, 'three asked for, and the two stretches of road');
  const seen: (number | null)[] = [state.scenesLeft];
  while (state.status !== 'ended' && seen.length < 20) {
    state = await turn();
    // A fight's rounds add scenes as they go, so the count never drops by more than one a scene.
    seen.push(state.scenesLeft);
  }
  assert.equal(state.status, 'ended');
  assert.equal(seen[0], 3);
  assert.equal(seen.at(-1), 0, 'the epilogue');
  assert.equal(seen.at(-2), 0, 'the last scene with choices');
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i]! <= seen[i - 1]! && seen[i - 1]! - seen[i]! <= 1, `counts down a scene at a time: ${seen.join(', ')}`);
});

test('a game with no set length goes on until its host calls the ending', async () => {
  const told: { index: number; openEnded: boolean | undefined; sceneCount: number }[] = [];
  let finale = 0;
  const watching: DungeonMaster = {
    openingScene: async (ctx) => (told.push({ index: ctx.sceneIndex, openEnded: ctx.openEnded, sceneCount: ctx.sceneCount }), fakeDungeonMaster.openingScene(ctx)),
    nextScene: async (ctx, r) => (told.push({ index: ctx.sceneIndex, openEnded: ctx.openEnded, sceneCount: ctx.sceneCount }), fakeDungeonMaster.nextScene(ctx, r)),
    finale: async (ctx, r) => (finale++, told.push({ index: ctx.sceneIndex, openEnded: ctx.openEnded, sceneCount: ctx.sceneCount }), fakeDungeonMaster.finale(ctx, r)),
  };
  registerDungeonMaster('chronicler', watching);
  const { code, players, host, view, turn } = await table();
  assert.equal((await call(endingApi.POST, gamePath(code, 'ending'), { player: host, body: {} })).status, 409, 'nothing to end in the lobby');

  await call(startApi.POST, gamePath(code, 'start'), { player: host, body: { sceneCount: 0 } });
  await settle();
  let state = await view();
  assert.equal(state.status, 'voting');
  assert.equal(state.openEnded, true);
  assert.equal(state.sceneCount, 0, 'no number to show');
  assert.equal(state.scenesLeft, null);

  // Well past the longest set length (eight scenes and the road), and still going.
  for (let i = 0; i < 14; i++) state = await turn();
  assert.equal(state.status, 'voting', 'fourteen turns in');
  assert.ok(state.scene!.index >= 14);
  assert.equal(state.openEnded, true);
  assert.equal(finale, 0);
  assert.ok(told.every((t) => t.openEnded === true), 'the dungeon master is told there is no set length');

  // Only the host ends it.
  assert.equal((await call(endingApi.POST, gamePath(code, 'ending'), { player: players[1], body: {} })).status, 403);
  const called = await call<GameState>(endingApi.POST, gamePath(code, 'ending'), { player: host, body: {} });
  assert.equal(called.status, 200, JSON.stringify(called.body));
  assert.equal(called.body.openEnded, false);
  assert.equal(called.body.scenesLeft, 0, 'this scene is the last');
  assert.equal(called.body.sceneCount, called.body.scene!.index + 2, 'this scene, then the epilogue');
  const calls = (s: GameState) => s.messages.filter((m: Message) => m.kind === 'system' && /has called the ending/.test(m.text)).length;
  assert.equal(calls(await view()), 1);
  await call(endingApi.POST, gamePath(code, 'ending'), { player: host, body: {} });
  assert.equal(calls(await view()), 1, 'calling it twice says it once');

  const before = state.scene!.index;
  state = await turn();
  assert.equal(state.status, 'ended');
  assert.equal(state.scene!.isFinale, true);
  assert.equal(state.scene!.index, before + 1, 'the epilogue follows the scene it was called in');
  assert.equal(finale, 1);
  assert.equal(told.at(-1)!.openEnded, false, 'the epilogue is written knowing it is the end');
  assert.equal((await call(endingApi.POST, gamePath(code, 'ending'), { player: host, body: {} })).status, 409, 'it has ended');
  assert.ok(hasNoSetLength((await getStore().getGame(code))!.sceneCount) === false);
});

test('the host can call the ending of a game with a set length, to cut it short', async () => {
  const { code, host, view, turn } = await table();
  await call(startApi.POST, gamePath(code, 'start'), { player: host, body: { sceneCount: 8 } });
  await settle();
  let state = await view();
  assert.equal(state.scenesLeft, 8);
  state = (await call<GameState>(endingApi.POST, gamePath(code, 'ending'), { player: host, body: {} })).body;
  assert.equal(state.scenesLeft, 0);
  state = await turn();
  assert.equal(state.status, 'ended');
});
