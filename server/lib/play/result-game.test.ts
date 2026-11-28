/** The turn's result (play/result.ts) in games played through the API handlers: where it is stored, and when it shows. */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

process.env.DD_FAKE_AI = '1';
delete process.env.DATABASE_URL;
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.DD_APP_KEY;
delete process.env.DD_FAKE_DELAY_MS;

import * as actionApi from '../../api/game-action.ts';
import * as advanceApi from '../../api/game-advance.ts';
import * as joinApi from '../../api/game-join.ts';
import * as rollApi from '../../api/game-roll.ts';
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
import { getStore, setStore } from '../store/index.ts';
import { MemoryStore } from '../store/memory.ts';
import type { GameState, TurnResult } from '../types.ts';

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

/** A fixed uuid, so a table is the same every run: a hero's sheet is rolled from its character's id (characters.ts). */
const fixedId = (kind: number, i: number) => `00000000-0000-4000-800${kind}-${String(i + 1).padStart(12, '0')}`;

/** A started game of `n` fighters, its opening scene written. */
async function table(n: number) {
  const players = Array.from({ length: n }, (_, i) => fixedId(0, i));
  const characters = await Promise.all(players.map((p, i) => makeCharacter(p, `Hero ${i + 1}`, { id: fixedId(1, i), race: 'human', characterClass: 'fighter' })));
  const { body } = await call<GameState>(gamesApi.POST, '/api/games', { player: players[0], body: { characterId: characters[0].id } });
  for (let i = 1; i < n; i++) await call(joinApi.POST, gamePath(body.code, 'join'), { player: players[i], body: { characterId: characters[i].id } });
  await call(startApi.POST, gamePath(body.code, 'start'), { player: players[0], body: { sceneCount: 4 } });
  await settle();
  return { code: body.code, players, host: players[0] };
}

const view = async (code: string, player: string) => (await call<GameState>(gameApi.GET, gamePath(code), { player })).body;
const vote = (code: string, player: string, sceneIndex: number, choiceId: string) => call<GameState>(voteApi.POST, gamePath(code, 'vote'), { player, body: { sceneIndex, choiceId } });

/** The fake DM, its first choice a parley with a goblin; it stops before writing scene `holdAt` until `release` is called. */
function talkingDM(holdAt: number) {
  let release = () => {};
  let arrived = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  const writing = new Promise<void>((resolve) => { arrived = resolve; });
  const withTalk = <T extends { choices: { label: string; detail: string; rules?: unknown }[] }>(scene: T): T =>
    ({ ...scene, choices: [{ label: 'Talk', detail: 'Try it.', rules: { kind: 'parley', monsters: ['goblin-warrior'] } }, ...scene.choices.slice(1)] });
  const dm: DungeonMaster = {
    ...fakeDungeonMaster,
    openingScene: async (ctx) => withTalk(await fakeDungeonMaster.openingScene(ctx)),
    nextScene: async (ctx, resolution) => {
      if (ctx.sceneIndex === holdAt) { arrived(); await held; }
      return withTalk(await fakeDungeonMaster.nextScene(ctx, resolution));
    },
  };
  return { dm, writing, release };
}

test('a resolved turn has its result: on the scene while the DM still writes, then on the chronicle\'s last entry, with every player among its heroes', async () => {
  const { code, players, host } = await table(3);
  const [p1, p2, p3] = players;
  // The road from the tavern (play/trek.ts): two scenes of it, everyone looking around.
  for (const scene of [0, 1]) {
    for (const p of players) await vote(code, p, scene, 'b');
    await settle();
    if (scene === 0) registerDungeonMaster('chronicler', talkingDM(-1).dm); // writes scene 2, where the road ends
  }
  let state = await view(code, host);
  assert.deepEqual([state.scene!.index, state.scene!.choices[0].rules, state.scene!.result], [2, 'Parley with Goblin Warrior', null], 'no result while the table is choosing');
  assert.ok(state.chronicle.every((entry) => entry.result !== null && entry.result.heroes.length === 3), 'each scene of the road has its own');

  const slow = talkingDM(3);
  registerDungeonMaster('chronicler', slow.dm);
  d20(17, 6, 4);
  await vote(code, p1, 2, 'a'); // Hero 1 picks the parley and shows a 17
  const acted = await call<GameState & { action: { spent: boolean; ruling: string } }>(actionApi.POST, gamePath(code, 'action'), { player: p2, body: { sceneIndex: 2, text: 'I watch the tree line' } });
  assert.deepEqual([acted.body.action.spent, acted.body.action.ruling], [true, 'check'], 'Hero 2 is busy with her own action');
  await vote(code, p3, 2, 'c'); // Hero 3 picks another choice with a 4: one pick each
  await call(rollApi.POST, gamePath(code, 'roll'), { player: p2, body: { sceneIndex: 2 } });

  await slow.writing; // the engine has played the turn; the DM has not written a word
  state = await view(code, p3);
  assert.deepEqual([state.status, state.scene!.index, state.scene!.outcome], ['resolving', 2, null]);
  const result = state.scene!.result!;
  assert.ok(result, 'the result is there before the outcome');
  assert.deepEqual(result.heroes.map((h) => h.playerId), players, 'every player, in joining order');
  assert.deepEqual([result.sceneIndex, result.combat], [2, false]);
  const { success, ...choice } = result.choice!;
  assert.deepEqual(choice, {
    id: 'a', label: 'Talk', rules: 'Parley with Goblin Warrior', backers: [p1], tally: { a: 1, b: 0, c: 1 },
    tie: { between: ['a', 'c'], playerId: p1, roll: 17 },
  });
  const [one, two, three] = result.heroes;
  assert.deepEqual([one.name, one.did, one.choiceId, one.label], ['Hero 1', 'choice', 'a', 'Talk']);
  assert.deepEqual(one.rolls.map((r) => [r.for, r.name, r.natural, r.fresh, r.against, r.success]), [['choice', 'Persuasion', 17, false, { kind: 'dc', value: 15 }, success]], 'the one who picked the parley rolled it, with the 17 she showed');
  assert.deepEqual([two.did, two.choiceId, two.label, two.text], ['own', undefined, 'Perception', 'I watch the tree line'], 'a written action is its hero\'s own, not a pick');
  assert.deepEqual(two.rolls.map((r) => [r.for, r.name, r.natural, r.fresh]), [['own', 'Perception', 6, false]], 'and her d20 went to it alone');
  assert.deepEqual([three.did, three.choiceId, three.label, three.rolls], ['choice', 'c', state.scene!.choices[2].label, []]);
  assert.ok(result.notes.some((l) => /^The (Goblin Warrior let the party be|talk goes badly)/.test(l)), result.notes.join(' | '));
  assert.equal(result.notes.some((l) => l.includes('Persuasion') || l.includes('Perception') || l.startsWith('+')), false, 'no dice line and no XP line among the notes');

  slow.release();
  await settle();
  state = await view(code, host);
  assert.equal(state.scene!.index, 3);
  assert.equal(state.scene!.result, null, 'the new scene has none yet');
  assert.deepEqual(state.chronicle.at(-1)!.result, result, 'the chronicle\'s last entry keeps the turn just played');
  assert.deepEqual(state.chronicle.map((entry) => entry.result?.sceneIndex), [0, 1, 2]);
  for (const line of result.heroes.flatMap((h) => h.lines)) assert.ok(state.rules!.results.includes(line), 'a hero\'s lines are the engine\'s own');
});

test('a turn the DM fumbles shows no result while the table chooses again; resolved again, it comes out the same', async () => {
  let fumble = true;
  let code = '';
  let first: TurnResult | null | undefined;
  registerDungeonMaster('chronicler', {
    ...fakeDungeonMaster,
    nextScene: async (ctx, r) => {
      if (!fumble) return fakeDungeonMaster.nextScene(ctx, r);
      first = (await getStore().getGame(code))!.scenes[0].result; // what the table is shown while the DM writes
      throw new Error('boom');
    },
  });
  const { players, host, ...started } = await table(2);
  code = started.code;
  d20(13, 8);
  for (const p of players) await vote(code, p, 0, 'a');
  await settle();
  let state = await view(code, host);
  assert.deepEqual([state.status, state.scene!.index, state.scene!.result, state.chronicle.length], ['voting', 0, null, 0], 'votes are open again: no result is shown');
  assert.ok(first, 'though the engine had played the turn before the DM fumbled');
  assert.equal((await getStore().getGame(code))!.scenes[0].result, null, 'the old dice are put away: the votes may change');
  assert.deepEqual(state.rules!.party.map((h) => h.xp), [0, 0], 'and nothing is paid for a turn that will be played again');

  fumble = false;
  await call(advanceApi.POST, gamePath(code, 'advance'), { player: host });
  await settle();
  state = await view(code, host);
  assert.equal(state.scene!.index, 1);
  assert.deepEqual(state.chronicle[0].result, first, 'the engine is seeded: the same votes give the same result');
  assert.deepEqual(first.heroes.map((h) => [h.playerId, h.did]), players.map((p) => [p, 'choice']));
  // The replayed turn is paid once: what the result says each hero earned is all they have.
  assert.ok(first.heroes.every((h) => h.xp && h.xp.total > 0), JSON.stringify(first.heroes.map((h) => h.xp)));
  assert.deepEqual(state.rules!.party.map((h) => h.xp), first.heroes.map((h) => h.xp!.total));
});

test('a game without the rules engine has no result', async () => {
  const { code, players, host } = await table(2);
  await getStore().updateGame(code, {}, { party: null, combat: null, dungeon: null });
  for (const p of players) await vote(code, p, 0, 'a');
  await settle();
  const state = await view(code, host);
  assert.deepEqual([state.scene!.index, state.scene!.result, state.chronicle.map((entry) => entry.result)], [1, null, [null]]);
  assert.equal((await getStore().getGame(code))!.scenes[0].result, null);
});

test('a combat round has its result too: no choice, each hero\'s action by name', async () => {
  const fighting: DungeonMaster = {
    ...fakeDungeonMaster,
    nextScene: async (ctx, r) => {
      const scene = await fakeDungeonMaster.nextScene(ctx, r);
      return { ...scene, choices: [{ label: 'Fight', detail: 'Draw steel.', rules: { kind: 'fight', monsters: ['goblin-warrior'] } }, ...scene.choices.slice(1)] };
    },
  };
  const { code, players, host } = await table(2);
  for (const scene of [0, 1]) {
    for (const p of players) await vote(code, p, scene, 'b');
    await settle();
    if (scene === 0) registerDungeonMaster('chronicler', fighting);
  }
  for (const p of players) await vote(code, p, 2, 'a');
  await settle();
  let state = await view(code, host);
  assert.equal(state.scene!.combat, true, state.rules!.results.join(' | '));
  assert.equal(state.chronicle.at(-1)!.result!.choice!.label, 'Fight', 'the turn that began the fight was a choice');
  const round = state.scene!.index;
  d20(15);
  await call(voteApi.POST, gamePath(code, 'vote'), { player: host, body: { sceneIndex: round, choiceId: 'a' } });
  await call(advanceApi.POST, gamePath(code, 'advance'), { player: host });
  await settle();
  state = await view(code, host);
  const entry = state.chronicle.find((e) => e.index === round)!;
  assert.deepEqual([entry.combat, entry.result!.combat, entry.result!.choice], [true, true, null]);
  const [mine, theirs] = entry.result!.heroes;
  assert.equal(mine.did, 'action');
  assert.match(mine.label!, /^(Attack with |Move closer)/);
  assert.deepEqual([theirs.did, theirs.label, theirs.rolls], ['nothing', undefined, []], 'a hero with no vote dodges by rule: that is not an action they took');
  for (const roll of mine.rolls) assert.deepEqual([roll.for, roll.against.kind], ['attack', 'ac']);
  assert.equal(entry.result!.notes.some((l) => l.startsWith('Hero 1 attacks ')), false, 'a hero\'s attack is under the hero, not in the notes');
});
