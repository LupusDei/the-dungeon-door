/** A player writes their own action, classified by the fake DM and rolled by the engine. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, test } from 'node:test';

process.env.DD_FAKE_AI = '1';
delete process.env.DATABASE_URL;
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.DD_APP_KEY;
delete process.env.DD_FAKE_DELAY_MS;

import * as actionApi from '../../api/game-action.ts';
import * as joinApi from '../../api/game-join.ts';
import * as startApi from '../../api/game-start.ts';
import * as voteApi from '../../api/game-vote.ts';
import * as gameApi from '../../api/game.ts';
import * as gamesApi from '../../api/games.ts';
import { call, gamePath, makeCharacter } from '../api.fixture.ts';
import { settle } from '../background.ts';
import { fakeDungeonMaster } from '../dm/fake.ts';
import { registerDungeonMaster, unregisterDungeonMaster } from '../dm/registry.ts';
import type { DungeonMaster } from '../dm/types.ts';
import { setDice } from '../game.ts';
import { UNREADABLE } from './actions.ts';
import { getStore, setStore } from '../store/index.ts';
import { MemoryStore } from '../store/memory.ts';
import type { GameState } from '../types.ts';

let rolls: number[] = [];
const d20 = (...next: number[]) => { rolls = next; };

beforeEach(() => {
  setStore(new MemoryStore());
  setDice({ d20: () => rolls.shift() ?? 10, seed: () => 42 });
});
afterEach(async () => {
  await settle();
  unregisterDungeonMaster('chronicler');
  setDice();
});

async function table(n: number) {
  const players = Array.from({ length: n }, () => randomUUID());
  const characters = await Promise.all(players.map((p, i) => makeCharacter(p, `Hero ${i + 1}`, { race: 'human', characterClass: 'fighter' })));
  const { body } = await call<GameState>(gamesApi.POST, '/api/games', { player: players[0], body: { characterId: characters[0].id } });
  for (let i = 1; i < n; i++) await call(joinApi.POST, gamePath(body.code, 'join'), { player: players[i], body: { characterId: characters[i].id } });
  await call(startApi.POST, gamePath(body.code, 'start'), { player: players[0], body: { sceneCount: 4 } });
  await settle();
  return { code: body.code, players, host: players[0] };
}

const view = async (code: string, player: string) => (await call<GameState>(gameApi.GET, gamePath(code), { player })).body;

test('kicking the brazier is a check in the dice log, and it does not pick the party\'s choice', async () => {
  d20(15, 2);
  const { code, players, host } = await table(2);
  const acted = await call<GameState & { action: { spent: boolean; ruling: string; roll: number; choiceId: null } }>(
    actionApi.POST, gamePath(code, 'action'), { player: host, body: { sceneIndex: 0, text: 'I kick the brazier onto the goblins' } },
  );
  assert.equal(acted.status, 200);
  assert.deepEqual([acted.body.action.spent, acted.body.action.ruling, acted.body.action.roll, acted.body.action.choiceId], [true, 'check', 15, null]);
  assert.deepEqual(acted.body.scene!.actions, [{ playerId: host, text: 'I kick the brazier onto the goblins', roll: 15 }]);
  assert.equal(acted.body.scene!.myVote, null);
  assert.equal(acted.body.scene!.votes.length, 0, 'a written check is not a vote for a choice');

  await call(voteApi.POST, gamePath(code, 'vote'), { player: players[1], body: { sceneIndex: 0, choiceId: 'c' } });
  await settle();
  const state = await view(code, host);
  assert.equal(state.scene!.index, 1);
  assert.equal(state.chronicle[0].choiceLabel, 'Parley first', 'the written check did not count as choice a');
  const lines = state.rules!.results.join('\n');
  assert.match(lines, /Hero 1 \("I kick the brazier onto the goblins"\): Athletics 15 \+ -?\d+ = \d+ vs DC 15, (success|failure)/);
  assert.ok(state.messages.some((m) => m.kind === 'system' && m.text.includes('vs DC 15')), 'the d20 is in the dice log');
});

test('an impossible action does not spend the turn, and a bad classification falls back the same way', async () => {
  const { code, host } = await table(1);
  const moon = await call<GameState & { action: { spent: boolean; narration: string } }>(
    actionApi.POST, gamePath(code, 'action'), { player: host, body: { sceneIndex: 0, text: 'I fly to the moon' } },
  );
  assert.equal(moon.body.action.spent, false);
  assert.equal(moon.body.action.narration, 'That cannot be done.');
  assert.equal(moon.body.status, 'voting');
  assert.equal(moon.body.scene!.myVote, null);
  assert.ok(moon.body.messages.some((m) => m.kind === 'system' && m.text.includes('That cannot be done.')));

  const again = await call<GameState & { action: { ruling: string; choiceId: string } }>(
    actionApi.POST, gamePath(code, 'action'), { player: host, body: { sceneIndex: 0, text: 'Charge straight in' } },
  );
  assert.equal(again.body.action.ruling, 'known');
  assert.equal(again.body.action.choiceId, 'a', 'the words map onto today\'s first choice');
});

test('a classification the engine cannot read does not spend the turn', async () => {
  const dm: DungeonMaster = {
    openingScene: (ctx) => fakeDungeonMaster.openingScene(ctx),
    nextScene: (ctx, resolution) => fakeDungeonMaster.nextScene(ctx, resolution),
    finale: (ctx, resolution) => fakeDungeonMaster.finale(ctx, resolution),
    classifyAction: async () => ({ kind: 'nope' }),
  };
  registerDungeonMaster('chronicler', dm);
  const { code, host } = await table(1);
  const acted = await call<GameState & { action: { spent: boolean; narration: string } }>(
    actionApi.POST, gamePath(code, 'action'), { player: host, body: { sceneIndex: 0, text: 'I kick the brazier onto the goblins' } },
  );
  assert.equal(acted.body.action.spent, false);
  assert.equal(acted.body.action.narration, UNREADABLE);
  assert.equal(acted.body.status, 'voting');
  assert.equal((await call(actionApi.POST, gamePath(code, 'action'), { player: host, body: { sceneIndex: 0, text: '' } })).status, 400);
});
