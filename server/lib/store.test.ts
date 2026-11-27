import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gameCodeOf } from './http.ts';
import { MemoryStore } from './store/memory.ts';
import { gameRow, gameUpdate } from './store/postgres.ts';
import { SAMPLE } from './rules/sheet.fixture.ts';
import type { StoredCharacter as Character } from './types.ts';

const character = (id: string, ownerId: string): Character => ({
  id, ownerId, name: id, race: 'elf', characterClass: 'wizard', gender: 'female', temperament: 'kind', alignment: 'true-neutral',
  backstory: '', description: '', appearance: null, portraitUrl: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
});

test('memory store: compare-and-set transitions succeed exactly once', async () => {
  const store = new MemoryStore();
  const host = { playerId: 'p1', character: character('c1', 'p1'), joinedAt: new Date().toISOString() };
  assert.equal(await store.createGame({ code: 'ABCDEF', hostId: 'p1', dungeonMaster: 'bard', sceneCount: 4, host }), true);
  assert.equal(await store.createGame({ code: 'ABCDEF', hostId: 'p2', dungeonMaster: 'bard', sceneCount: 4, host }), false);
  await store.updateGame('ABCDEF', { status: 'lobby' }, { status: 'voting', sceneIndex: 0 });
  await store.saveScene('ABCDEF', { index: 0, title: 't', narration: 'n', imagePrompt: '', imageUrl: null, choices: [], isFinale: false });

  const wins = await Promise.all(Array.from({ length: 10 }, () =>
    store.updateGame('ABCDEF', { status: 'voting', sceneIndex: 0 }, { status: 'resolving' })));
  assert.equal(wins.filter(Boolean).length, 1);
  assert.equal(await store.castVote('ABCDEF', 0, 'p1', 'a', 7), null, 'no votes once resolving');
});

test('memory store: votes keep their first roll; message ids increase', async () => {
  const store = new MemoryStore();
  const host = { playerId: 'p1', character: character('c1', 'p1'), joinedAt: new Date().toISOString() };
  await store.createGame({ code: 'ABCDEF', hostId: 'p1', dungeonMaster: 'bard', sceneCount: 4, host });
  await store.saveScene('ABCDEF', { index: 0, title: 't', narration: 'n', imagePrompt: '', imageUrl: null, choices: [], isFinale: false });
  await store.updateGame('ABCDEF', {}, { status: 'voting', sceneIndex: 0 });
  assert.deepEqual(await store.castVote('ABCDEF', 0, 'p1', 'a', 7), { playerId: 'p1', choiceId: 'a', roll: 7 });
  assert.deepEqual(await store.castVote('ABCDEF', 0, 'p1', 'c', 19), { playerId: 'p1', choiceId: 'c', roll: 7 });
  assert.deepEqual(await store.castVote('ABCDEF', 0, 'p1', 'a', 3, { actionId: 'attack:greatsword', targets: ['foe-1'] }), { playerId: 'p1', choiceId: 'a', roll: 7, actionId: 'attack:greatsword', targets: ['foe-1'] });
  assert.deepEqual(await store.castVote('ABCDEF', 0, 'p1', 'b', 3, { actionId: 'spell:fire-bolt', targets: ['foe-1'] }, null, { text: 'I aim it at the chandelier' }), { playerId: 'p1', choiceId: 'b', roll: 7, actionId: 'spell:fire-bolt', targets: ['foe-1'], freeform: { text: 'I aim it at the chandelier' } });
  const written = { text: 'I kick the brazier', ruling: { kind: 'check' as const, ability: 'str' as const, skill: 'athletics', tier: 'medium' as const, effect: { category: 'damage' as const, severity: 'moderate' as const, damageType: 'bludgeoning' } } };
  assert.equal((await store.setFreeform('ABCDEF', 0, 'p1', 19, written))!.roll, 7, 'a written action keeps the first d20');
  assert.equal((await store.getGame('ABCDEF'))!.scenes[0].votes[0].actionId, undefined, 'a written check is not also a named action');
  assert.deepEqual((await store.getGame('ABCDEF'))!.scenes[0].votes[0].freeform, written);
  assert.deepEqual(await store.castVote('ABCDEF', 0, 'p1', 'b', 3, null), { playerId: 'p1', choiceId: 'b', roll: 7 });
  assert.equal(await store.castVote('ABCDEF', 1, 'p1', 'c', 19), null, 'wrong scene');

  const ids = (await Promise.all(Array.from({ length: 20 }, (_, i) =>
    store.addMessage('ABCDEF', { kind: 'chat', playerId: 'p1', characterName: 'c1', text: `m${i}` })))).map((m) => m.id);
  assert.deepEqual([...ids].sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i + 1));
  assert.deepEqual((await store.listMessages('ABCDEF', 18)).map((m) => m.id), [19, 20]);
  assert.deepEqual((await store.listMessages('ABCDEF', undefined, 3)).map((m) => m.id), [18, 19, 20]);
});

test('memory store: a game keeps its rules state (party sheets, combat, dungeon); new games have none', async () => {
  const store = new MemoryStore();
  const host = { playerId: 'p1', character: character('c1', 'p1'), joinedAt: new Date().toISOString() };
  await store.createGame({ code: 'ABCDEF', hostId: 'p1', dungeonMaster: 'bard', sceneCount: 4, host });
  const fresh = (await store.getGame('ABCDEF'))!;
  assert.deepEqual([fresh.party, fresh.combat, fresh.dungeon], [null, null, null]);
  const party = { version: 1 as const, rng: 7, sheets: { p1: SAMPLE } };
  assert.equal(await store.updateGame('ABCDEF', { status: 'lobby' }, { party }), true);
  const game = (await store.getGame('ABCDEF'))!;
  assert.deepEqual(game.party, party);
  game.party!.rng = 99;
  assert.equal((await store.getGame('ABCDEF'))!.party!.rng, 7, 'a copy, not the stored object');
});

test('memory store: a scene keeps its turn\'s result: none on a new scene, kept when the scene is rewritten, cleared with null', async () => {
  const store = new MemoryStore();
  const host = { playerId: 'p1', character: character('c1', 'p1'), joinedAt: new Date().toISOString() };
  await store.createGame({ code: 'ABCDEF', hostId: 'p1', dungeonMaster: 'bard', sceneCount: 4, host });
  const scene = { index: 0, title: 't', narration: 'n', imagePrompt: '', imageUrl: null, choices: [], isFinale: false };
  await store.saveScene('ABCDEF', scene);
  assert.equal((await store.getGame('ABCDEF'))!.scenes[0].result, null);
  const result = { sceneIndex: 0, combat: false, choice: null, heroes: [{ playerId: 'p1', name: 'c1', did: 'nothing' as const, byClock: false, rolls: [], lines: [] }], notes: ['The road leads on.'] };
  await store.setSceneResult('ABCDEF', 0, result);
  result.notes.push('changed after it was stored');
  assert.deepEqual((await store.getGame('ABCDEF'))!.scenes[0].result!.notes, ['The road leads on.'], 'a copy, not the object handed in');
  await store.saveScene('ABCDEF', { ...scene, title: 'rewritten' });
  const kept = (await store.getGame('ABCDEF'))!.scenes[0];
  assert.deepEqual([kept.title, kept.result!.heroes.length], ['rewritten', 1]);
  await store.setSceneResult('ABCDEF', 0, null);
  assert.equal((await store.getGame('ABCDEF'))!.scenes[0].result, null);
  await store.setSceneResult('ABCDEF', 7, result);
  await store.setSceneResult('NOSUCH', 0, result);
  assert.equal((await store.getGame('ABCDEF'))!.scenes.length, 1, 'a scene or a game that is not there is left alone');
});

test('postgres: the compare-and-set UPDATE names columns, keeps JSON state as JSON, and skips undefined fields', () => {
  const party = { version: 1 as const, rng: 7, sheets: {} };
  const { text, params } = gameUpdate('ABCDEF', { status: 'resolving', sceneIndex: 2 }, { status: 'voting', sceneIndex: 3, party, combat: null, title: undefined });
  assert.equal(text, 'UPDATE games SET updated_at = now(), status = $2, scene_index = $3, party = $4, combat = $5 WHERE code = $1 AND status = $6 AND scene_index = $7 RETURNING code');
  assert.deepEqual(params, ['ABCDEF', 'voting', 3, JSON.stringify(party), null, 'resolving', 2]);
  assert.equal(gameUpdate('ABCDEF', {}, { hostId: 'p2' }).text, 'UPDATE games SET updated_at = now(), host_id = $2 WHERE code = $1 RETURNING code');
});

test('postgres: a game row from before the rules engine reads as having no rules state', () => {
  const row = { code: 'ABCDEF', host_id: 'p1', status: 'lobby', dungeon_master: 'bard', title: null, scene_count: 4, scene_index: -1, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' };
  const game = gameRow(row, [], []);
  assert.deepEqual([game.party, game.combat, game.dungeon, game.code], [null, null, null, 'ABCDEF']);
  assert.deepEqual(gameRow({ ...row, party: { version: 1, rng: 1, sheets: {} }, combat: null, dungeon: null }, [], []).party, { version: 1, rng: 1, sheets: {} });
});

test('game code comes from the rewrite query or the original path', () => {
  assert.equal(gameCodeOf(new Request('http://x/api/game-vote?code=abcdef')), 'ABCDEF');
  assert.equal(gameCodeOf(new Request('http://x/api/games/QWERTY/vote')), 'QWERTY');
});
