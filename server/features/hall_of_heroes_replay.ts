/**
 * One replay of a Hall of Heroes journal. The generated Gherkin specs call helpers synchronously,
 * so each step runs this file in a child process and reads the view back.
 *
 * stdin: a JSON list of ops. stdout: a line `__DD_VIEW__` then the view as JSON.
 */
import * as reviveApi from '../api/character-revive.ts';
import * as retireApi from '../api/character-retire.ts';
import * as unretireApi from '../api/character-unretire.ts';
import * as charactersApi from '../api/characters.ts';
import * as joinApi from '../api/game-join.ts';
import * as startApi from '../api/game-start.ts';
import * as voteApi from '../api/game-vote.ts';
import * as gameApi from '../api/game.ts';
import * as gamesApi from '../api/games.ts';
import { call, gamePath, makeCharacter } from '../lib/api.fixture.ts';
import { settle } from '../lib/background.ts';
import { fakeDungeonMaster } from '../lib/dm/fake.ts';
import { registerDungeonMaster } from '../lib/dm/registry.ts';
import { setDice } from '../lib/game.ts';
import { getStore, setStore } from '../lib/store/index.ts';
import { MemoryStore } from '../lib/store/memory.ts';
import type { Character, GameState, StoredCharacter } from '../lib/types.ts';

interface Op {
  op: 'heroes' | 'retire' | 'die' | 'fell' | 'gold' | 'strangerDoor' | 'strangerRetired'
    | 'list' | 'unretire' | 'delete' | 'open' | 'join' | 'slay' | 'raise';
  names?: string[];
  hero?: string;
  host?: string;
  place?: string;
  gp?: number;
  status?: string;
}

/** Fixed ids, so a hero rolls the same sheet (and meets the same fate) on every run. */
const ME = '00000000-0000-4000-8000-000000000001';
const STRANGER = '00000000-0000-4000-8000-000000000002';
const heroId = (i: number) => `00000000-0000-4000-8001-${String(i + 1).padStart(12, '0')}`;

type Reply = { error?: string } & Partial<Character>;

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  setStore(new MemoryStore());
  setDice({ d20: () => 1, seed: () => 42 });
  const ops = JSON.parse(await readStdin()) as Op[];
  const heroes: Record<string, { id: string; owner: string }> = {};
  const doors: Record<string, string> = {};
  const stamps: Record<string, (string | null)[]> = {};
  let made = 0;
  let last: { status: number; error: string | null } = { status: 0, error: null };
  let slain: { title: string | null; scenes: string[] } | null = null;

  const forge = async (owner: string, name: string) => {
    const hero = await makeCharacter(owner, name, { id: heroId(made++), race: 'human', characterClass: 'wizard' });
    heroes[name] = { id: hero.id, owner };
  };
  const find = (name: string) => {
    const hero = heroes[name ?? ''];
    if (!hero) throw new Error(`no hero ${name}`);
    return hero;
  };
  const answer = (reply: { status: number; body: Reply }) => {
    last = { status: reply.status, error: reply.status === 200 ? null : (reply.body.error ?? null) };
  };
  const patch = async (name: string, change: (c: StoredCharacter) => Partial<StoredCharacter>) => {
    const stored = (await getStore().getCharacter(find(name).id))!;
    await getStore().saveCharacter({ ...stored, ...change(stored) });
  };
  const retire = async (name: string, player: string) => {
    const reply = await call<Reply>(retireApi.POST, '/api/characters/retire', { player, body: { characterId: find(name).id } });
    answer(reply);
    (stamps[name] ??= []).push(reply.body.retiredAt ?? null);
  };

  for (const op of ops) {
    const name = op.hero ?? '';
    switch (op.op) {
      case 'heroes':
        for (const each of op.names ?? []) await forge(ME, each);
        break;
      case 'retire':
        await retire(name, find(name).owner);
        if (last.status !== 200) throw new Error(`could not retire ${name}: ${last.error}`);
        break;
      case 'die':
        await patch(name, (c) => ({ sheet: { ...c.sheet!, hp: 0, dead: true } }));
        break;
      case 'fell':
        await patch(name, (c) => ({
          sheet: { ...c.sheet!, hp: 0, dead: true },
          death: { at: new Date().toISOString(), adventure: 'The Sunken Keep', place: op.place ?? null, cause: `${name} dies.`, gameCode: null },
        }));
        break;
      case 'gold':
        await patch(name, (c) => ({ sheet: { ...c.sheet!, gp: op.gp ?? 0 } }));
        break;
      case 'strangerDoor': {
        await forge(STRANGER, name);
        const opened = await call<GameState>(gamesApi.POST, '/api/games', { player: STRANGER, body: { characterId: find(name).id } });
        if (opened.status !== 200) throw new Error(`the stranger could not open a door: ${JSON.stringify(opened.body)}`);
        doors[name] = opened.body.code;
        break;
      }
      case 'strangerRetired':
        await forge(STRANGER, name);
        await retire(name, STRANGER);
        break;
      case 'list':
        answer(await call<Reply>(charactersApi.GET, `/api/characters?status=${encodeURIComponent(op.status ?? '')}`, { player: ME }));
        break;
      case 'unretire':
        answer(await call<Reply>(unretireApi.POST, '/api/characters/unretire', { player: ME, body: { characterId: find(name).id } }));
        break;
      case 'delete':
        answer(await call<Reply>(charactersApi.DELETE, `/api/characters?id=${find(name).id}`, { player: ME, method: 'DELETE' }));
        break;
      case 'open':
        answer(await call<Reply>(gamesApi.POST, '/api/games', { player: ME, body: { characterId: find(name).id } }));
        break;
      case 'join':
        answer(await call<Reply>(joinApi.POST, gamePath(doors[op.host ?? ''] ?? '', 'join'), { player: ME, body: { characterId: find(name).id } }));
        break;
      case 'slay':
        slain = await slay(find(name).id);
        break;
      case 'raise':
        answer(await call<Reply>(reviveApi.POST, '/api/characters/revive', { player: ME, body: { characterId: find(name).id } }));
        break;
    }
  }

  const names = async (player: string, status?: string) => {
    const { body } = await call<{ characters: Character[] }>(charactersApi.GET, `/api/characters${status ? `?status=${status}` : ''}`, { player });
    return body.characters.map((c) => c.name).sort();
  };
  const everyone = [
    ...(await call<{ characters: Character[] }>(charactersApi.GET, '/api/characters?status=all', { player: ME })).body.characters,
    ...(await call<{ characters: Character[] }>(charactersApi.GET, '/api/characters?status=all', { player: STRANGER })).body.characters,
  ];
  const view = {
    last,
    stamps,
    slain,
    lists: {
      active: await names(ME, 'active'),
      retired: await names(ME, 'retired'),
      dead: await names(ME, 'dead'),
      all: await names(ME, 'all'),
      default: await names(ME),
    },
    heroes: Object.fromEntries(everyone.map((c) => [c.name, { retiredAt: c.retiredAt, death: c.death, dead: c.sheet.dead === true }])),
  };
  console.log('\n__DD_VIEW__');
  console.log(JSON.stringify(view));
  await settle();
}

/** A tale whose opening scene is a fight with a tyrannosaurus: a level-1 wizard does not walk away. */
async function slay(characterId: string): Promise<{ title: string | null; scenes: string[] }> {
  registerDungeonMaster('chronicler', {
    ...fakeDungeonMaster,
    openingScene: async (ctx) => {
      const scene = await fakeDungeonMaster.openingScene(ctx);
      return { ...scene, choices: [{ label: 'Fight', detail: 'Try it.', rules: { kind: 'fight', monsters: ['tyrannosaurus-rex'] } }, ...scene.choices.slice(1)] };
    },
  });
  const { body: game } = await call<GameState>(gamesApi.POST, '/api/games', { player: ME, body: { characterId } });
  await call(startApi.POST, gamePath(game.code, 'start'), { player: ME, body: { sceneCount: 8 } });
  await settle();
  const look = async () => (await call<GameState>(gameApi.GET, gamePath(game.code), { player: ME })).body;
  let state = await look();
  for (let index = 0; state.status === 'voting'; index++) {
    if (index > 14) throw new Error('the fight never ended');
    await call(voteApi.POST, gamePath(game.code, 'vote'), { player: ME, body: { sceneIndex: index, choiceId: index === 0 ? 'a' : 'c' } });
    await settle();
    state = await look();
  }
  return { title: state.title, scenes: state.chronicle.map((c) => c.title) };
}

await main();
