/**
 * One replay of an adventure journal, for adventure_length.feature, past_adventures.feature and
 * out_of_credit.feature. The generated Gherkin specs call helpers synchronously, so each step runs
 * this file in a child process and reads the view back.
 *
 * stdin: a JSON list of ops. stdout: a line `__DD_VIEW__` then the view as JSON.
 */
import { randomUUID } from 'node:crypto';

import * as adventuresApi from '../api/adventures.ts';
import * as endingApi from '../api/game-ending.ts';
import * as joinApi from '../api/game-join.ts';
import * as leaveApi from '../api/game-leave.ts';
import * as startApi from '../api/game-start.ts';
import * as voteApi from '../api/game-vote.ts';
import * as gameApi from '../api/game.ts';
import * as gamesApi from '../api/games.ts';
import type { AdventureView } from '../lib/adventures.ts';
import { call, gamePath, makeCharacter } from '../lib/api.fixture.ts';
import { settle } from '../lib/background.ts';
import { fakeDungeonMaster } from '../lib/dm/fake.ts';
import { registerDungeonMaster } from '../lib/dm/registry.ts';
import { setDice } from '../lib/game.ts';
import { MemoryStore } from '../lib/store/memory.ts';
import { setStore } from '../lib/store/index.ts';
import type { GameState } from '../lib/types.ts';

export interface Op {
  op: 'party' | 'broke' | 'start' | 'play' | 'ending' | 'leave';
  names?: string[];
  hero?: string;
  /** start: the scenes asked for (0: no set length). play: how many scenes to play (0: to the end). */
  count?: number;
}

export interface View {
  /** The status and error of the last thing a hero asked for (start, ending). */
  actionStatus: number;
  error: string | null;
  gameStatus: string;
  openEnded: boolean;
  scenesLeft: number | null;
  /** The table's system lines, oldest first. */
  told: string[];
  /** Each hero's past adventures, most recently played first. */
  quests: Record<string, AdventureView[]>;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  setStore(new MemoryStore());
  // The same dice every replay: a quiet road from the tavern.
  setDice({ d20: () => 15, seed: () => 5 });
  const ops = JSON.parse(await readStdin()) as Op[];
  const ids: Record<string, string> = {};
  let names: string[] = [];
  let seated: string[] = [];
  let code = '';
  let actionStatus = 0;
  let error: string | null = null;

  const look = async (hero: string) => (await call<GameState>(gameApi.GET, gamePath(code), { player: ids[hero]! })).body;

  /** Everyone still at the table votes for the quietest choice: one with no dice in it, if there is one. */
  const playScene = async (): Promise<GameState> => {
    const state = await look(seated[0]!);
    if (state.status !== 'voting' || !state.scene) return state;
    const quiet = state.scene.choices.find((c) => c.rules === null) ?? state.scene.choices[state.scene.choices.length - 1];
    for (const hero of seated) {
      await call(voteApi.POST, gamePath(code, 'vote'), { player: ids[hero]!, body: { sceneIndex: state.scene.index, choiceId: quiet?.id ?? 'a' } });
    }
    await settle();
    return look(seated[0]!);
  };

  for (const op of ops) {
    if (op.op === 'party') {
      names = op.names ?? [];
      seated = [...names];
      for (const name of names) ids[name] = randomUUID();
      const heroes = await Promise.all(names.map((name) => makeCharacter(ids[name]!, name)));
      const created = await call<GameState>(gamesApi.POST, '/api/games', { player: ids[names[0]!]!, body: { characterId: heroes[0]!.id } });
      if (created.status !== 200) throw new Error(`could not open a table: ${JSON.stringify(created.body)}`);
      code = created.body.code;
      for (let i = 1; i < names.length; i++) {
        const joined = await call(joinApi.POST, gamePath(code, 'join'), { player: ids[names[i]!]!, body: { characterId: heroes[i]!.id } });
        if (joined.status !== 200) throw new Error(`could not seat ${names[i]}: ${JSON.stringify(joined.body)}`);
      }
      continue;
    }
    if (op.op === 'broke') {
      // What the AI Gateway answers when the account has run out of credit.
      const broke = () => Object.assign(new Error('A positive credit balance is required for all requests, including BYOK.'), { statusCode: 402 });
      registerDungeonMaster('chronicler', { ...fakeDungeonMaster, openingScene: async () => { throw broke(); } });
      continue;
    }
    if (op.op === 'play') {
      const scenes = op.count ?? 1;
      for (let played = 0; scenes === 0 ? played < 60 : played < scenes; played++) {
        const state = await playScene();
        if (state.status === 'ended') break;
      }
      continue;
    }
    const hero = op.hero ?? '';
    const player = ids[hero];
    if (!player) throw new Error(`no hero ${hero} at the table`);
    if (op.op === 'start') {
      const started = await call<GameState & { error?: string }>(startApi.POST, gamePath(code, 'start'), { player, body: { sceneCount: op.count ?? 4, dungeon: 'none' } });
      actionStatus = started.status;
      error = started.status === 200 ? null : (started.body.error ?? null);
      await settle();
    } else if (op.op === 'ending') {
      const called = await call<GameState & { error?: string }>(endingApi.POST, gamePath(code, 'ending'), { player, body: {} });
      actionStatus = called.status;
      error = called.status === 200 ? null : (called.body.error ?? null);
    } else if (op.op === 'leave') {
      const left = await call(leaveApi.POST, gamePath(code, 'leave'), { player, body: {} });
      actionStatus = left.status;
      error = null;
      seated = seated.filter((name) => name !== hero);
      await settle();
    }
  }

  const state = await look(seated[0] ?? names[0]!);
  const quests: Record<string, AdventureView[]> = {};
  for (const name of names) {
    quests[name] = (await call<{ adventures: AdventureView[] }>(adventuresApi.GET, '/api/adventures', { player: ids[name]! })).body.adventures;
  }
  const view: View = {
    actionStatus,
    error,
    gameStatus: state.status,
    openEnded: state.openEnded,
    scenesLeft: state.scenesLeft,
    told: state.messages.filter((m) => m.kind === 'system').map((m) => m.text),
    quests,
  };
  console.log('\n__DD_VIEW__');
  console.log(JSON.stringify(view));
  await settle();
}

await main();
