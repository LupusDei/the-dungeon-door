/**
 * One replay of a companions journal. The generated Gherkin specs call helpers synchronously, so each
 * step runs this file in a child process and reads the view back.
 *
 * stdin: a JSON list of ops. stdout: a line `__DD_VIEW__` then the view as JSON.
 */
import * as retireApi from '../api/character-retire.ts';
import * as companionsApi from '../api/companions.ts';
import * as inviteApi from '../api/game-invites.ts';
import * as joinApi from '../api/game-join.ts';
import * as gamesApi from '../api/games.ts';
import * as invitesApi from '../api/invites.ts';
import * as meApi from '../api/me.ts';
import { call, gamePath, makeCharacter } from '../lib/api.fixture.ts';
import { settle } from '../lib/background.ts';
import type { Companion, InviteView } from '../lib/invites.ts';
import { getStore, setStore } from '../lib/store/index.ts';
import { MemoryStore } from '../lib/store/memory.ts';
import type { GameState } from '../lib/types.ts';

export interface Op {
  op: 'meet' | 'forge' | 'fall' | 'retire' | 'theyGoBy' | 'iGoBy' | 'iCall' | 'invite' | 'askAgain';
  /** meet, fall, retire: a hero of the companion's. invite, askAgain: the hero asked for, if any. */
  hero?: string;
  /** forge: more heroes for the companion. */
  names?: string[];
  /** theyGoBy, iGoBy, iCall: the name; "" clears it. */
  name?: string;
}

export interface View {
  companions: { name: string; namedBy: string | null; playedAs: string; heroes: string[] }[];
  /** The companion's invitations. */
  invites: { fromName: string; fromPlayerName: string | null; hero: string | null }[];
  /** How the last naming or invitation was answered. */
  last: { status: number; error: string | null; alreadyInvited: boolean | null };
}

/** Fixed ids, so heroes roll the same sheets on every run. */
const ME = '00000000-0000-4000-8000-000000000001';
const THEM = '00000000-0000-4000-8000-000000000002';
const heroId = (i: number) => `00000000-0000-4000-8002-${String(i + 1).padStart(12, '0')}`;

type Reply = { error?: string; alreadyInvited?: boolean };

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  setStore(new MemoryStore());
  const ops = JSON.parse(await readStdin()) as Op[];
  const heroes: Record<string, string> = {};
  let made = 0;
  let door: string | null = null;
  let last: View['last'] = { status: 0, error: null, alreadyInvited: null };

  const forge = async (owner: string, name: string) => {
    heroes[name] = (await makeCharacter(owner, name, { id: heroId(made++), race: 'human', characterClass: 'fighter' })).id;
  };
  const find = (name: string | undefined) => {
    const id = heroes[name ?? ''];
    if (!id) throw new Error(`no hero ${name}`);
    return id;
  };
  const answer = (reply: { status: number; body: Reply }) => {
    last = { status: reply.status, error: reply.status === 200 ? null : (reply.body.error ?? null), alreadyInvited: reply.body.alreadyInvited ?? null };
  };
  const open = async () => {
    const opened = await call<GameState>(gamesApi.POST, '/api/games', { player: ME, body: { characterId: find('Bryn') } });
    if (opened.status !== 200) throw new Error(`could not open a door: ${JSON.stringify(opened.body)}`);
    return opened.body.code;
  };
  const invite = async (hero: string | undefined) => {
    answer(await call<Reply>(inviteApi.POST, gamePath(door!, 'invites'), { player: ME, body: { playerId: THEM, ...(hero ? { characterId: find(hero) } : {}) } }));
  };

  for (const op of ops) {
    switch (op.op) {
      case 'meet': {
        // One game shared is what makes two players companions.
        await forge(ME, 'Bryn');
        await forge(THEM, op.hero!);
        const shared = await open();
        const joined = await call(joinApi.POST, gamePath(shared, 'join'), { player: THEM, body: { characterId: find(op.hero) } });
        if (joined.status !== 200) throw new Error(`they could not join: ${JSON.stringify(joined.body)}`);
        break;
      }
      case 'forge':
        for (const name of op.names ?? []) await forge(THEM, name);
        break;
      case 'fall': {
        const stored = (await getStore().getCharacter(find(op.hero)))!;
        await getStore().saveCharacter({ ...stored, sheet: { ...stored.sheet!, hp: 0, dead: true } });
        break;
      }
      case 'retire': {
        const retired = await call(retireApi.POST, '/api/characters/retire', { player: THEM, body: { characterId: find(op.hero) } });
        if (retired.status !== 200) throw new Error(`could not retire ${op.hero}: ${JSON.stringify(retired.body)}`);
        break;
      }
      case 'theyGoBy':
        answer(await call<Reply>(meApi.PUT, '/api/me', { player: THEM, method: 'PUT', body: { name: op.name } }));
        break;
      case 'iGoBy':
        answer(await call<Reply>(meApi.PUT, '/api/me', { player: ME, method: 'PUT', body: { name: op.name } }));
        break;
      case 'iCall':
        answer(await call<Reply>(companionsApi.PUT, '/api/companions', { player: ME, method: 'PUT', body: { playerId: THEM, name: op.name } }));
        break;
      case 'invite':
        door = await open();
        await invite(op.hero);
        break;
      case 'askAgain':
        await invite(op.hero);
        break;
    }
  }

  await settle();
  const mine = await call<{ companions: Companion[] }>(companionsApi.GET, '/api/companions', { player: ME });
  const theirs = await call<{ invites: InviteView[] }>(invitesApi.GET, '/api/invites', { player: THEM });
  const view: View = {
    companions: mine.body.companions.map((c) => ({ name: c.name, namedBy: c.namedBy, playedAs: c.playedAs, heroes: c.heroes.map((h) => h.name).sort() })),
    invites: theirs.body.invites.map((i) => ({ fromName: i.fromName, fromPlayerName: i.fromPlayerName, hero: i.hero?.name ?? null })),
    last,
  };
  console.log('\n__DD_VIEW__');
  console.log(JSON.stringify(view));
}

await main();
