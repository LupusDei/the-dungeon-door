/** Rules-engine games played through the API handlers, with a seeded game and scripted d20s. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, test } from 'node:test';

process.env.DD_FAKE_AI = '1';
delete process.env.DATABASE_URL;
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.DD_APP_KEY;
delete process.env.DD_FAKE_DELAY_MS;

import * as advanceApi from '../../api/game-advance.ts';
import * as reviveApi from '../../api/character-revive.ts';
import * as charactersApi from '../../api/characters.ts';
import * as joinApi from '../../api/game-join.ts';
import * as startApi from '../../api/game-start.ts';
import * as voteApi from '../../api/game-vote.ts';
import * as gameApi from '../../api/game.ts';
import * as gamesApi from '../../api/games.ts';
import { call, gamePath, makeCharacter } from '../api.fixture.ts';
import { settle } from '../background.ts';
import { fakeDungeonMaster } from '../dm/fake.ts';
import { registerDungeonMaster, unregisterDungeonMaster } from '../dm/registry.ts';
import type { DMContext, DungeonMaster, Resolution } from '../dm/types.ts';
import { setDice } from '../game.ts';
import { getStore, setStore } from '../store/index.ts';
import { MemoryStore } from '../store/memory.ts';
import type { Character, GameState } from '../types.ts';

let rolls: number[] = [];
const d20 = (...next: number[]) => { rolls = next; };

beforeEach(() => {
  setStore(new MemoryStore());
  setDice({ d20: () => rolls.shift() ?? 10, seed: () => 42 });
});
afterEach(async () => {
  await settle();
  unregisterDungeonMaster('chronicler');
  setDice();
});

async function table(n: number, characterClass = 'fighter') {
  const players = Array.from({ length: n }, () => randomUUID());
  const characters = await Promise.all(players.map((p, i) => makeCharacter(p, `Hero ${i + 1}`, { race: 'human', characterClass })));
  const { body } = await call<GameState>(gamesApi.POST, '/api/games', { player: players[0], body: { characterId: characters[0].id } });
  for (let i = 1; i < n; i++) await call(joinApi.POST, gamePath(body.code, 'join'), { player: players[i], body: { characterId: characters[i].id } });
  return { code: body.code, players, host: players[0], characters };
}

const view = async (code: string, player: string) => (await call<GameState>(gameApi.GET, gamePath(code), { player })).body;
const start = (code: string, host: string, body: Record<string, unknown> = {}) => call<GameState>(startApi.POST, gamePath(code, 'start'), { player: host, body: { sceneCount: 4, ...body } });
async function voteAll(code: string, players: string[], sceneIndex: number, choiceId: string) {
  for (const player of players) await call(voteApi.POST, gamePath(code, 'vote'), { player, body: { sceneIndex, choiceId } });
  await settle();
}

/** A DM whose first choice carries this hook, and that records what it was told. */
function hookDM(hook: unknown, label: string, seen: { ctx: DMContext; resolution?: Resolution }[] = []): DungeonMaster {
  const withHook = <T extends { choices: { label: string; detail: string; rules?: unknown }[] }>(scene: T): T =>
    ({ ...scene, choices: [{ label, detail: 'Try it.', rules: hook }, ...scene.choices.slice(1)] });
  return {
    openingScene: async (ctx) => { seen.push({ ctx }); return withHook(await fakeDungeonMaster.openingScene(ctx)); },
    nextScene: async (ctx, resolution) => { seen.push({ ctx, resolution }); return withHook(await fakeDungeonMaster.nextScene(ctx, resolution)); },
    finale: async (ctx, resolution) => { seen.push({ ctx, resolution }); return fakeDungeonMaster.finale(ctx, resolution); },
  };
}

/** A DM that offers a fight (choice a) with the given monsters. */
const fightingDM = (monsters: string[], seen: { ctx: DMContext; resolution?: Resolution }[] = []) => hookDM({ kind: 'fight', monsters }, 'Fight', seen);

test('a new game carries the rules: the heroes’ numbers, choices with their dice, and the dice in chat', async () => {
  const { code, players, host } = await table(2);
  await start(code, host);
  await settle();
  let state = await view(code, host);
  assert.deepEqual(state.rules!.party.map((h) => [h.playerId, h.name, h.level, h.down]), [[host, 'Hero 1', 1, false], [players[1], 'Hero 2', 1, false]]);
  assert.deepEqual([state.rules!.combat, state.rules!.dungeon, state.rules!.results], [null, null, []]);
  assert.deepEqual(state.scene!.choices.map((c) => c.rules), ['Athletics check, DC 10', 'Perception check, DC 10', 'Persuasion check, DC 15']);
  assert.equal(state.scene!.combat, false);

  d20(15, 2);
  await voteAll(code, players, 0, 'a');
  state = await view(code, host);
  assert.equal(state.rules!.results.length, 2);
  assert.match(state.rules!.results[0], /^Hero 1: Athletics 15 \+ \d+ = \d+ vs DC 10, success$/);
  assert.match(state.rules!.results[1], /^Hero 2: Athletics 2 \+ \d+ = \d+ vs DC 10, (success|failure)$/);
  const system = state.messages.filter((m) => m.kind === 'system').map((m) => m.text);
  for (const line of state.rules!.results) assert.ok(system.includes(line), line);
  assert.deepEqual(state.scene!.choices.map((c) => c.rules), ['Athletics check, DC 10', 'Perception check, DC 10', 'Persuasion check, DC 15'], 'the next scene’s hooks too');
});

test('a tie goes to the choice whose voter rolled higher, whatever the DM says', async () => {
  const seen: { ctx: DMContext; resolution?: Resolution }[] = [];
  registerDungeonMaster('chronicler', { ...fightingDM(['goblin-warrior'], seen), nextScene: async (ctx, r) => { seen.push({ ctx, resolution: r }); return { ...(await fakeDungeonMaster.nextScene(ctx, r)), chosenChoiceId: 'b' }; } });
  const { code, players, host } = await table(2);
  await start(code, host);
  await settle();
  d20(4, 17);
  await call(voteApi.POST, gamePath(code, 'vote'), { player: host, body: { sceneIndex: 0, choiceId: 'b' } });
  await call(voteApi.POST, gamePath(code, 'vote'), { player: players[1], body: { sceneIndex: 0, choiceId: 'c' } });
  await settle();
  const state = await view(code, host);
  assert.equal(state.chronicle[0].choiceLabel, 'Parley first');
  assert.deepEqual(seen.at(-1)!.resolution!.leaders, ['c']);
  assert.deepEqual(seen.at(-1)!.resolution!.rules!.chosen, 'c');
  assert.equal(seen.at(-1)!.resolution!.rules!.success, true, 'DC 15 Persuasion: the 17 succeeds, and half the party is enough (5.2)');
});

test('a fight: rounds of Attack, Cast and Dodge add scenes; the won fight gives XP that goes home with the heroes', async () => {
  const seen: { ctx: DMContext; resolution?: Resolution }[] = [];
  registerDungeonMaster('chronicler', fightingDM(['rat'], seen));
  const { code, players, host, characters } = await table(2);
  await start(code, host, { sceneCount: 3 });
  await settle();
  assert.equal(seen[0].ctx.rules!.party.length, 2, 'the DM sees the party');
  let state = await view(code, host);
  assert.equal(state.scene!.choices[0].rules, 'Fight: Rat');

  await voteAll(code, players, 0, 'a');
  state = await view(code, host);
  assert.equal(seen.at(-1)!.resolution!.rules!.fight, 'started');
  assert.ok(seen.at(-1)!.ctx.rules!.combat, 'the DM sees the fight');
  assert.equal(state.scene!.combat, true);
  assert.match(state.scene!.choices.map((c) => c.label).join(' | '), /^Attack with .+ \| (Attack with|Cast) .+ \| Dodge$/, 'written for the caller’s hero');
  assert.equal(state.rules!.combat!.round, 1);
  assert.equal(state.sceneCount, 4, 'scene 1 is a round, counted as it is made; the last story scene and the epilogue are still to come');
  assert.match(state.messages.filter((m) => m.kind === 'system').at(-1)!.text, /^A fight begins: Rat\. Initiative: /);

  let index = 1;
  while (state.scene!.combat) {
    d20(20, 20);
    await voteAll(code, players, index++, 'a');
    state = await view(code, host);
    assert.ok(index < 12, 'the fight ends');
  }
  assert.equal(seen.at(-1)!.resolution!.rules!.fight, 'victory');
  assert.equal(state.rules!.combat, null);
  assert.ok(state.rules!.results.some((l) => /^Victory! 10 XP, 5 each\.$/.test(l)));
  assert.equal(state.sceneCount, index + 2, 'each round was a scene');
  assert.equal(state.status, 'voting', 'the story goes on after the fight');
  assert.equal(state.rules!.party[0].xp, 5);

  await voteAll(code, players, index, 'b');
  state = await view(code, host);
  assert.equal(state.status, 'ended');
  const { body } = await call<{ characters: Character[] }>(charactersApi.GET, '/api/characters', { player: host });
  const hero = body.characters.find((c) => c.id === characters[0].id)!;
  assert.equal(hero.sheet.xp, 5, 'the XP went home');
  assert.equal(hero.sheet.hp, hero.sheet.maxHp, 'rested');
});

test('every hero down: the fight is lost and the next scene is the epilogue', async () => {
  registerDungeonMaster('chronicler', fightingDM(['ogre', 'ogre', 'ogre']));
  const { code, players, host } = await table(1, 'wizard');
  await start(code, host, { sceneCount: 8 });
  await settle();
  await voteAll(code, players, 0, 'a');
  let state = await view(code, host);
  let index = 1;
  while (state.status === 'voting') {
    d20(1);
    await voteAll(code, players, index++, 'c');
    state = await view(code, host);
    assert.ok(index < 12, 'the fight ends');
  }
  assert.equal(state.status, 'ended');
  assert.equal(state.scene!.isFinale, true);
  assert.equal(state.sceneCount, index + 1);
  const [hero] = state.rules!.party;
  assert.ok(hero.dead || hero.hp >= 1, 'the lost fight settles the fallen: dead, or pulled through');
  const { body } = await call<{ characters: Character[] }>(charactersApi.GET, '/api/characters', { player: host });
  const sheet = body.characters[0].sheet;
  assert.ok(sheet.dead === true ? sheet.hp === 0 : sheet.hp === sheet.maxHp, 'the slain go home dead; a hero who pulled through goes home rested');
});

test('a fixed dungeon chosen at start: the map, the party moving through it, what is in each room', async () => {
  const { code, players, host } = await table(2);
  assert.equal((await start(code, host, { dungeon: 'maze' })).status, 400);
  await start(code, host, { dungeon: 'fixed' });
  await settle();
  let state = await view(code, host);
  const map = state.rules!.dungeon!;
  assert.deepEqual([map.mode, map.at, map.areas.length], ['fixed', 'r0', 1]);
  const exit = map.areas[0].exits[0].id;
  assert.equal(state.scene!.choices[0].rules, `Go on (${exit})`);
  await voteAll(code, players, 0, 'a');
  state = await view(code, host);
  assert.equal(state.rules!.dungeon!.at, exit, 'through any corridor to the room');
  assert.deepEqual(state.rules!.dungeon!.areas.map((a) => a.id).filter((id) => !id.includes('-')), ['r0', exit]);
  assert.ok(state.rules!.results.some((l) => /^The party enters /.test(l)));
});

test('explore mode rolls each area as the party opens it', async () => {
  const { code, players, host } = await table(1);
  await start(code, host, { dungeon: 'explore' });
  await settle();
  let state = await view(code, host);
  assert.equal(state.rules!.dungeon!.mode, 'explore');
  assert.ok(state.rules!.dungeon!.areas[0].exits.every((x) => x.to === null));
  await voteAll(code, players, 0, 'a');
  state = await view(code, host);
  assert.equal(state.rules!.dungeon!.areas.length, 2);
});

test('a game from before the engine still plays: no rules, no hooks, no combat', async () => {
  const { code, players, host } = await table(2);
  await start(code, host);
  await settle();
  await getStore().updateGame(code, {}, { party: null, combat: null, dungeon: null });
  await voteAll(code, players, 0, 'a');
  const state = await view(code, host);
  assert.equal(state.rules, null);
  assert.equal(state.scene!.combat, false);
  assert.deepEqual(state.scene!.choices.map((c) => c.rules), [null, null, null]);
  assert.equal(state.status, 'voting');
  await voteAll(code, players, 1, 'b');
  assert.equal((await view(code, host)).status, 'voting');
  await call(voteApi.POST, gamePath(code, 'vote'), { player: host, body: { sceneIndex: 2, choiceId: 'c' } });
  await call(advanceApi.POST, gamePath(code, 'advance'), { player: host });
  await settle();
  const ended = await view(code, host);
  assert.deepEqual([ended.status, ended.scene!.index, ended.scene!.isFinale, ended.sceneCount], ['ended', 3, true, 4]);
});

test('a dead hero stays dead: it cannot start or join an adventure until revived', async () => {
  const { code, characters } = await table(1);
  const [player, lost] = [randomUUID(), randomUUID()];
  const fallen = await makeCharacter(lost, 'Fallen', { race: 'human', characterClass: 'fighter' });
  const stored = await getStore().getCharacter(fallen.id);
  await getStore().saveCharacter({ ...stored!, sheet: { ...fallen.sheet!, hp: 0, dead: true } });
  const created = await call<{ error: string }>(gamesApi.POST, '/api/games', { player: lost, body: { characterId: fallen.id } });
  assert.deepEqual([created.status, created.body.error], [409, 'Fallen is dead']);
  assert.equal((await call(joinApi.POST, gamePath(code, 'join'), { player: lost, body: { characterId: fallen.id } })).status, 409);
  assert.equal((await call(joinApi.POST, gamePath(code, 'join'), { player, body: { characterId: characters[0].id } })).status, 404, 'still only your own heroes');
});

test('a parley the DM offers: a good word and the goblin lets the party be; a bad one and it attacks', async () => {
  registerDungeonMaster('chronicler', hookDM({ kind: 'parley', monsters: ['goblin-warrior'] }, 'Talk'));
  const calm = await table(1);
  await start(calm.code, calm.host, { sceneCount: 4 });
  await settle();
  assert.equal((await view(calm.code, calm.host)).scene!.choices[0].rules, 'Parley with Goblin Warrior');
  d20(20);
  await voteAll(calm.code, calm.players, 0, 'a');
  let state = await view(calm.code, calm.host);
  assert.ok(state.rules!.results.includes('The Goblin Warrior let the party be.'), state.rules!.results.join(' | '));
  assert.equal(state.rules!.combat, null);
  const sour = await table(1);
  await start(sour.code, sour.host, { sceneCount: 4 });
  await settle();
  d20(1);
  await voteAll(sour.code, sour.players, 0, 'a');
  state = await view(sour.code, sour.host);
  assert.ok(state.rules!.results.includes('The talk goes badly: the Goblin Warrior turn hostile.'));
  assert.equal(state.scene!.combat, true, 'the goblin attacks');
});

test('a dead hero goes to the temple between adventures, comes back with 1 HP and plays again', async () => {
  const player = randomUUID();
  const hero = await makeCharacter(player, 'Lazarus', { race: 'human', characterClass: 'fighter' });
  const stored = (await getStore().getCharacter(hero.id))!;
  await getStore().saveCharacter({ ...stored, sheet: { ...hero.sheet!, hp: 0, dead: true, gp: 2500 } });
  assert.equal((await call(gamesApi.POST, '/api/games', { player, body: { characterId: hero.id } })).status, 409);
  const back = await call<Character>(reviveApi.POST, '/api/characters/revive', { player, body: { characterId: hero.id } });
  assert.deepEqual([back.status, back.body.sheet.hp, back.body.sheet.gp], [200, 1, 0]);
  const game = await call<GameState>(gamesApi.POST, '/api/games', { player, body: { characterId: hero.id } });
  assert.equal(game.status, 200);
  await start(game.body.code, player);
  await settle();
  const [lazarus] = (await view(game.body.code, player)).rules!.party;
  assert.deepEqual([lazarus.dead, lazarus.hp], [false, 1], 'back from the dead, still weak');
});

test('phase 4 in play: the clock, the torch from the pack, a web that holds, Break Free, and what the DM is told', async () => {
  const seen: { ctx: DMContext; resolution?: Resolution }[] = [];
  registerDungeonMaster('chronicler', fightingDM(['giant-spider'], seen));
  const { code, players, host } = await table(1);
  await start(code, host, { sceneCount: 3, dungeon: 'fixed' });
  await settle();
  await voteAll(code, players, 0, 'a');
  let state = await view(code, host);
  assert.deepEqual(state.rules!.time, { seconds: 0, label: 'Day 1, 08:00' }, 'a fight takes no time to start');
  assert.equal(state.rules!.results[0], 'Hero 1 lights a Torch (1 hour).', 'from the opened Dungeoneer\u2019s Pack, before the fight');
  assert.deepEqual([state.rules!.light.level, state.rules!.light.source!.holder], ['bright', 'Hero 1']);
  assert.equal(state.rules!.party[0].sight, 'clear');
  assert.ok(state.rules!.party[0].inventory.some((i) => i.id === 'rations'), 'the pack is opened');
  assert.equal(state.rules!.party[0].inventory.some((i) => i.id === 'dungeoneer-pack'), false);
  await voteAll(code, players, 1, 'a');
  state = await view(code, host);
  assert.ok(state.rules!.results.includes('Giant Spider uses Web (DC 13 DEX save): Hero 1 fails, Restrained.'), state.rules!.results.join(' | '));
  assert.deepEqual(state.rules!.party[0].conditions, [{ condition: 'restrained', ends: 'DC 13 Athletics to break free' }]);
  assert.equal(state.scene!.choices[2].label, 'Break Free', 'the third choice, for the held hero');
  assert.equal(seen.at(-1)!.ctx.rules!.party[0].conditions, 'restrained (DC 13 Athletics to break free)', 'the DM is told');
  assert.equal(state.rules!.time.seconds, 6, 'a round is 6 seconds');
  d20(20);
  await voteAll(code, players, 2, 'c');
  state = await view(code, host);
  assert.ok(state.rules!.results.some((l) => /^Hero 1 (breaks free|strains against being Restrained)/.test(l)), state.rules!.results.join(' | '));
});

test('at the epilogue the heroes level up by their XP: the table, the DM and the API see it, and the hero goes home levelled', async () => {
  const seen: { ctx: DMContext; resolution?: Resolution }[] = [];
  registerDungeonMaster('chronicler', hookDM(null, 'Walk on', seen));
  const { code, players, host, characters } = await table(2);
  await start(code, host, { sceneCount: 2 });
  await settle();
  const game = (await getStore().getGame(code))!;
  await getStore().updateGame(code, {}, { party: { ...game.party!, sheets: { ...game.party!.sheets, [host]: { ...game.party!.sheets[host], xp: 300 } } } });
  await voteAll(code, players, 0, 'b');
  const state = await view(code, host);
  assert.equal(state.status, 'ended');
  assert.deepEqual(state.rules!.levelUps, [{ playerId: host, name: 'Hero 1', from: 1, to: 2 }]);
  const line = state.rules!.results.find((l) => /^Hero 1 reaches level 2 \(\+\d+ max HP\)\.$/.test(l));
  assert.ok(line, state.rules!.results.join(' | '));
  assert.ok(state.messages.some((m) => m.kind === 'system' && m.text === line), 'told to the table');
  assert.ok(seen.at(-1)!.resolution!.rules!.lines.includes(line!), 'and to the DM for the epilogue');
  assert.equal(seen.at(-1)!.ctx.rules!.party[0].level, 2);
  const { body } = await call<{ characters: Character[] }>(charactersApi.GET, '/api/characters', { player: host });
  assert.deepEqual(body.characters.filter((c) => characters.some((x) => x.id === c.id)).map((c) => c.sheet.level), [2]);
});
