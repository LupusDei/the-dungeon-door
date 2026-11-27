/**
 * One replay of a party-chat journal. The generated Gherkin specs call helpers synchronously,
 * so each step runs this file in a child process and reads the view back.
 *
 * stdin: a JSON list of ops. stdout: a line `__DD_VIEW__` then the view as JSON.
 */
import { randomUUID } from 'node:crypto';

import * as joinApi from '../api/game-join.ts';
import * as gamesApi from '../api/games.ts';
import { call } from '../lib/api.fixture.ts';
import { makeCharacter } from '../lib/api.fixture.ts';
import { chatLines } from '../lib/chat.ts';
import { keptWords } from '../lib/dm/playerVoice.ts';
import { postMessage, react, setTyping, viewGame } from '../lib/game.ts';
import { MemoryStore } from '../lib/store/memory.ts';
import { getStore, setStore } from '../lib/store/index.ts';
import type { GameState, Message } from '../lib/types.ts';

interface Say {
  op: 'say';
  hero: string;
  text: string;
  voice: 'in' | 'out';
  reply: boolean;
  emote?: boolean;
  /** Hero names, joined with "and", who a whisper is for. */
  whisper?: string;
}
type Op =
  | { op: 'party'; names: string[] }
  | Say
  | { op: 'react'; hero: string; emoji: string }
  | { op: 'typing'; hero: string };

interface View {
  messages: Message[];
  typing: GameState['typing'];
  players: { playerId: string; name: string }[];
  byHero: Record<string, Message[]>;
  narratorKept: string;
  narratorTalk: string;
  anchorId: number | null;
  lastId: number | null;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function party(names: string[]): Promise<{ code: string; ids: Record<string, string> }> {
  const ids: Record<string, string> = {};
  for (const name of names) ids[name] = randomUUID();
  const heroes = await Promise.all(names.map((name) => makeCharacter(ids[name]!, name)));
  const created = await call<GameState>(gamesApi.POST, '/api/games', { player: ids[names[0]!]!, body: { characterId: heroes[0]!.id } });
  if (created.status !== 200) throw new Error(`could not open a table: ${JSON.stringify(created.body)}`);
  for (let i = 1; i < names.length; i++) {
    const joined = await call(joinApi.POST, `/api/game-join?code=${created.body.code}`, {
      player: ids[names[i]!]!, body: { characterId: heroes[i]!.id },
    });
    if (joined.status !== 200) throw new Error(`could not seat ${names[i]}: ${JSON.stringify(joined.body)}`);
  }
  return { code: created.body.code, ids };
}

async function replay(ops: Op[]): Promise<View> {
  let code = '';
  let ids: Record<string, string> = {};
  let names: string[] = [];
  let anchorId: number | null = null;
  let lastId: number | null = null;
  let typer: string | null = null;

  for (const op of ops) {
    if (op.op === 'party') {
      names = op.names;
      ({ code, ids } = await party(names));
      continue;
    }
    const playerId = ids[op.hero];
    if (!playerId) throw new Error(`no hero ${op.hero} at the table`);
    if (op.op === 'say') {
      const whisperTo = op.whisper?.split(/\s+and\s+/).map((name) => {
        const id = ids[name.trim()];
        if (!id) throw new Error(`no hero ${name} at the table`);
        return { playerId: id, target: 'hero' as const };
      });
      const message = await postMessage(code, playerId, op.text, {
        voice: op.voice, replyTo: op.reply ? anchorId : undefined, emote: op.emote, whisperTo,
      });
      if (!op.reply) anchorId = message.id;
      lastId = message.id;
    } else if (op.op === 'react') {
      if (anchorId === null) throw new Error('nothing to react to');
      await react(code, playerId, anchorId, op.emoji);
    } else {
      await setTyping(code, playerId, true);
      typer = op.hero;
    }
  }

  const viewer = names.find((name) => name !== typer) ?? names[0];
  if (!viewer) throw new Error('the table is empty');
  const state = await viewGame(code, ids[viewer]!);
  const byHero: Record<string, Message[]> = {};
  for (const name of names) byHero[name] = (await viewGame(code, ids[name]!)).messages;
  const all = await getStore().listMessages(code);
  const lines = chatLines(all);
  return {
    messages: state.messages,
    typing: state.typing,
    players: state.players.map((p) => ({ playerId: p.playerId, name: p.character.name })),
    byHero,
    narratorKept: keptWords([], all).map((line) => `${line.characterName}: ${line.text}`).join('\n'),
    narratorTalk: lines.filter((line) => line.kind !== 'chat' || line.voice === 'out').map((line) => `${line.characterName ?? 'DM'}: ${line.text}`).join('\n'),
    anchorId,
    lastId,
  };
}

const raw = await readStdin();
setStore(new MemoryStore());
try {
  const view = await replay(raw.trim() ? JSON.parse(raw) as Op[] : []);
  process.stdout.write(`\n__DD_VIEW__\n${JSON.stringify(view)}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
