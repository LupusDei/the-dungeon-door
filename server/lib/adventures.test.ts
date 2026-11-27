import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, test } from 'node:test';

// Offline, in-memory, no app key — whatever the shell has set.
process.env.DD_FAKE_AI = '1';
delete process.env.DATABASE_URL;
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.DD_APP_KEY;
delete process.env.DD_FAKE_DELAY_MS;

import * as adventuresApi from '../api/adventures.ts';
import * as joinApi from '../api/game-join.ts';
import * as leaveApi from '../api/game-leave.ts';
import * as startApi from '../api/game-start.ts';
import * as voteApi from '../api/game-vote.ts';
import * as gameApi from '../api/game.ts';
import * as gamesApi from '../api/games.ts';
import type { AdventureView } from './adventures.ts';
import { call, gamePath, makeCharacter } from './api.fixture.ts';
import { settle } from './background.ts';
import { setDice } from './game.ts';
import { MemoryStore } from './store/memory.ts';
import { getStore, setStore } from './store/index.ts';
import type { Character, GameState } from './types.ts';

beforeEach(() => {
  setStore(new MemoryStore());
  setDice({ d20: () => 15, seed: () => 5 }); // a quiet road from the tavern
});
afterEach(async () => {
  await settle();
  setDice();
});

const adventures = async (player: string, query = '') =>
  (await call<{ adventures: AdventureView[] }>(adventuresApi.GET, `/api/adventures${query}`, { player })).body.adventures;

/** A door with these heroes behind it, still in the lobby. */
async function lobby(seats: { player: string; hero: Character }[]): Promise<string> {
  const [host, ...rest] = seats;
  const created = await call<GameState>(gamesApi.POST, '/api/games', { player: host.player, body: { characterId: host.hero.id } });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  for (const seat of rest) {
    const joined = await call(joinApi.POST, gamePath(created.body.code, 'join'), { player: seat.player, body: { characterId: seat.hero.id } });
    assert.equal(joined.status, 200, JSON.stringify(joined.body));
  }
  return created.body.code;
}

/** Opens the door and votes "a" for everyone until the epilogue (or `stopAfter` scenes have resolved). */
async function play(code: string, players: string[], stopAfter = Infinity): Promise<GameState> {
  await call(startApi.POST, gamePath(code, 'start'), { player: players[0], body: { sceneCount: 3 } });
  await settle();
  const view = async () => (await call<GameState>(gameApi.GET, gamePath(code), { player: players[0] })).body;
  let state = await view();
  for (let turn = 0; turn < 40 && state.status !== 'ended' && state.chronicle.length < stopAfter; turn++) {
    const at = state.scene!.index;
    for (const player of players) await call(voteApi.POST, gamePath(code, 'vote'), { player, body: { sceneIndex: at, choiceId: 'a' } });
    await settle();
    state = await view();
  }
  return state;
}

test('a finished adventure is listed for each hero who went on it: its pictures, its ending and how the hero came out', async () => {
  const [ann, ben, stranger] = [randomUUID(), randomUUID(), randomUUID()];
  const maud = await makeCharacter(ann, 'Maud');
  const other = await makeCharacter(ann, 'Sister Wren');
  const corin = await makeCharacter(ben, 'Corin');
  assert.deepEqual(await adventures(ann), [], 'nothing yet');

  const code = await lobby([{ player: ann, hero: maud }, { player: ben, hero: corin }]);
  assert.deepEqual(await adventures(ann), [], 'a door that has not opened is not an adventure');

  const ended = await play(code, [ann, ben]);
  assert.equal(ended.status, 'ended');

  const [mine, ...rest] = await adventures(ann);
  assert.equal(rest.length, 0);
  assert.equal(mine.code, code);
  assert.equal(mine.ended, true);
  assert.equal(mine.status, 'ended');
  assert.equal(mine.title, ended.title);
  assert.ok(mine.title, 'the dungeon master named it');
  assert.deepEqual(mine.hero, { characterId: maud.id, name: 'Maud', portraitUrl: maud.portraitUrl ?? null });
  assert.deepEqual(mine.party, ['Corin']);
  assert.equal(mine.scenes, ended.chronicle.length + 1, 'every resolved scene, and the epilogue');
  assert.ok(mine.images.length > 0 && mine.images.every((url) => typeof url === 'string' && url.length > 0), JSON.stringify(mine.images));
  assert.equal(new Set(mine.images).size >= 1 && mine.images.every((url, i) => url !== mine.images[i - 1]), true, 'no picture twice in a row');
  assert.equal(mine.ending, ended.scene!.narration, 'the epilogue');
  assert.ok(mine.result, 'a rules game says how the hero came out');
  assert.equal(mine.result!.level, ended.rules!.party.find((h) => h.playerId === ann)!.level);
  assert.equal(mine.result!.fell, false);
  assert.ok(mine.result!.xpGained >= 0 && mine.result!.levelsGained >= 0);
  assert.ok(mine.startedAt <= mine.lastPlayedAt);

  // The same adventure from the other seat: their hero, and the first as company.
  const [theirs] = await adventures(ben);
  assert.equal(theirs.hero.name, 'Corin');
  assert.deepEqual(theirs.party, ['Maud']);

  // By hero: the one who went has it, the one who stayed home does not. Nobody else sees it.
  assert.equal((await adventures(ann, `?characterId=${maud.id}`)).length, 1);
  assert.deepEqual(await adventures(ann, `?characterId=${other.id}`), []);
  assert.deepEqual(await adventures(stranger), []);
  assert.equal((await call(adventuresApi.GET, '/api/adventures')).status, 401, 'a player id is required');
});

test('adventures are listed most recently played first; one still going is not ended, and one walked out of is gone', async () => {
  const [ann, ben] = [randomUUID(), randomUUID()];
  const maud = await makeCharacter(ann, 'Maud');
  const corin = await makeCharacter(ben, 'Corin');

  const first = await lobby([{ player: ann, hero: maud }, { player: ben, hero: corin }]);
  await play(first, [ann, ben]);
  const second = await lobby([{ player: ann, hero: maud }, { player: ben, hero: corin }]);
  const going = await play(second, [ann, ben], 1);
  assert.notEqual(going.status, 'ended');

  const list = await adventures(ann);
  assert.deepEqual(list.map((a) => a.code), [second, first], 'most recently played first');
  assert.equal(list[0].ended, false);
  assert.equal(list[0].ending, null, 'no epilogue yet');
  assert.equal(list[0].scenes, 1);
  assert.equal(list[1].ended, true);

  // A hero who died is named among the fallen.
  const store = getStore();
  const game = (await store.getGame(first))!;
  const sheets = { ...game.party!.sheets, [ben]: { ...game.party!.sheets[ben], hp: 0, dead: true } };
  await store.updateGame(first, {}, { party: { ...game.party!, sheets } });
  assert.deepEqual((await adventures(ann)).map((a) => a.code), [second, first], 'touching an old game does not move it up: the order is when the story last moved');
  const after = (await adventures(ben)).find((a) => a.code === first)!;
  assert.equal(after.result!.fell, true);
  assert.deepEqual(after.result!.fallen, ['Corin']);
  assert.deepEqual((await adventures(ann)).find((a) => a.code === first)!.result!.fallen, ['Corin']);
  assert.equal((await adventures(ann)).find((a) => a.code === first)!.result!.fell, false);

  // Leaving gives up the seat, and the adventure with it.
  await call(leaveApi.POST, gamePath(second, 'leave'), { player: ben, body: {} });
  await settle();
  assert.deepEqual((await adventures(ben)).map((a) => a.code), [first]);
});
