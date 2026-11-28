/**
 * One replay of a streamlined-game journal. The generated Gherkin specs call helpers synchronously,
 * so each step runs this file in a child process and reads the view back.
 *
 * stdin: a JSON list of ops. stdout: a line `__DD_VIEW__` then the view as JSON.
 */
import { randomUUID } from 'node:crypto';

import * as catalogApi from '../api/catalog.ts';
import * as joinApi from '../api/game-join.ts';
import * as startApi from '../api/game-start.ts';
import * as voteApi from '../api/game-vote.ts';
import * as gameApi from '../api/game.ts';
import * as gamesApi from '../api/games.ts';
import { call, gamePath, makeCharacter } from '../lib/api.fixture.ts';
import { settle } from '../lib/background.ts';
import { fakeDungeonMaster } from '../lib/dm/fake.ts';
import { registerDungeonMaster } from '../lib/dm/registry.ts';
import type { DungeonMaster } from '../lib/dm/types.ts';
import { setDice } from '../lib/game.ts';
import { MemoryStore } from '../lib/store/memory.ts';
import { setStore } from '../lib/store/index.ts';
import type { GameState } from '../lib/types.ts';

export interface Op {
  op: 'wordy' | 'start' | 'pick';
  /** start: the telling asked for; absent, the start names none. */
  telling?: string;
  /** pick: the choice every hero picks. */
  choice?: string;
}

export interface View {
  tellings: string[];
  startStatus: number;
  error: string | null;
  gameStatus: string;
  telling: string | null;
  /** The telling the dungeon master was asked for, each time it wrote. */
  asked: (string | null)[];
  narration: string;
  choices: { label: string; detail: string; rules: string | null }[];
  /** The dungeon master's lines in the chat. */
  dmLines: string[];
  outcome: string | null;
  heroes: string[];
  resultHeroes: string[];
  diceLines: string[];
}

const NARRATION = 'Mist coils over the ford, silver in the last of the light.\n\nA lean grey wolf stands in the shallows. A giant rat gnaws at a satchel beside it. ' +
  'Somewhere upstream a bell tolls twice. What do you do?';
const OUTCOME = 'The party wades in without a sound. The wolf lifts its head and lets them pass. Far behind them, the tavern lights wink out.';
const ASIDE = 'Mind the rat, my dears, it bites.';
const LABEL = 'Creep along the far bank under cover of the reeds';
const DETAIL = 'Slow and cold, and the rat has sharp ears; one splash and both of them will be on you.';

/** The fake dungeon master's scenes, written at length whatever it is asked. */
function wordy(asked: (string | null)[]): DungeonMaster {
  const long = <T extends { narration: string; choices?: { label: string; detail: string }[] }>(scene: T): T => ({
    ...scene, narration: NARRATION, quip: ASIDE,
    ...(scene.choices ? { choices: scene.choices.map((c, i) => ({ ...c, label: i === 1 ? LABEL : c.label, detail: DETAIL })) } : {}),
  });
  return {
    ...fakeDungeonMaster,
    openingScene: async (ctx) => { asked.push(ctx.telling ?? null); return long(await fakeDungeonMaster.openingScene({ ...ctx, telling: 'full' })); },
    nextScene: async (ctx, resolution) => { asked.push(ctx.telling ?? null); return { ...long(await fakeDungeonMaster.nextScene({ ...ctx, telling: 'full' }, resolution)), outcome: OUTCOME }; },
  };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  setStore(new MemoryStore());
  setDice({ d20: () => 12, seed: () => 42 });
  const ops = JSON.parse(await readStdin()) as Op[];
  const asked: (string | null)[] = [];
  const players = [randomUUID(), randomUUID()];
  const heroes = await Promise.all(players.map((p, i) => makeCharacter(p, `Hero ${i + 1}`, { race: 'human', characterClass: 'fighter' })));
  const created = await call<GameState>(gamesApi.POST, '/api/games', { player: players[0], body: { characterId: heroes[0].id } });
  const code = created.body.code;
  await call(joinApi.POST, gamePath(code, 'join'), { player: players[1], body: { characterId: heroes[1].id } });
  let startStatus = 0;
  let error: string | null = null;

  for (const op of ops) {
    if (op.op === 'wordy') registerDungeonMaster('chronicler', wordy(asked));
    if (op.op === 'start') {
      const started = await call<GameState & { error?: string }>(startApi.POST, gamePath(code, 'start'), {
        player: players[0], body: { sceneCount: 4, ...(op.telling === undefined ? {} : { telling: op.telling }) },
      });
      startStatus = started.status;
      error = started.status === 200 ? null : (started.body.error ?? null);
      await settle();
    }
    if (op.op === 'pick') {
      const at = (await call<GameState>(gameApi.GET, gamePath(code), { player: players[0] })).body.scene!.index;
      for (const p of players) await call(voteApi.POST, gamePath(code, 'vote'), { player: p, body: { sceneIndex: at, choiceId: op.choice } });
      await settle();
    }
  }

  const catalog = await call<{ tellings: { id: string }[] }>(catalogApi.GET, '/api/catalog');
  const look = (await call<GameState>(gameApi.GET, gamePath(code), { player: players[1] })).body;
  const last = look.chronicle.at(-1) ?? null;
  const view: View = {
    tellings: catalog.body.tellings.map((t) => t.id),
    startStatus,
    error,
    gameStatus: look.status,
    telling: look.telling ?? null,
    asked,
    narration: look.scene?.narration ?? '',
    choices: (look.scene?.choices ?? []).map((c) => ({ label: c.label, detail: c.detail, rules: c.rules })),
    dmLines: look.messages.filter((m) => m.kind === 'dm').map((m) => m.text),
    outcome: last?.outcome ?? null,
    heroes: look.players.map((p) => p.character.name),
    resultHeroes: last?.result?.heroes.map((h) => h.name) ?? [],
    diceLines: look.messages.filter((m) => m.kind === 'system' && / vs DC \d+/.test(m.text)).map((m) => m.text),
  };
  console.log('\n__DD_VIEW__');
  console.log(JSON.stringify(view));
  await settle();
}

await main();
