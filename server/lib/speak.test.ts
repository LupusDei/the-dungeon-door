import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, test } from 'node:test';

process.env.DD_FAKE_AI = '1';
delete process.env.DATABASE_URL;
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.DD_APP_KEY;
delete process.env.DD_FAKE_DELAY_MS;

import * as gameApi from '../api/game.ts';
import * as gamesApi from '../api/games.ts';
import * as joinApi from '../api/game-join.ts';
import * as speakApi from '../api/game-speak.ts';
import * as startApi from '../api/game-start.ts';
import * as voteApi from '../api/game-vote.ts';
import * as advanceApi from '../api/game-advance.ts';
import { call, gamePath, makeCharacter } from './api.fixture.ts';
import { settle } from './background.ts';
import { fakeDungeonMaster } from './dm/fake.ts';
import { registerDungeonMaster, unregisterDungeonMaster } from './dm/registry.ts';
import type { DungeonMaster } from './dm/types.ts';
import { MemoryStore } from './store/memory.ts';
import { setStore } from './store/index.ts';
import type { GameState } from './types.ts';

async function table(n: number) {
  const players = Array.from({ length: n }, () => randomUUID());
  const characters = await Promise.all(players.map((p, i) => makeCharacter(p, `Hero ${i + 1}`)));
  const created = await call<GameState>(gamesApi.POST, '/api/games', { player: players[0], body: { characterId: characters[0].id } });
  const code = created.body.code;
  for (let i = 1; i < n; i++) await call(joinApi.POST, gamePath(code, 'join'), { player: players[i], body: { characterId: characters[i].id } });
  return { code, players, host: players[0] };
}

const view = async (code: string, player: string) =>
  (await call<GameState>(gameApi.GET, gamePath(code), { player })).body;

beforeEach(() => setStore(new MemoryStore()));
afterEach(async () => {
  await settle();
  unregisterDungeonMaster('chronicler');
});

test('a player can speak or act in character, with no roll, and it stays on the turn', async () => {
  const { code, players, host } = await table(2);
  const outsider = randomUUID();
  assert.equal((await call(speakApi.POST, gamePath(code, 'speak'), { player: host, body: { text: 'hello' } })).status, 409, 'not until a scene is open');

  await call(startApi.POST, gamePath(code, 'start'), { player: host, body: { sceneCount: 3 } });
  await settle();

  assert.equal((await call(speakApi.POST, gamePath(code, 'speak'), { player: host, body: { text: '   ' } })).status, 400);
  assert.equal((await call(speakApi.POST, gamePath(code, 'speak'), { player: outsider, body: { text: 'hi' } })).status, 403);

  const spoken = await call<GameState>(speakApi.POST, gamePath(code, 'speak'), { player: players[1], body: { text: '  We come in peace.  ' } });
  assert.equal(spoken.status, 200);
  assert.deepEqual(spoken.body.scene?.roleplay, [{ playerId: players[1], characterName: 'Hero 2', text: 'We come in peace.' }]);
  const deed = await call<GameState>(speakApi.POST, gamePath(code, 'speak'), { player: host, body: { text: 'sets the hiccuping staff on the bar' } });
  assert.deepEqual(deed.body.scene?.roleplay.map((line) => line.text), ['We come in peace.', 'sets the hiccuping staff on the bar']);

  await call(voteApi.POST, gamePath(code, 'vote'), { player: host, body: { sceneIndex: 0, choiceId: 'a' } });
  await call(advanceApi.POST, gamePath(code, 'advance'), { player: host });
  await settle();
  const state = await view(code, host);
  assert.deepEqual(state.chronicle[0].roleplay.map((line) => line.text), ['We come in peace.', 'sets the hiccuping staff on the bar']);
  assert.deepEqual(state.scene?.roleplay, []);
});

test('a fake DM that speaks for a hero is asked again, and the stolen line does not survive', async () => {
  let attempts = 0;
  let heard: string[] = [];
  const dm: DungeonMaster = {
    openingScene: (ctx) => fakeDungeonMaster.openingScene(ctx),
    nextScene: async (ctx, resolution) => {
      attempts++;
      heard = (resolution.scene.roleplay ?? []).map((line) => `${line.characterName}: ${line.text}`);
      const scene = await fakeDungeonMaster.nextScene(ctx, resolution);
      const narration = attempts === 1
        ? 'Hero 1 says, "I draw my sword." The innkeeper eyes you warily.'
        : 'The innkeeper eyes you warily. What do you say?';
      return { ...scene, narration };
    },
    finale: (ctx, resolution) => fakeDungeonMaster.finale(ctx, resolution),
  };
  registerDungeonMaster('chronicler', dm);
  const { code, players, host } = await table(1);
  await call(startApi.POST, gamePath(code, 'start'), { player: host, body: { sceneCount: 3 } });
  await settle();
  await call(speakApi.POST, gamePath(code, 'speak'), { player: host, body: { text: 'We come in peace.' } });
  await call(voteApi.POST, gamePath(code, 'vote'), { player: host, body: { sceneIndex: 0, choiceId: 'b' } });
  await settle();

  assert.deepEqual(heard, ['Hero 1: We come in peace.']);
  assert.equal(attempts, 2, 'the stolen draft was sent back');
  const state = await view(code, players[0]);
  assert.equal(state.scene?.narration, 'The innkeeper eyes you warily. What do you say?');
  assert.equal(state.scene?.narration.includes('I draw my sword'), false);
});

test('when the fake DM keeps speaking for a hero, that sentence is stripped and the world remains', async () => {
  let attempts = 0;
  const dm: DungeonMaster = {
    openingScene: (ctx) => fakeDungeonMaster.openingScene(ctx),
    async nextScene(ctx, resolution) {
      attempts++;
      const scene = await fakeDungeonMaster.nextScene(ctx, resolution);
      return {
        ...scene,
        narration: 'Hero 1 says, "I hate goblins." The staff hiccups. What do you do?',
        outcome: 'Hero 1 whispers, "Let us burn it." The door opens.',
        quip: 'Hero 1 shouts, "Never!" Onward, in my own voice.',
      };
    },
    finale: (ctx, resolution) => fakeDungeonMaster.finale(ctx, resolution),
  };
  registerDungeonMaster('chronicler', dm);
  const { code, host } = await table(1);
  await call(startApi.POST, gamePath(code, 'start'), { player: host, body: { sceneCount: 3 } });
  await settle();
  await call(voteApi.POST, gamePath(code, 'vote'), { player: host, body: { sceneIndex: 0, choiceId: 'a' } });
  await settle();

  assert.equal(attempts, 2);
  const state = await view(code, host);
  assert.equal(state.scene?.narration, 'The staff hiccups. What do you do?');
  assert.equal(state.chronicle[0].outcome, 'The door opens.');
  assert.equal(state.messages.some((m) => m.kind === 'dm' && m.text.includes('Let us burn it')), false);
  assert.equal(state.messages.some((m) => m.kind === 'dm' && m.text.includes('Never!')), false);
  assert.equal(state.messages.some((m) => m.kind === 'dm' && m.text.includes('Onward, in my own voice.')), true);
});
