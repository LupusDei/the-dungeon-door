/**
 * One game into a fight, through the API, for features/combat_hud.feature. The generated Gherkin specs
 * call helpers synchronously, so the step runs this file in a child process and reads the views back.
 *
 * stdin: { monster, share } (the foe's id, and the share of its hit points it is left with).
 * stdout: a line `__DD_VIEW__` then { views, foes }: the game state each player is sent, and the foes as stored.
 */
import { randomUUID } from 'node:crypto';

import * as joinApi from '../api/game-join.ts';
import * as startApi from '../api/game-start.ts';
import * as voteApi from '../api/game-vote.ts';
import * as gameApi from '../api/game.ts';
import * as gamesApi from '../api/games.ts';
import { call, gamePath, makeCharacter } from '../lib/api.fixture.ts';
import { settle } from '../lib/background.ts';
import { fakeDungeonMaster } from '../lib/dm/fake.ts';
import { registerDungeonMaster } from '../lib/dm/registry.ts';
import { monsters } from '../lib/rules/monsters.ts';
import type { DungeonMaster } from '../lib/dm/types.ts';
import { getStore, setStore } from '../lib/store/index.ts';
import { MemoryStore } from '../lib/store/memory.ts';
import type { GameState } from '../lib/types.ts';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/** A DM whose first choice is a fight with these monsters. */
function fightingDM(monsters: string[]): DungeonMaster {
  const withFight = <T extends { choices: { label: string; detail: string; rules?: unknown }[] }>(scene: T): T =>
    ({ ...scene, choices: [{ label: 'Fight', detail: 'Draw steel.', rules: { kind: 'fight', monsters } }, ...scene.choices.slice(1)] });
  return {
    openingScene: async (ctx) => withFight(await fakeDungeonMaster.openingScene(ctx)),
    nextScene: async (ctx, r) => withFight(await fakeDungeonMaster.nextScene(ctx, r)),
    finale: (ctx, r) => fakeDungeonMaster.finale(ctx, r),
  };
}

/** A new game played to its first fight; null when wanderers or the dungeon got there before the DM's fight. */
async function intoFight(monster: string): Promise<{ code: string; players: string[] } | null> {
  setStore(new MemoryStore());
  const players = [randomUUID(), randomUUID()];
  const heroes = await Promise.all(players.map((p, i) => makeCharacter(p, ['Bryn', 'Cleo'][i], { race: 'human', characterClass: ['fighter', 'wizard'][i] })));
  const { body } = await call<GameState>(gamesApi.POST, '/api/games', { player: players[0], body: { characterId: heroes[0].id } });
  const code = body.code;
  await call(joinApi.POST, gamePath(code, 'join'), { player: players[1], body: { characterId: heroes[1].id } });
  await call(startApi.POST, gamePath(code, 'start'), { player: players[0], body: { sceneCount: 3 } });
  await settle();
  for (const p of players) await call(voteApi.POST, gamePath(code, 'vote'), { player: p, body: { sceneIndex: 0, choiceId: 'a' } });
  await settle();
  const name = monsters().get(monster)?.name;
  const combat = (await getStore().getGame(code))?.combat;
  const foes = Object.values(combat?.combatants ?? {}).filter((c) => c.side === 'foes');
  return foes.length > 0 && foes.every((c) => c.name === name) ? { code, players } : null;
}

async function main(): Promise<void> {
  const { monster, share } = JSON.parse(await readStdin()) as { monster: string; share: number };
  registerDungeonMaster('chronicler', fightingDM([monster]));
  let table: { code: string; players: string[] } | null = null;
  for (let tries = 0; !table && tries < 20; tries++) table = await intoFight(monster);
  if (!table) throw new Error(`the party never got into a fight with the ${monster}`);
  const { code, players } = table;

  const combat = (await getStore().getGame(code))!.combat!;
  const combatants = Object.fromEntries(Object.entries(combat.combatants).map(([id, c]) =>
    [id, c.side === 'foes' ? { ...c, hp: Math.max(1, Math.floor(c.maxHp * share)) } : c]));
  await getStore().updateGame(code, {}, { combat: { ...combat, combatants } });

  const views = await Promise.all(players.map(async (player) => (await call<GameState>(gameApi.GET, gamePath(code), { player })).body));
  const foes = Object.values(combatants).filter((c) => c.side === 'foes').map(({ id, name, hp, maxHp }) => ({ id, name, hp, maxHp }));
  process.stdout.write(`__DD_VIEW__\n${JSON.stringify({ views, foes })}`);
  await settle();
}

main().then(() => process.exit(0), (error) => {
  console.error(error);
  process.exit(1);
});
