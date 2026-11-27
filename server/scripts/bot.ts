/**
 * A bot player for testing multiplayer with one simulator:
 *
 *   npm run bot -- --base http://localhost:3000 --code ABCDEF [--name "Brother Bot"] [--portrait]
 *
 * It makes a character (no portrait unless --portrait), joins the game, says hello, and votes for a random
 * choice in every scene until the adventure ends. Set DD_APP_KEY if the server requires an app key.
 */
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { supportedAppVersionHeader } from '../lib/app-version.ts';

const { values } = parseArgs({
  options: {
    base: { type: 'string', default: 'http://localhost:3000' },
    code: { type: 'string' },
    name: { type: 'string' },
    portrait: { type: 'boolean', default: false },
    poll: { type: 'string', default: '2000' },
  },
});
if (!values.code) {
  console.error('usage: npm run bot -- --base http://localhost:3000 --code ABCDEF [--name NAME] [--portrait]');
  process.exit(1);
}
const base = values.base!.replace(/\/$/, '');
const code = values.code.toUpperCase();
const player = randomUUID();
const pollMs = Number(values.poll);

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'x-dd-player': player, 'content-type': 'application/json', 'x-dd-app-version': supportedAppVersionHeader() };
  if (process.env.DD_APP_KEY) headers['x-dd-key'] = process.env.DD_APP_KEY;
  const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status}: ${json.error}`);
  return json;
}

const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Catalog {
  races: { id: string; name: string }[];
  classes: { id: string; name: string }[];
  temperaments: { id: string }[];
  genders: { id: string }[];
  alignments: { id: string }[];
}
interface State {
  status: string;
  title: string | null;
  scene: null | { index: number; title: string; narration: string; isFinale: boolean; myVote: string | null; choices: { id: string; label: string }[]; outcome: string | null };
  messages: { id: number; kind: string; characterName: string | null; text: string }[];
}

const catalog = await api<Catalog>('GET', '/api/catalog');
const race = pick(catalog.races);
const characterClass = pick(catalog.classes);
const name = values.name ?? `${pick(['Bram', 'Wren', 'Ottilie', 'Fenwick', 'Mags', 'Tibbet', 'Corvin', 'Ysolde'])} the Bot`;
const look = {
  name,
  race: race.id,
  characterClass: characterClass.id,
  gender: pick(catalog.genders).id,
  temperament: pick(catalog.temperaments).id,
  alignment: pick(catalog.alignments).id,
  backstory: 'Built in a wizard\'s workshop to test doors. Has opened 4,000 of them.',
  description: 'brass-buttoned coat, one squeaky boot',
};
let appearance: string | null = null;
let portraitUrl: string | null = null;
if (values.portrait) {
  ({ appearance, portraitUrl } = await api<{ appearance: string; portraitUrl: string }>('POST', '/api/portrait', { character: look }));
}
const character = await api<{ id: string }>('PUT', '/api/characters', { id: randomUUID(), ...look, appearance, portraitUrl });
console.log(`🤖 ${name}, ${race.name} ${characterClass.name} (player ${player})`);

await api('POST', `/api/games/${code}/join`, { characterId: character.id });
console.log(`joined ${code}`);
await api('POST', `/api/games/${code}/messages`, { text: `Hello, friends! ${name} reporting for adventure. 🎲` });

let since = 0;
let lastStatus = '';
let votedScene = -1;
for (;;) {
  let state: State;
  try {
    state = await api<State>('GET', `/api/games/${code}?since=${since}`);
  } catch (error) {
    console.error(String(error));
    await sleep(pollMs);
    continue;
  }
  for (const m of state.messages) {
    console.log(`  [${m.kind}] ${m.characterName ? `${m.characterName}: ` : ''}${m.text}`);
    since = Math.max(since, m.id);
  }
  if (state.status !== lastStatus) {
    console.log(`status: ${state.status}${state.title ? ` — ${state.title}` : ''}`);
    lastStatus = state.status;
  }
  const scene = state.scene;
  if (state.status === 'voting' && scene && !scene.isFinale && !scene.myVote && votedScene !== scene.index) {
    const choice = pick(scene.choices);
    try {
      await api('POST', `/api/games/${code}/vote`, { sceneIndex: scene.index, choiceId: choice.id });
      votedScene = scene.index;
      console.log(`scene ${scene.index + 1} "${scene.title}": voted (${choice.id}) ${choice.label}`);
    } catch (error) {
      console.error(String(error));
    }
  }
  if (state.status === 'ended') {
    if (scene) console.log(`\n${scene.title}\n${scene.narration}`);
    await api('POST', `/api/games/${code}/messages`, { text: 'What an adventure! Bot out. 👋' }).catch(() => {});
    console.log('the adventure has ended');
    break;
  }
  await sleep(pollMs);
}
