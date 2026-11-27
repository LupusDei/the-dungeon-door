/**
 * Plays whole games through the real game flow (the API handlers, the in-memory store, the fake DM) with
 * bots at the table, and reports how they go: scenes, fights, rounds, deaths, levels, and anything that
 * broke. Costs nothing. Use it to check the rules engine end to end and to see how deadly it is.
 *
 *   npm run playtest                                   # 40 mapped dungeons for a few typical parties
 *   npm run playtest -- --games 200 --dungeon explore --party fighter,wizard
 *   npm run playtest -- --dungeon none --fights 2      # story games where the DM offers a fight of 2 monsters
 *   npm run playtest -- --scenes 8 --party fighter,rogue,cleric,wizard
 */
import { randomUUID } from 'node:crypto';

process.env.DD_FAKE_AI = '1';
delete process.env.DATABASE_URL;
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.DD_APP_KEY;
delete process.env.DD_FAKE_DELAY_MS;

const charactersApi = await import('../api/characters.ts');
const gamesApi = await import('../api/games.ts');
const joinApi = await import('../api/game-join.ts');
const startApi = await import('../api/game-start.ts');
const voteApi = await import('../api/game-vote.ts');
const advanceApi = await import('../api/game-advance.ts');
const gameApi = await import('../api/game.ts');
const { settle } = await import('../lib/background.ts');
const { fakeDungeonMaster } = await import('../lib/dm/fake.ts');
const { registerDungeonMaster } = await import('../lib/dm/registry.ts');
import { supportedAppVersionHeader } from '../lib/app-version.ts';
import type { DMContext, DungeonMaster } from '../lib/dm/types.ts';
import type { GameState } from '../lib/types.ts';

type Handler = (request: Request) => Promise<Response>;

async function call<T>(handler: Handler, path: string, player: string, body?: unknown, method?: string): Promise<T> {
  const response = await handler(new Request(`http://localhost:3000${path}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { 'content-type': 'application/json', 'x-dd-player': player, 'x-dd-app-version': supportedAppVersionHeader() },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const json = await response.json();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(json)}`);
  return json as T;
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const GAMES = Number(arg('games', '40'));
const DUNGEON = arg('dungeon', 'fixed');
const SCENES = Number(arg('scenes', '6'));
/** In a story game: the DM offers a fight with this many monsters picked from the ones it is told suit the party. */
const FIGHTS = Number(arg('fights', '0'));
const PARTIES = process.argv.includes('--party')
  ? [arg('party', 'fighter').split(',')]
  : [['fighter'], ['wizard'], ['rogue', 'cleric'], ['fighter', 'rogue', 'cleric', 'wizard'], ['barbarian', 'bard', 'druid', 'monk', 'paladin', 'warlock']];
const MAX_STEPS = 200;

/** A small rng for the DM's picks, so a run can be repeated. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const pick = lcg(20261126);

/** The fake DM, except that its first choice is always a fight with monsters from the list it was given. */
function brawler(count: number): DungeonMaster {
  const fight = (ctx: DMContext) => {
    const offered = ctx.rules?.monsters ?? [];
    return { kind: 'fight', monsters: Array.from({ length: count }, () => offered[Math.floor(pick() * offered.length)]) };
  };
  const withFight = <T extends { choices: { label: string; detail: string; rules?: unknown }[] }>(ctx: DMContext, scene: T): T =>
    ({ ...scene, choices: [{ label: 'Fight', detail: 'Draw steel.', rules: fight(ctx) }, ...scene.choices.slice(1)] });
  return {
    openingScene: async (ctx) => withFight(ctx, await fakeDungeonMaster.openingScene(ctx)),
    nextScene: async (ctx, r) => withFight(ctx, await fakeDungeonMaster.nextScene(ctx, r)),
    finale: (ctx, r) => fakeDungeonMaster.finale(ctx, r),
  };
}
if (FIGHTS > 0) registerDungeonMaster('chronicler', brawler(FIGHTS));

interface Tally {
  games: number; scenes: number; maxScenes: number; paintings: number; fights: number; rounds: number; maxRounds: number;
  won: number; fled: number; wipes: number; heroes: number; dead: number; levels: number; broke: string[];
}
const blank = (): Tally => ({ games: 0, scenes: 0, maxScenes: 0, paintings: 0, fights: 0, rounds: 0, maxRounds: 0, won: 0, fled: 0, wipes: 0, heroes: 0, dead: 0, levels: 0, broke: [] });

async function hero(player: string, characterClass: string, n: number) {
  const body = { id: randomUUID(), name: `${characterClass[0].toUpperCase()}${characterClass.slice(1)} ${n}`, race: 'human', characterClass, gender: 'female', temperament: 'brave', alignment: 'true-neutral', backstory: '', description: '' };
  return call<{ id: string }>(charactersApi.PUT, '/api/characters', player, body, 'PUT');
}

const gamePath = (code: string, action?: string) => `/api/game${action ? `-${action}` : ''}?code=${code}`;

async function play(party: string[], tally: Tally): Promise<void> {
  const players = party.map(() => randomUUID());
  const heroes = await Promise.all(players.map((p, i) => hero(p, party[i], i + 1)));
  const { code } = await call<GameState>(gamesApi.POST, '/api/games', players[0], { characterId: heroes[0].id });
  for (let i = 1; i < players.length; i++) await call(joinApi.POST, gamePath(code, 'join'), players[i], { characterId: heroes[i].id });
  await call(startApi.POST, gamePath(code, 'start'), players[0], { sceneCount: SCENES, dungeon: DUNGEON });
  await settle();
  let state = await call<GameState>(gameApi.GET, gamePath(code), players[0]);
  let rounds = 0;
  const pictures = new Set<string>();
  for (let step = 0; step < MAX_STEPS && state.status === 'voting'; step++) {
    const scene = state.scene!;
    if (scene.imageUrl) pictures.add(scene.imageUrl);
    if (scene.combat) rounds++;
    // In a fight: Cast (the best damaging spell, or the weapon for those without one). Otherwise the first choice:
    // the way on in a dungeon, the fight when the DM offers one.
    // A round resolves as soon as every hero that can act has voted, so the fallen are not asked.
    const up = new Set((state.rules?.combat?.combatants ?? []).filter((c) => c.status === 'up').map((c) => c.id));
    for (const player of players.filter((p) => !scene.combat || up.has(p))) {
      await call(voteApi.POST, gamePath(code, 'vote'), player, { sceneIndex: scene.index, choiceId: scene.combat ? 'b' : 'a' });
    }
    await settle();
    let next = await call<GameState>(gameApi.GET, gamePath(code), players[0]);
    if (next.status === 'voting' && next.scene!.index === scene.index) {
      await call(advanceApi.POST, gamePath(code, 'advance'), players[0], {});
      await settle();
      next = await call<GameState>(gameApi.GET, gamePath(code), players[0]);
    }
    for (const line of next.rules?.results ?? []) {
      if (line.startsWith('A fight begins')) tally.fights++;
      if (line.startsWith('Victory!')) tally.won++;
      if (line.startsWith('The foes flee')) tally.fled++;
      if (/reaches level \d+/.test(line)) tally.levels++;
    }
    if (scene.combat && !next.scene?.combat) { tally.rounds += rounds; tally.maxRounds = Math.max(tally.maxRounds, rounds); rounds = 0; }
    state = next;
  }
  if (state.scene?.imageUrl) pictures.add(state.scene.imageUrl);
  const partyNow = state.rules?.party ?? [];
  const dead = partyNow.filter((h) => h.dead).length;
  tally.games++;
  tally.scenes += (state.scene?.index ?? 0) + 1;
  tally.maxScenes = Math.max(tally.maxScenes, (state.scene?.index ?? 0) + 1);
  tally.paintings += pictures.size;
  tally.heroes += partyNow.length;
  tally.dead += dead;
  if (partyNow.length > 0 && dead === partyNow.length) tally.wipes++;
  if (state.status !== 'ended') tally.broke.push(`${code} stopped in "${state.status}" at scene ${state.scene?.index}`);
}

const pct = (n: number, of: number) => (of === 0 ? '–' : `${Math.round((100 * n) / of)}%`);
const avg = (n: number, of: number) => (of === 0 ? '–' : (n / of).toFixed(1));

const errors: string[] = [];
const realError = console.error;
console.error = (...args: unknown[]) => { errors.push(args.map(String).join(' ').slice(0, 300)); };

console.log(`${GAMES} games each · dungeon: ${DUNGEON} · sceneCount ${SCENES}${FIGHTS ? ` · the DM offers fights of ${FIGHTS}` : ''}\n`);
console.log('party                                    scenes  (max)  pictures  fights    won  rounds/fight (max)  heroes dead  party wiped  levels gained');
for (const party of PARTIES) {
  const tally = blank();
  for (let g = 0; g < GAMES; g++) {
    try { await play(party, tally); } catch (error) { tally.broke.push(String(error).slice(0, 200)); }
  }
  console.log([
    party.join(',').padEnd(40),
    avg(tally.scenes, tally.games).padStart(6), `(${tally.maxScenes})`.padStart(6), avg(tally.paintings, tally.games).padStart(9),
    avg(tally.fights, tally.games).padStart(7), pct(tally.won, tally.fights).padStart(6), avg(tally.rounds, tally.fights).padStart(8), `(${tally.maxRounds})`.padStart(10),
    pct(tally.dead, tally.heroes).padStart(12), pct(tally.wipes, tally.games).padStart(12), avg(tally.levels, tally.games).padStart(14),
  ].join(' '));
  for (const line of [...new Set(tally.broke)].slice(0, 5)) console.log(`    broke: ${line}`);
}
console.error = realError;
if (errors.length) {
  console.log(`\n${errors.length} errors logged; the first few:`);
  for (const line of [...new Set(errors)].slice(0, 8)) console.log(`  ${line}`);
}
