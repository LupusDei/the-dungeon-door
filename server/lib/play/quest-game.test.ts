/**
 * The quest through the API: the goal ends the adventure when it is reached; the scene count is pacing, with
 * as many scenes again before the ending is called (play/quest.ts).
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

process.env.DD_FAKE_AI = '1';
delete process.env.DATABASE_URL;
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.DD_APP_KEY;
delete process.env.DD_FAKE_DELAY_MS;

import * as endingApi from '../../api/game-ending.ts';
import * as joinApi from '../../api/game-join.ts';
import * as startApi from '../../api/game-start.ts';
import * as voteApi from '../../api/game-vote.ts';
import * as gameApi from '../../api/game.ts';
import * as gamesApi from '../../api/games.ts';
import { call, gamePath, makeCharacter } from '../api.fixture.ts';
import { settle } from '../background.ts';
import { fakeDungeonMaster } from '../dm/fake.ts';
import { registerDungeonMaster, unregisterDungeonMaster } from '../dm/registry.ts';
import type { DMContext, DungeonMaster } from '../dm/types.ts';
import { setDice } from '../game.ts';
import { getStore, setStore } from '../store/index.ts';
import { MemoryStore } from '../store/memory.ts';
import type { GameState } from '../types.ts';

beforeEach(() => {
  setStore(new MemoryStore());
  setDice({ d20: () => 20, seed: () => 42 }); // every roll a 20: the heroes win what they fight, and talk their way past
});
afterEach(async () => {
  await settle();
  unregisterDungeonMaster('chronicler');
  setDice();
});

const fixedId = (kind: number, i: number) => `00000000-0000-4000-800${kind}-${String(i + 1).padStart(12, '0')}`;

async function table(n: number) {
  const players = Array.from({ length: n }, (_, i) => fixedId(0, i));
  const characters = await Promise.all(players.map((p, i) => makeCharacter(p, `Hero ${i + 1}`, { id: fixedId(1, i), race: 'human', characterClass: 'fighter' })));
  const { body } = await call<GameState>(gamesApi.POST, '/api/games', { player: players[0], body: { characterId: characters[0].id } });
  for (let i = 1; i < n; i++) await call(joinApi.POST, gamePath(body.code, 'join'), { player: players[i], body: { characterId: characters[i].id } });
  return { code: body.code, players, host: players[0] };
}

const view = async (code: string, player: string) => (await call<GameState>(gameApi.GET, gamePath(code), { player })).body;
async function begin(code: string, host: string, body: Record<string, unknown>) {
  await call(startApi.POST, gamePath(code, 'start'), { player: host, body: { sceneCount: 4, ...body } });
  await settle();
}
async function voteAll(code: string, players: string[], sceneIndex: number, choiceId: string) {
  for (const player of players) await call(voteApi.POST, gamePath(code, 'vote'), { player, body: { sceneIndex, choiceId } });
  await settle();
}

/** Plays until the game ends (or `until` says stop), choosing with `pick`; every scene seen, in order. */
async function play(code: string, players: string[], pick: (s: GameState) => string, until = (_: GameState) => false): Promise<GameState[]> {
  const seen: GameState[] = [];
  for (let state = await view(code, players[0]); ; state = await view(code, players[0])) {
    seen.push(state);
    if (state.status !== 'voting' || until(state) || seen.length > 40) return seen;
    await voteAll(code, players, state.scene!.index, pick(state));
  }
}

/** Fight what is fought, talk to what waits, else the first choice. */
const boldly = (s: GameState) => (s.scene!.combat ? 'a' : s.rules!.dungeon?.waiting ? 'c' : 'a');

/** A DM whose first choice is this hook (given what it is told), and whose third is a parley with foes waiting. */
function hookingDM(hook: (ctx: DMContext) => unknown): DungeonMaster {
  const hooked = <T extends { choices: { label: string; detail: string; rules?: unknown }[] }>(ctx: DMContext, scene: T): T => {
    const first = ctx.rules && !ctx.rules.trek ? hook(ctx) : undefined;
    if (first === undefined) return scene;
    const third = ctx.rules!.dungeon?.waiting ? [{ label: 'Talk', detail: 'Talk.', rules: { kind: 'parley' } }] : scene.choices.slice(2);
    return { ...scene, choices: [{ label: 'On', detail: 'On.', rules: first }, scene.choices[1], ...third] };
  };
  return {
    openingScene: async (ctx) => hooked(ctx, await fakeDungeonMaster.openingScene(ctx)),
    nextScene: async (ctx, r) => hooked(ctx, await fakeDungeonMaster.nextScene(ctx, r)),
    finale: fakeDungeonMaster.finale,
  };
}

/** Walks a fixed map's main path to room `goal`: the highest-numbered way on, short of passing it. */
const pathTo = (goal: string) => hookingDM((ctx) => {
  const ways = (ctx.rules!.dungeon?.exits ?? []).map((x) => x.id).filter((id) => Number(id.slice(1)) <= Number(goal.slice(1)));
  return ways.length ? { kind: 'move', exit: ways.sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)))[0] } : null;
});

const questOf = async (code: string) => (await getStore().getGame(code))!.party!.quest!;

test('a fixed map: the party walks the shortest way to the goal room, deals with its foes, and the epilogue follows', async () => {
  const { code, players, host } = await table(2);
  await begin(code, host, { dungeon: 'fixed' });
  const quest = await questOf(code);
  assert.equal(quest.at, 'r2', 'four scenes: the door, a room on, the goal, the epilogue');
  registerDungeonMaster('chronicler', pathTo(quest.at!));
  const opened = await view(code, host);
  assert.deepEqual(opened.rules!.quest, { kind: quest.kind, goal: opened.rules!.quest!.goal, reached: false, where: opened.rules!.quest!.where });
  assert.match(opened.rules!.quest!.where!, /^in the /);
  const seen = await play(code, players, (s) => (s.rules!.trek ? 'b' : boldly(s)));
  const end = seen.at(-1)!;
  assert.equal(end.status, 'ended');
  assert.equal(end.rules!.quest!.reached, true);
  assert.ok(end.rules!.dungeon!.areas.find((a) => a.id === 'r2')!.cleared);
  const done = seen.findIndex((s) => s.rules!.results.some((l) => l.startsWith('The quest is done: ')));
  assert.equal(done, seen.length - 1, 'the scene after the goal is the epilogue');
  assert.ok(end.rules!.results.includes(`The quest is done: ${end.rules!.quest!.goal}.`));
});

test('a tale told: the DM’s goal hook brings on the goal’s foes; beating them reaches it, and the epilogue follows at once', async () => {
  const { code, players, host } = await table(2);
  await begin(code, host, { sceneCount: 6 });
  registerDungeonMaster('chronicler', hookingDM(() => ({ kind: 'goal' })));
  const seen = await play(code, players, (s) => (s.rules!.trek ? 'b' : 'a'));
  const end = seen.at(-1)!;
  assert.deepEqual([end.status, end.rules!.quest!.reached], ['ended', true]);
  assert.ok(end.progress!.part === 'tale' && end.progress!.scene < 6, `reached before the plan: ${JSON.stringify(end.progress)}`);
  assert.deepEqual(end.progress, { part: 'tale', scene: end.progress!.scene, of: end.progress!.scene }, 'the count is the scenes played');
  assert.equal(seen.at(-2)!.scene!.combat, true, 'the goal was a fight');
});

test('a tale told past its plan: the count is about so many, the first choice faces the goal, and twice the plan calls the ending', async () => {
  const { code, players, host } = await table(2);
  await begin(code, host, { sceneCount: 3 });
  const seen = await play(code, players, (s) => (s.scene!.combat ? 'a' : 'b'));
  const tale = seen.filter((s) => s.progress?.part === 'tale');
  assert.deepEqual(tale.slice(0, 4).map((s) => s.progress), [1, 2, 3, 4].map((scene) => ({ part: 'tale', scene, of: 3, about: true })));
  assert.deepEqual(tale.slice(0, 4).map((s) => s.scenesLeft), [1, null, null, null], 'no count from the plan’s last scene on: the goal may take longer');
  assert.ok(tale.slice(2, -1).every((s) => s.scene!.choices[0].label === 'Face the goal'), 'past the plan, the goal is always on offer');
  const end = seen.at(-1)!;
  assert.deepEqual([end.status, end.rules!.quest!.reached, end.progress], ['ended', false, { part: 'tale', scene: 6, of: 6 }], 'the ending at twice the plan');
});

test('the host calls the ending past the plan: the next scene is the epilogue', async () => {
  const { code, players, host } = await table(1);
  await begin(code, host, { sceneCount: 2 });
  await play(code, players, (s) => (s.scene!.combat ? 'a' : 'b'), (s) => s.progress?.part === 'tale' && s.progress.scene === 3);
  assert.equal((await call(endingApi.POST, gamePath(code, 'ending'), { player: host })).status, 200);
  const at = (await view(code, host)).scene!.index;
  await voteAll(code, players, at, 'b');
  const end = await view(code, host);
  assert.deepEqual([end.status, end.scene!.index, end.rules!.quest!.reached], ['ended', at + 1, false]);
});

test('explore mode: the goal is found in the first room entered once the party is far enough in', async () => {
  const { code, players, host } = await table(2);
  await begin(code, host, { dungeon: 'explore', sceneCount: 3 });
  registerDungeonMaster('chronicler', hookingDM((ctx) => {
    const ways = ctx.rules!.dungeon?.exits.filter((x) => x.leadsTo === null) ?? [];
    return ways.length ? { kind: 'move', exit: ways[0].id } : null;
  }));
  const seen = await play(code, players, (s) => (s.rules!.trek ? 'b' : boldly(s)), (s) => s.rules!.quest!.where !== 'deeper in the dungeon');
  const found = seen.at(-1)!;
  assert.match(found.rules!.quest!.where!, /^in the /, `found: ${found.rules!.quest!.where}`);
  assert.ok(found.rules!.dungeon!.areas.length >= 2, 'not at the door');
});

test('a game with no set length has no quest', async () => {
  const { code, host } = await table(1);
  await begin(code, host, { sceneCount: 0 });
  assert.equal((await view(code, host)).rules!.quest, null);
});
