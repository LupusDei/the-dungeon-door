/**
 * One replay of an app-version journal. The generated Gherkin specs call helpers synchronously,
 * so each step runs this file in a child process and reads the view back.
 *
 * stdin: a JSON list of ops. stdout: a line `__DD_VIEW__` then the view as JSON.
 */
import { randomUUID } from 'node:crypto';

import * as joinApi from '../api/game-join.ts';
import * as startApi from '../api/game-start.ts';
import * as gameApi from '../api/game.ts';
import * as gamesApi from '../api/games.ts';
import { call, gamePath, makeCharacter } from '../lib/api.fixture.ts';
import { outdatedAppVersionHeader, supportedAppVersionHeader } from '../lib/app-version.ts';
import { settle } from '../lib/background.ts';
import { MemoryStore } from '../lib/store/memory.ts';
import { setStore } from '../lib/store/index.ts';
import type { GameState } from '../lib/types.ts';

type Kind = 'current' | 'old' | 'none';

interface Op {
  op: 'party' | 'version' | 'start';
  names?: string[];
  hero?: string;
  kind?: Kind;
  dungeon?: 'none' | 'fixed';
}

function headerFor(kind: Kind): string | null {
  if (kind === 'none') return null;
  if (kind === 'old') return outdatedAppVersionHeader();
  return supportedAppVersionHeader('0.2');
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  setStore(new MemoryStore());
  const ops = JSON.parse(await readStdin()) as Op[];
  const versions: Record<string, Kind> = {};
  const ids: Record<string, string> = {};
  let names: string[] = [];
  let code = '';
  let actionStatus = 0;
  let error: string | null = null;

  for (const op of ops) {
    if (op.op === 'party') {
      names = op.names ?? [];
      for (const name of names) {
        ids[name] = randomUUID();
        versions[name] = 'current';
      }
      const heroes = await Promise.all(names.map((name) => makeCharacter(ids[name]!, name)));
      const created = await call<GameState>(gamesApi.POST, '/api/games', {
        player: ids[names[0]!]!, appVersion: headerFor('current'), body: { characterId: heroes[0]!.id },
      });
      if (created.status !== 200) throw new Error(`could not open a table: ${JSON.stringify(created.body)}`);
      code = created.body.code;
      actionStatus = created.status;
      error = null;
      for (let i = 1; i < names.length; i++) {
        const joined = await call(joinApi.POST, gamePath(code, 'join'), {
          player: ids[names[i]!]!, appVersion: headerFor('current'), body: { characterId: heroes[i]!.id },
        });
        if (joined.status !== 200) throw new Error(`could not seat ${names[i]}: ${JSON.stringify(joined.body)}`);
      }
      continue;
    }
    const hero = op.hero ?? '';
    const player = ids[hero];
    if (!player) throw new Error(`no hero ${hero} at the table`);
    if (op.op === 'version') {
      versions[hero] = op.kind ?? 'current';
      const seen = await call<GameState & { error?: string }>(gameApi.GET, gamePath(code), { player, appVersion: headerFor(versions[hero]!) });
      actionStatus = seen.status;
      error = seen.body.error ?? null;
      if (seen.status !== 200) throw new Error(`could not record ${hero}'s version: ${JSON.stringify(seen.body)}`);
    } else if (op.op === 'start') {
      const started = await call<GameState & { error?: string }>(startApi.POST, gamePath(code, 'start'), {
        player, appVersion: headerFor(versions[hero] ?? 'current'), body: { dungeon: op.dungeon ?? 'none' },
      });
      actionStatus = started.status;
      error = started.status === 200 ? null : (started.body.error ?? null);
    }
  }

  const host = names[0]!;
  const look = await call<GameState>(gameApi.GET, gamePath(code), { player: ids[host]!, appVersion: headerFor(versions[host] ?? 'current') });
  if (look.status !== 200) throw new Error(`could not look at the table: ${JSON.stringify(look.body)}`);
  const view = {
    actionStatus,
    error,
    code,
    gameStatus: look.body.status,
    players: look.body.players.map((p) => ({ name: p.character.name, appVersion: p.appVersion, outdated: p.outdated })),
  };
  console.log('\n__DD_VIEW__');
  console.log(JSON.stringify(view));
  await settle();
}

await main();
