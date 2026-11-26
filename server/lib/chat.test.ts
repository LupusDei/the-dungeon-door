import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, test } from 'node:test';

process.env.DD_FAKE_AI = '1';
delete process.env.DATABASE_URL;
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.DD_APP_KEY;
delete process.env.DD_FAKE_DELAY_MS;

import * as gameApi from '../api/game.ts';
import * as joinApi from '../api/game-join.ts';
import * as messagesApi from '../api/game-messages.ts';
import * as reactionsApi from '../api/game-reactions.ts';
import * as typingApi from '../api/game-typing.ts';
import * as gamesApi from '../api/games.ts';
import { call, gamePath, makeCharacter } from './api.fixture.ts';
import { chatLine, chatLines, oneEmoji, parseMentions } from './chat.ts';
import { MemoryStore } from './store/memory.ts';
import { getStore, setStore } from './store/index.ts';
import type { GameState, Message } from './types.ts';

beforeEach(() => setStore(new MemoryStore()));
afterEach(() => setStore(new MemoryStore()));

test('one emoji is one grapheme, and a word is not', () => {
  assert.equal(oneEmoji('👍'), '👍');
  assert.equal(oneEmoji(' 💀 '), '💀');
  assert.equal(oneEmoji('❤️'), '❤️');
  assert.equal(oneEmoji('👍🏻'), '👍🏻');
  assert.equal(oneEmoji('👍👍'), null);
  assert.equal(oneEmoji('lol'), null);
  assert.equal(oneEmoji(''), null);
  assert.equal(oneEmoji(3), null);
});

test('mentions: @Name is the hero, @player:Name is the player, the longest name wins', () => {
  const party = [
    { playerId: 'b', name: 'Bryn' },
    { playerId: 'n', name: 'Brynn' },
    { playerId: 'i', name: 'Ilsa of the Gate' },
  ];
  assert.deepEqual(parseMentions('Ask @Ilsa of the Gate, then @player:Bryn.', party), [
    { playerId: 'i', name: 'Ilsa of the Gate', target: 'hero' },
    { playerId: 'b', name: 'Bryn', target: 'player' },
  ]);
  assert.deepEqual(parseMentions('@Brynn agrees', party).map((m) => m.playerId), ['n']);
  assert.deepEqual(parseMentions('email me@Bryn and @Nobody', party), []);
  assert.deepEqual(parseMentions('@bryn @Bryn', party), [{ playerId: 'b', name: 'Bryn', target: 'hero' }]);
});

test('chat lines for the dungeon master keep in-character speech apart from table talk', () => {
  const line = (over: Partial<Message>): Message => ({
    id: 1, kind: 'chat', playerId: 'p', characterName: 'Bryn', text: 'hello', voice: 'in',
    replyTo: null, reply: null, mentions: [], reactions: [], createdAt: 't', ...over,
  });
  assert.equal(chatLine(line({ kind: 'system', voice: null })), null);
  assert.deepEqual(chatLine(line({ voice: 'in', text: 'Left door.' })), {
    characterName: 'Bryn', kind: 'chat', text: 'Left door.', voice: 'in',
  });
  assert.equal(chatLine(line({ voice: 'out' }))?.voice, 'out');
  assert.equal(chatLine(line({ voice: null }))?.voice, 'in', 'a chat line from before the flag reads as the hero');
  assert.deepEqual(chatLine(line({ kind: 'dm', playerId: null, characterName: 'Mara', voice: null, text: 'Well?' })), {
    characterName: 'Mara', kind: 'dm', text: 'Well?', voice: null,
  });
  assert.deepEqual(chatLines([line({ kind: 'system', voice: null, id: 1 }), line({ id: 2, voice: 'out' })]).map((l) => l.voice), ['out']);
});

async function table() {
  const bryn = randomUUID();
  const ilsa = randomUUID();
  const brynHero = await makeCharacter(bryn, 'Bryn');
  const ilsaHero = await makeCharacter(ilsa, 'Ilsa');
  const created = await call<GameState>(gamesApi.POST, '/api/games', { player: bryn, body: { characterId: brynHero.id } });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const code = created.body.code;
  const joined = await call(joinApi.POST, gamePath(code, 'join'), { player: ilsa, body: { characterId: ilsaHero.id } });
  assert.equal(joined.status, 200, JSON.stringify(joined.body));
  return { code, bryn, ilsa };
}

const view = async (code: string, player: string, since?: number) =>
  (await call<GameState>(gameApi.GET, gamePath(code, undefined, since === undefined ? '' : `&since=${since}`), { player })).body;

const say = (code: string, player: string, body: Record<string, unknown>) =>
  call<Message>(messagesApi.POST, gamePath(code, 'messages'), { player, body });

test('a hero speaks in character by default, and a reply quotes the line', async () => {
  const { code, bryn, ilsa } = await table();
  const first = await say(code, bryn, { text: '  We should take the left door  ' });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.voice, 'in');
  assert.equal(first.body.characterName, 'Bryn');
  assert.equal(first.body.text, 'We should take the left door');
  assert.equal(first.body.replyTo, null);
  assert.deepEqual(first.body.mentions, []);
  assert.deepEqual(first.body.reactions, []);

  const reply = await say(code, ilsa, { text: 'The left door it is', voice: 'in', replyTo: first.body.id });
  assert.equal(reply.status, 200, JSON.stringify(reply.body));
  assert.notEqual(reply.body.id, first.body.id);
  assert.equal(reply.body.replyTo, first.body.id);
  assert.equal(reply.body.reply?.text, 'We should take the left door');
  assert.equal(reply.body.reply?.characterName, 'Bryn');
  assert.equal(reply.body.reply?.voice, 'in');
  assert.equal(reply.body.voice, 'in');

  assert.equal((await say(code, ilsa, { text: 'nope', replyTo: 9999 })).status, 400);
  assert.equal((await say(code, ilsa, { text: 'nope', replyTo: 0 })).status, 400);
  assert.equal((await say(code, ilsa, { text: 'nope', voice: 'aside' })).status, 400);
});

test('out of character is stored, and @name mentions a hero or the player', async () => {
  const { code, bryn, ilsa } = await table();
  const line = await say(code, bryn, { text: 'What do you think, @Ilsa? Ask @player:Ilsa too.', voice: 'out' });
  assert.equal(line.status, 200, JSON.stringify(line.body));
  assert.equal(line.body.voice, 'out');
  assert.equal(line.body.characterName, 'Bryn');
  assert.equal(line.body.playerId, bryn);
  assert.deepEqual(line.body.mentions, [
    { playerId: ilsa, name: 'Ilsa', target: 'hero' },
    { playerId: ilsa, name: 'Ilsa', target: 'player' },
  ]);

  const looked = await view(code, ilsa);
  const stored = looked.messages.find((m) => m.id === line.body.id);
  assert.equal(stored?.voice, 'out');
  assert.deepEqual(stored?.mentions.map((m) => m.target), ['hero', 'player']);
});

test('a reaction toggles, names who, and leaves the message id where it is', async () => {
  const { code, bryn, ilsa } = await table();
  const line = await say(code, bryn, { text: 'Hold here' });
  const id = line.body.id;
  const outsider = randomUUID();

  const added = await call<Message>(reactionsApi.POST, gamePath(code, 'reactions'), {
    player: ilsa, body: { messageId: id, emoji: '❤️' },
  });
  assert.equal(added.status, 200, JSON.stringify(added.body));
  assert.equal(added.body.id, id);
  assert.deepEqual(added.body.reactions, [{ emoji: '❤️', count: 1, playerIds: [ilsa] }]);

  const both = await call<Message>(reactionsApi.POST, gamePath(code, 'reactions'), {
    player: bryn, body: { messageId: id, emoji: '❤️' },
  });
  assert.equal(both.body.id, id);
  assert.equal(both.body.reactions[0]?.count, 2);
  assert.deepEqual(both.body.reactions[0]?.playerIds, [ilsa, bryn]);

  const skull = await call<Message>(reactionsApi.POST, gamePath(code, 'reactions'), {
    player: ilsa, body: { messageId: id, emoji: '💀' },
  });
  assert.deepEqual(skull.body.reactions.map((r) => r.emoji), ['❤️', '💀']);

  const cleared = await call<Message>(reactionsApi.POST, gamePath(code, 'reactions'), {
    player: ilsa, body: { messageId: id, emoji: '❤️' },
  });
  assert.equal(cleared.body.id, id);
  assert.deepEqual(cleared.body.reactions.find((r) => r.emoji === '❤️')?.playerIds, [bryn]);
  assert.equal(cleared.body.reactions.find((r) => r.emoji === '💀')?.playerIds[0], ilsa);

  const gone = await call<Message>(reactionsApi.POST, gamePath(code, 'reactions'), {
    player: bryn, body: { messageId: id, emoji: '❤️' },
  });
  assert.equal(gone.body.reactions.find((r) => r.emoji === '❤️'), undefined);

  const after = await say(code, bryn, { text: 'Still here' });
  assert.equal(after.body.id, id + 1, 'a reaction does not consume a message id');

  assert.equal((await call(reactionsApi.POST, gamePath(code, 'reactions'), { player: outsider, body: { messageId: id, emoji: '👍' } })).status, 403);
  assert.equal((await call(reactionsApi.POST, gamePath(code, 'reactions'), { player: ilsa, body: { messageId: 9999, emoji: '👍' } })).status, 404);
  assert.equal((await call(reactionsApi.POST, gamePath(code, 'reactions'), { player: ilsa, body: { messageId: id, emoji: 'nope' } })).status, 400);
  assert.equal((await call(reactionsApi.POST, gamePath(code, 'reactions'), { player: ilsa, body: { messageId: id, emoji: '👍👍' } })).status, 400);

  const state = await view(code, ilsa);
  const system = state.messages.find((m) => m.kind === 'system');
  assert.ok(system);
  const onSystem = await call<Message>(reactionsApi.POST, gamePath(code, 'reactions'), {
    player: ilsa, body: { messageId: system.id, emoji: '👍' },
  });
  assert.equal(onSystem.status, 200, JSON.stringify(onSystem.body));
  assert.equal(onSystem.body.id, system.id);
  assert.equal(onSystem.body.reactions[0]?.emoji, '👍');
});

test('the poll delivers reaction changes on lines the client already has, and typing to everyone else', async () => {
  const { code, bryn, ilsa } = await table();
  const line = await say(code, bryn, { text: 'Hold here' });
  const seen = await view(code, ilsa, line.body.id);
  assert.deepEqual(seen.messages, []);
  assert.deepEqual(seen.messageUpdates, []);
  assert.deepEqual(seen.typing, []);

  await call(reactionsApi.POST, gamePath(code, 'reactions'), { player: ilsa, body: { messageId: line.body.id, emoji: '😂' } });
  const updated = await view(code, bryn, line.body.id);
  assert.deepEqual(updated.messages.map((m) => m.id), []);
  assert.deepEqual(updated.messageUpdates.map((m) => m.id), [line.body.id]);
  assert.equal(updated.messageUpdates[0]?.reactions[0]?.emoji, '😂');

  const typing = await call(typingApi.POST, gamePath(code, 'typing'), { player: ilsa, body: {} });
  assert.equal(typing.status, 200);
  const heard = await view(code, bryn);
  assert.deepEqual(heard.typing, [{ playerId: ilsa, name: 'Ilsa' }]);
  const self = await view(code, ilsa);
  assert.deepEqual(self.typing, [], 'you do not see your own typing');

  await call(typingApi.POST, gamePath(code, 'typing'), { player: ilsa, body: { typing: false } });
  assert.deepEqual((await view(code, bryn)).typing, []);

  // Expiry is the store's clock, not a second poll: a ping already in the past is gone.
  await getStore().setTyping(code, ilsa, 'Ilsa', new Date(Date.now() - 1000).toISOString());
  assert.deepEqual(await getStore().listTyping(code, new Date().toISOString()), []);
});
