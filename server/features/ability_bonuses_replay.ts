/**
 * One replay of an ability-bonus journal. The generated Gherkin specs call helpers synchronously,
 * so each step runs this file in a child process and reads the view back.
 *
 * stdin: `{ ids, ops }`. stdout: a line `__DD_VIEW__` then the view as JSON.
 */
import * as boostApi from '../api/character-ability-boost.ts';
import * as charactersApi from '../api/characters.ts';
import * as endingApi from '../api/game-ending.ts';
import * as joinApi from '../api/game-join.ts';
import * as startApi from '../api/game-start.ts';
import * as voteApi from '../api/game-vote.ts';
import * as gameApi from '../api/game.ts';
import * as gamesApi from '../api/games.ts';
import * as sheetApi from '../api/sheet.ts';
import { call, gamePath, makeCharacter } from '../lib/api.fixture.ts';
import { settle } from '../lib/background.ts';
import { setDice } from '../lib/game.ts';
import type { AbilityScores } from '../lib/rules/abilities.ts';
import type { CharacterSheet } from '../lib/rules/sheet.ts';
import { MemoryStore } from '../lib/store/memory.ts';
import { getStore, setStore } from '../lib/store/index.ts';
import type { Character, GameState } from '../lib/types.ts';

type Ability = keyof AbilityScores;

type Op =
  | { op: 'forge'; boost: unknown }
  | { op: 'preview'; boost: unknown }
  | { op: 'place'; boost: unknown }
  | { op: 'drift'; ability: Ability; by: number }
  | { op: 'seat'; other: string }
  | { op: 'start' }
  | { op: 'end' };

interface Ids { bryn: string; hero: string; other: string }

interface View {
  status: number;
  error: string | null;
  home: Character | null;
  forge: AbilityScores;
  preview: CharacterSheet | null;
  table: AbilityScores | null;
  gameStatus: string | null;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function replay({ ids, ops }: { ids: Ids; ops: Op[] }): Promise<View> {
  const build = {
    id: ids.hero, name: 'Bryn', race: 'human', characterClass: 'fighter', backgroundId: 'soldier',
    gender: 'female', temperament: 'brave', alignment: 'true-neutral', backstory: '', description: '',
  };
  let status = 0;
  let error: string | null = null;
  let preview: CharacterSheet | null = null;
  let code = '';
  const record = (res: { status: number; body: { error?: string } | null }) => {
    status = res.status;
    error = res.status === 200 ? null : (res.body?.error ?? null);
  };
  const look = async () => (await call<GameState>(gameApi.GET, gamePath(code), { player: ids.bryn })).body;

  for (const op of ops) {
    if (op.op === 'forge') {
      record(await call(charactersApi.PUT, '/api/characters', {
        player: ids.bryn, method: 'PUT', body: op.boost === null ? build : { ...build, boost: op.boost },
      }));
    } else if (op.op === 'preview') {
      const res = await call<{ sheet: CharacterSheet; error?: string }>(sheetApi.POST, '/api/sheet', { player: ids.bryn, body: { ...build, boost: op.boost } });
      record(res);
      preview = res.status === 200 ? res.body.sheet : null;
    } else if (op.op === 'place') {
      record(await call(boostApi.POST, '/api/characters/ability-boost', { player: ids.bryn, body: { characterId: ids.hero, boost: op.boost } }));
    } else if (op.op === 'drift') {
      const stored = await getStore().getCharacter(ids.hero);
      if (!stored?.sheet) throw new Error('Bryn has no sheet to change');
      const scores = { ...stored.sheet.abilityScores, [op.ability]: stored.sheet.abilityScores[op.ability] + op.by };
      await getStore().saveCharacter({ ...stored, sheet: { ...stored.sheet, abilityScores: scores } });
    } else if (op.op === 'seat') {
      const other = await makeCharacter(ids.other, op.other);
      const created = await call<GameState>(gamesApi.POST, '/api/games', { player: ids.bryn, body: { characterId: ids.hero } });
      if (created.status !== 200) throw new Error(`could not open a table: ${JSON.stringify(created.body)}`);
      code = created.body.code;
      const joined = await call(joinApi.POST, gamePath(code, 'join'), { player: ids.other, body: { characterId: other.id } });
      if (joined.status !== 200) throw new Error(`could not seat ${op.other}: ${JSON.stringify(joined.body)}`);
    } else if (op.op === 'start') {
      const started = await call(startApi.POST, gamePath(code, 'start'), { player: ids.bryn, body: { sceneCount: 3 } });
      if (started.status !== 200) throw new Error(`could not begin: ${JSON.stringify(started.body)}`);
      await settle();
    } else {
      const called = await call(endingApi.POST, gamePath(code, 'ending'), { player: ids.bryn });
      if (called.status !== 200) throw new Error(`could not call the ending: ${JSON.stringify(called.body)}`);
      let state = await look();
      for (let turns = 0; state.status !== 'ended' && turns < 30; turns++) {
        if (state.status === 'voting' && state.scene) {
          for (const player of [ids.bryn, ids.other]) {
            await call(voteApi.POST, gamePath(code, 'vote'), { player, body: { sceneIndex: state.scene.index, choiceId: 'a' } });
          }
        }
        await settle();
        state = await look();
      }
      if (state.status !== 'ended') throw new Error(`the adventure did not end: ${state.status}`);
    }
  }

  const mine = await call<{ characters: Character[] }>(charactersApi.GET, '/api/characters', { player: ids.bryn });
  const forged = await call<{ sheet: CharacterSheet }>(sheetApi.POST, '/api/sheet', { player: ids.bryn, body: build });
  const table = code ? await look() : null;
  const seated = table?.players.find((p) => p.playerId === ids.bryn);
  return {
    status,
    error,
    home: mine.body.characters.find((c) => c.id === ids.hero) ?? null,
    forge: forged.body.sheet.abilityScores,
    preview,
    table: seated?.character.sheet?.abilityScores ?? null,
    gameStatus: table?.status ?? null,
  };
}

const raw = await readStdin();
setStore(new MemoryStore());
setDice({ d20: () => 15, seed: () => 5 });
try {
  const view = await replay(JSON.parse(raw));
  await settle();
  process.stdout.write(`\n__DD_VIEW__\n${JSON.stringify(view)}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
}
