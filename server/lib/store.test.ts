import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gameCodeOf } from './http.ts';
import { MemoryStore } from './store/memory.ts';
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
  assert.equal(await store.castVote('ABCDEF', 1, 'p1', 'c', 19), null, 'wrong scene');

  const ids = (await Promise.all(Array.from({ length: 20 }, (_, i) =>
    store.addMessage('ABCDEF', { kind: 'chat', playerId: 'p1', characterName: 'c1', text: `m${i}` })))).map((m) => m.id);
  assert.deepEqual([...ids].sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i + 1));
  assert.deepEqual((await store.listMessages('ABCDEF', 18)).map((m) => m.id), [19, 20]);
  assert.deepEqual((await store.listMessages('ABCDEF', undefined, 3)).map((m) => m.id), [18, 19, 20]);
});

test('game code comes from the rewrite query or the original path', () => {
  assert.equal(gameCodeOf(new Request('http://x/api/game-vote?code=abcdef')), 'ABCDEF');
  assert.equal(gameCodeOf(new Request('http://x/api/games/QWERTY/vote')), 'QWERTY');
});
