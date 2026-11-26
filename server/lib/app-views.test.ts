/** What the app is shown on top of the rules engine: attacks, the sheet preview, the reference, and a fight written for each player. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, test } from 'node:test';

process.env.DD_FAKE_AI = '1';
delete process.env.DATABASE_URL;
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.DD_APP_KEY;
delete process.env.DD_FAKE_DELAY_MS;

import * as advanceApi from '../api/game-advance.ts';
import * as catalogApi from '../api/catalog.ts';
import * as charactersApi from '../api/characters.ts';
import * as joinApi from '../api/game-join.ts';
import * as referenceApi from '../api/reference.ts';
import * as sheetApi from '../api/sheet.ts';
import * as startApi from '../api/game-start.ts';
import * as voteApi from '../api/game-vote.ts';
import * as gameApi from '../api/game.ts';
import * as gamesApi from '../api/games.ts';
import { call, gamePath, makeCharacter } from './api.fixture.ts';
import { heroAttacks } from './attacks.ts';
import { settle } from './background.ts';
import { heroSheet } from './characters.ts';
import { fakeDungeonMaster } from './dm/fake.ts';
import { registerDungeonMaster, unregisterDungeonMaster } from './dm/registry.ts';
import type { DungeonMaster } from './dm/types.ts';
import { setDice } from './game.ts';
import { DUNGEON_MODES } from './play/table.ts';
import { autoLevelUp } from './play/fight.ts';
import { withCondition } from './rules/conditions.ts';
import { addItem } from './rules/inventory.ts';
import { awardXp } from './rules/leveling.ts';
import type { CharacterSheet } from './rules/sheet.ts';
import { srd } from './rules/srd.ts';
import { getStore, setStore } from './store/index.ts';
import { MemoryStore } from './store/memory.ts';
import type { Character, GameState } from './types.ts';

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

const sheetOf = (characterClass: string, over: Partial<CharacterSheet> = {}): CharacterSheet =>
  ({ ...heroSheet({ id: `test-${characterClass}`, name: 'Bryn', race: 'human', characterClass }), ...over });
const withSpells = (sheet: CharacterSheet, cantrips: string[], prepared: string[]): CharacterSheet =>
  ({ ...sheet, spellcasting: { ...sheet.spellcasting!, cantrips, prepared } });
const atLevel = (sheet: CharacterSheet, level: number): CharacterSheet =>
  autoLevelUp(awardXp(sheet, srd().advancement[level - 1].xp)).sheet;

// ---- catalog ----

test('the catalog: backgrounds say what they raise, and the kinds of game are the ones start accepts', async () => {
  const { body } = await call(catalogApi.GET, '/api/catalog');
  assert.deepEqual(body.backgrounds.map((b: { id: string }) => b.id).sort(), [...srd().backgrounds.keys()].sort());
  for (const b of body.backgrounds) {
    assert.deepEqual(b.abilities, srd().backgrounds.get(b.id)!.abilities, b.id);
    assert.ok(b.name && b.blurb.length > 20, `${b.id} has a blurb`);
  }
  assert.deepEqual(body.dungeons.map((d: { id: string }) => d.id), [...DUNGEON_MODES]);
  for (const d of body.dungeons) assert.ok(d.name && d.blurb && d.symbol, d.id);
});

// ---- attacks ----

test('attacks: a hero’s weapons with the engine’s numbers, or an unarmed strike', () => {
  const fighter = sheetOf('fighter');
  const attacks = heroAttacks(fighter);
  assert.ok(attacks.length > 0);
  for (const a of attacks) {
    assert.equal(a.kind, 'weapon');
    assert.equal(a.save, null);
    assert.match(a.damage, /^\d+(d\d+)?([+-]\d+)? [a-z]+$/, a.damage);
  }
  const bare = heroAttacks({ ...fighter, equipment: [] });
  assert.deepEqual(bare.map((a) => a.name), ['Unarmed Strike']);
});

test('attacks: then every cantrip and prepared spell that deals damage, by attack roll or by save', () => {
  const wizard = withSpells(sheetOf('wizard'), ['fire-bolt', 'light'], ['burning-hands', 'shield', 'magic-missile']);
  const spells = heroAttacks(wizard).filter((a) => a.kind === 'spell');
  assert.deepEqual(spells, [
    { name: 'Fire Bolt', bonus: wizard.spellcasting!.attackBonus, damage: '1d10 fire', ranged: true, kind: 'spell', save: null },
    { name: 'Burning Hands', bonus: 0, damage: '3d6 fire', ranged: true, kind: 'spell', save: 'dex' },
    { name: 'Magic Missile', bonus: 0, damage: '3 × 1d4+1 force', ranged: true, kind: 'spell', save: null },
  ], 'Light and Shield deal no damage; Magic Missile’s darts never miss (no roll, no save)');
  assert.deepEqual(heroAttacks(sheetOf('fighter')).filter((a) => a.kind === 'spell'), []);
});

test('attacks: cantrips grow with the hero’s level, and Eldritch Blast grows beams', () => {
  const wizard = atLevel(withSpells(sheetOf('wizard'), ['fire-bolt'], []), 5);
  assert.equal(wizard.level, 5);
  assert.equal(heroAttacks(wizard).find((a) => a.name === 'Fire Bolt')!.damage, '2d10 fire');
  const warlock = atLevel(withSpells(sheetOf('warlock'), ['eldritch-blast'], []), 5);
  assert.equal(heroAttacks(warlock).find((a) => a.name === 'Eldritch Blast')!.damage, '2 × 1d10 force');
});

test('a character always comes with its attacks', async () => {
  const me = randomUUID();
  const saved = await makeCharacter(me, 'Astrid', { race: 'goliath', characterClass: 'barbarian' });
  assert.deepEqual(saved.attacks, heroAttacks(saved.sheet));
  assert.ok(saved.attacks.length > 0);
  const listed = (await call<{ characters: Character[] }>(charactersApi.GET, '/api/characters', { player: me })).body.characters[0];
  assert.deepEqual(listed.attacks, saved.attacks);
  const stored = await getStore().getCharacter(saved.id);
  assert.equal('attacks' in stored!, false, 'attacks are worked out, not stored');
});

// ---- the forge's preview ----

const look = { gender: 'female', temperament: 'brave', alignment: 'true-neutral' };

test('POST /api/sheet shows the hero a save would build, and saves nothing', async () => {
  const me = randomUUID();
  const id = randomUUID();
  const build = { id, name: 'Mira', race: 'elf', characterClass: 'wizard', backgroundId: 'sage' };
  const preview = await call(sheetApi.POST, '/api/sheet', { player: me, body: build });
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.deepEqual([preview.body.sheet.classId, preview.body.sheet.speciesId, preview.body.sheet.backgroundId, preview.body.sheet.level], ['wizard', 'elf', 'sage', 1]);
  assert.deepEqual(preview.body.attacks, heroAttacks(preview.body.sheet));
  assert.deepEqual((await call(charactersApi.GET, '/api/characters', { player: me })).body.characters, []);
  const saved = await makeCharacter(me, 'Mira', { ...build, ...look });
  assert.deepEqual(saved.sheet, preview.body.sheet, 'the preview is the hero that gets saved');

  const other = await call(sheetApi.POST, '/api/sheet', { player: me, body: { ...build, backgroundId: 'soldier' } });
  assert.equal(other.body.sheet.backgroundId, 'soldier');
  const picked = await call(sheetApi.POST, '/api/sheet', { player: me, body: { ...build, backgroundId: undefined } });
  assert.ok(srd().backgrounds.has(picked.body.sheet.backgroundId), 'no background: one is picked');
  const legacy = await call(sheetApi.POST, '/api/sheet', { player: me, body: { ...build, race: 'half-orc' } });
  assert.equal(legacy.body.sheet.speciesId, 'orc');
});

test('POST /api/sheet refuses what a save would refuse', async () => {
  const me = randomUUID();
  const build = { id: randomUUID(), name: 'Mira', race: 'elf', characterClass: 'wizard' };
  const bad = async (over: Record<string, unknown>) => {
    const { status, body } = await call(sheetApi.POST, '/api/sheet', { player: me, body: { ...build, ...over } });
    return [status, body.error];
  };
  assert.deepEqual(await bad({ race: 'robot' }), [400, 'race: unknown race']);
  assert.deepEqual(await bad({ characterClass: 'juggler' }), [400, 'characterClass: unknown characterClass']);
  assert.deepEqual(await bad({ backgroundId: 'pirate' }), [400, 'backgroundId: unknown background']);
  assert.deepEqual(await bad({ id: 'nope' }), [400, 'id: id must be a UUID']);
  assert.equal((await call(sheetApi.POST, '/api/sheet', { body: build })).status, 401, 'needs a player');
});

// ---- reference ----

test('GET /api/reference explains every id a sheet can carry', async () => {
  const { status, body } = await call(referenceApi.GET, '/api/reference');
  assert.equal(status, 200);
  assert.deepEqual([body.spells['fire-bolt'].name, body.spells['fire-bolt'].level, body.spells['fire-bolt'].school], ['Fire Bolt', 0, 'Evocation']);
  assert.match(body.spells.fireball.description, /20-foot-radius/);
  assert.deepEqual([body.skills.stealth.name, body.skills.stealth.ability], ['Stealth', 'dex']);
  assert.match(body.attribution, /Creative Commons Attribution 4\.0/);
  for (const characterClass of srd().classes.keys()) {
    for (const race of srd().species.keys()) {
      const sheet = heroSheet({ id: `ref-${characterClass}-${race}`, name: 'X', race, characterClass });
      for (const id of sheet.skills) assert.ok(body.skills[id], `skill ${id}`);
      for (const id of sheet.traits) assert.ok(body.traits[id], `trait ${id}`);
      assert.ok(Object.values<{ name: string }>(body.feats).some((f) => f.name === sheet.feat), `feat ${sheet.feat}`);
      for (const id of [...(sheet.spellcasting?.cantrips ?? []), ...(sheet.spellcasting?.prepared ?? [])]) assert.ok(body.spells[id], `spell ${id}`);
    }
    const veteran = atLevel(sheetOf(characterClass), 20);
    assert.equal(veteran.level, 20);
    for (const name of veteran.features) assert.ok(body.features[characterClass][name]?.description.length > 20, `${characterClass} feature ${name}`);
  }
});

// ---- in a game ----

async function table(classes: string[]) {
  const players = classes.map(() => randomUUID());
  const characters = await Promise.all(players.map((p, i) => makeCharacter(p, `Hero ${i + 1}`, { race: 'human', characterClass: classes[i] })));
  const { body } = await call<GameState>(gamesApi.POST, '/api/games', { player: players[0], body: { characterId: characters[0].id } });
  for (let i = 1; i < players.length; i++) await call(joinApi.POST, gamePath(body.code, 'join'), { player: players[i], body: { characterId: characters[i].id } });
  return { code: body.code, players, host: players[0], characters };
}
const view = async (code: string, player: string) => (await call<GameState>(gameApi.GET, gamePath(code), { player })).body;
const vote = (code: string, player: string, sceneIndex: number, choiceId: string) => call(voteApi.POST, gamePath(code, 'vote'), { player, body: { sceneIndex, choiceId } });

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

/** Starts a game and takes the fight: the returned state is round 1. */
async function intoFight(classes: string[], monsters: string[], sceneCount = 3) {
  registerDungeonMaster('chronicler', fightingDM(monsters));
  const t = await table(classes);
  await call(startApi.POST, gamePath(t.code, 'start'), { player: t.host, body: { sceneCount } });
  await settle();
  for (const p of t.players) await vote(t.code, p, 0, 'a');
  await settle();
  return t;
}

/** Rewrites a hero inside the running game (its sheet and, in a fight, its combatant). */
async function wound(code: string, playerId: string, hp: number, status: 'up' | 'stable' = hp > 0 ? 'up' : 'stable') {
  const game = (await getStore().getGame(code))!;
  const party = { ...game.party!, sheets: { ...game.party!.sheets, [playerId]: { ...game.party!.sheets[playerId], hp } } };
  const combat = game.combat && { ...game.combat, combatants: { ...game.combat.combatants, [playerId]: { ...game.combat.combatants[playerId], hp, status } } };
  await getStore().updateGame(code, {}, { party, combat });
}

test('in a rules game each player’s character is the hero as it stands in the game', async () => {
  const { code, host, players, characters } = await table(['fighter', 'wizard']);
  let state = await view(code, host);
  assert.deepEqual(state.players.map((p) => p.character.attacks.length > 0), [true, true], 'in the lobby too');
  await call(startApi.POST, gamePath(code, 'start'), { player: host, body: {} });
  await settle();
  await wound(code, host, 3);
  state = await view(code, players[1]);
  assert.equal(state.players[0].character.sheet.hp, 3, 'live hit points');
  assert.equal(state.players[1].character.sheet.hp, characters[1].sheet.maxHp);
  assert.deepEqual(state.players[1].character.attacks, heroAttacks(state.players[1].character.sheet));
  assert.equal((await getStore().getCharacter(characters[0].id))!.sheet!.hp, characters[0].sheet.maxHp, 'the stored hero is untouched until the game ends');
});

test('a combat round is written for each player: what their own hero will do', async () => {
  const { code, players } = await intoFight(['fighter', 'wizard', 'fighter', 'fighter'], ['goblin-warrior', 'goblin-warrior']); // four heroes, so the DM's two goblins both come
  const game = (await getStore().getGame(code))!;
  await getStore().updateGame(code, {}, { party: { ...game.party!, sheets: { ...game.party!.sheets, [players[1]]: withSpells(game.party!.sheets[players[1]], ['fire-bolt'], ['burning-hands']) } } });
  const [fighter, wizard] = await Promise.all(players.map((p) => view(code, p)));
  assert.equal(fighter.scene!.combat, true);
  assert.deepEqual([fighter.scene!.canAct, wizard.scene!.canAct], [true, true]);
  assert.deepEqual(fighter.scene!.choices.map((c) => c.id), ['a', 'b', 'c']);
  assert.deepEqual(fighter.scene!.choices.map((c) => c.rules), [null, null, null]);

  const weapon = fighter.players[0].character.attacks.reduce((best, a) => (a.bonus > best.bonus ? a : best));
  assert.equal(fighter.scene!.choices[0].label, `Attack with ${weapon.name}`);
  assert.match(fighter.scene!.choices[0].detail, new RegExp(`^\\+${weapon.bonus} to hit, ${weapon.damage.replace(/[+]/g, '\\+')}, at Goblin Warrior [12]\\.$`));
  assert.equal(fighter.scene!.choices[1].label, fighter.scene!.choices[0].label, 'no spell: Cast is the same strike');
  assert.equal(fighter.scene!.choices[2].label, 'Dodge');

  assert.equal(wizard.scene!.choices[1].label, 'Cast Burning Hands');
  assert.match(wizard.scene!.choices[1].detail, /^3d6 fire, Dexterity save DC \d+ for half, at Goblin Warrior [12] and Goblin Warrior [12]\. Uses a level 1 slot \(\d left\)\.$/, 'a 15-foot cone catches two');
  assert.match(wizard.scene!.choices[0].label, /^Attack with /);
});

test('a hero at half its hit points or less is told it will drink its potion first, and the engine has it do so', async () => {
  const { code, players } = await intoFight(['fighter', 'fighter'], ['goblin-warrior']);
  const game = (await getStore().getGame(code))!;
  const carrying = Object.fromEntries(players.map((p) => [p, { ...addItem(game.party!.sheets[p], 'potion-of-healing'), resourcesUsed: { 'second-wind': 2 } }])); // Second Wind spent: the potion is next
  await getStore().updateGame(code, {}, { party: { ...game.party!, sheets: carrying } });
  await wound(code, players[0], 4);
  const [hurt, hale] = await Promise.all(players.map((p) => view(code, p)));
  for (const choice of hurt.scene!.choices) assert.match(choice.detail, / First drinks a Potion of Healing\.$/, choice.label);
  for (const choice of hale.scene!.choices) assert.doesNotMatch(choice.detail, /Potion/, 'unhurt: the potion stays in the pack');
  for (const p of players) await vote(code, p, hurt.scene!.index, 'c');
  await settle();
  const after = await view(code, players[0]);
  assert.equal(after.rules!.results.filter((line) => /drinks a Potion of Healing as a Bonus Action/.test(line)).length, 1, after.rules!.results.join(' | '));
});

test('the third choice fits the hero, and each vote in a round says what its hero is doing', async () => {
  const { code, players } = await intoFight(['fighter', 'fighter'], ['goblin-warrior']);
  const game = (await getStore().getGame(code))!;
  const held = withCondition(game.party!.sheets[players[0]], { condition: 'restrained', until: { kind: 'escape', ability: 'str', skill: 'athletics', dc: 12 } });
  await getStore().updateGame(code, {}, { party: { ...game.party!, sheets: { ...game.party!.sheets, [players[0]]: held } } });
  const [mine, theirs] = await Promise.all(players.map((p) => view(code, p)));
  assert.deepEqual([mine.scene!.choices[2].label, theirs.scene!.choices[2].label], ['Break Free', 'Dodge']);
  assert.deepEqual(theirs.rules!.party.find((h) => h.playerId === players[0])!.conditions, [{ condition: 'restrained', ends: 'DC 12 Athletics to break free' }]);

  await vote(code, players[0], mine.scene!.index, 'c');
  const seen = (await view(code, players[1])).scene!;
  assert.deepEqual(seen.votes.map((v) => [v.playerId, v.choiceId, v.label]), [[players[0], 'c', 'Break Free']], 'the other player reads Break Free, not their own Dodge');
  await vote(code, players[1], seen.index, 'a');
  await settle();
  const after = await view(code, players[1]);
  assert.match(after.rules!.results.join(' | '), /breaks free|cannot break free/);
});

test('with a friend dying, a healer is told Cast will heal them, and the engine does', async () => {
  const { code, players } = await intoFight(['cleric', 'fighter'], ['goblin-warrior']);
  const game = (await getStore().getGame(code))!;
  const healer = withSpells(game.party!.sheets[players[0]], ['sacred-flame'], ['cure-wounds', 'guiding-bolt']);
  await getStore().updateGame(code, {}, { party: { ...game.party!, sheets: { ...game.party!.sheets, [players[0]]: healer } } });
  assert.match((await view(code, players[0])).scene!.choices[1].label, /^Cast (Guiding Bolt|Sacred Flame)$/, 'nobody is dying: Cast attacks');

  const now = (await getStore().getGame(code))!;
  const fallen = { ...now.combat!.combatants[players[1]], hp: 0, status: 'dying' as const };
  await getStore().updateGame(code, {}, { combat: { ...now.combat!, combatants: { ...now.combat!.combatants, [players[1]]: fallen } } });
  const mine = (await view(code, players[0])).scene!;
  assert.equal(mine.choices[1].label, 'Cast Cure Wounds');
  assert.match(mine.choices[1].detail, /^Heals Hero 2, who is dying: 2d8[+-]\d+ hit points\. Uses a level 1 slot \(\d left\)\.$/);
  await vote(code, players[0], mine.index, 'b');
  await settle();
  assert.match((await view(code, players[0])).rules!.results.join(' | '), /Hero 1 casts Cure Wounds: Hero 2 regains \d+ HP/);
});

test('a hero that is down has no action, and the round does not wait for its player', async () => {
  const { code, players, host } = await intoFight(['fighter', 'fighter'], ['goblin-warrior']);
  await wound(code, players[1], 0);
  let [mine, theirs] = await Promise.all(players.map((p) => view(code, p)));
  assert.deepEqual([mine.scene!.canAct, theirs.scene!.canAct], [true, false]);
  assert.equal(theirs.scene!.choices.length, 3);

  const ignored = await vote(code, players[1], 1, 'a');
  assert.equal(ignored.status, 200, 'a vote from the fallen is accepted');
  await settle();
  assert.equal((await view(code, host)).scene!.index, 1, '…and changes nothing');
  assert.deepEqual((await view(code, host)).scene!.votes, []);

  d20(15);
  await vote(code, host, 1, 'a');
  await settle();
  mine = await view(code, host);
  assert.ok(mine.scene!.index === 2 || !mine.scene!.combat, 'the one hero who could act has: the round resolved');
});

test('outside a fight everyone has a say, the fallen too', async () => {
  const { code, players, host } = await table(['fighter', 'fighter']);
  await call(startApi.POST, gamePath(code, 'start'), { player: host, body: {} });
  await settle();
  await wound(code, players[1], 0);
  assert.equal((await view(code, players[1])).scene!.canAct, true);
  await vote(code, host, 0, 'b');
  await settle();
  assert.equal((await view(code, host)).scene!.index, 0, 'still waiting for the other player');
  await vote(code, players[1], 0, 'b');
  await settle();
  assert.equal((await view(code, host)).scene!.index, 1);
});

test('the chronicle marks a combat round, and names no choice for it', async () => {
  const { code, players, host } = await intoFight(['fighter', 'fighter'], ['ogre'], 4);
  for (const p of players) await wound(code, p, 500);
  for (const p of players) await vote(code, p, 1, 'c');
  await settle();
  const { chronicle } = await view(code, host);
  assert.deepEqual(chronicle.map((e) => [e.index, e.combat, e.choiceLabel]), [[0, false, 'Fight'], [1, true, '']]);
});

test('the host can move a fight on with no votes in: heroes without one dodge', async () => {
  const { code, host } = await intoFight(['fighter', 'fighter'], ['rat']);
  const { status } = await call(advanceApi.POST, gamePath(code, 'advance'), { player: host, body: {} });
  assert.equal(status, 200);
  await settle();
  const state = await view(code, host);
  assert.equal(state.scene!.index, 2);
  assert.ok(state.rules!.results.some((l) => /dodges\.$/.test(l)));
});

test('one picture per fight: later rounds carry the first round’s, and the story after it is painted afresh', async () => {
  const { code, players, host } = await intoFight(['fighter', 'fighter'], ['ogre'], 4);
  for (const p of players) await wound(code, p, 500); // nobody falls while the rounds go by
  let state = await view(code, host);
  const opening = (await getStore().getGame(code))!.scenes[0].imageUrl;
  const first = state.scene!.imageUrl;
  assert.ok(first && first !== opening, 'the round that begins the fight is painted');
  const game = (await getStore().getGame(code))!;
  const ogre = Object.values(game.combat!.combatants).find((c) => c.side === 'foes')!;
  await getStore().updateGame(code, {}, { combat: { ...game.combat!, combatants: { ...game.combat!.combatants, [ogre.id]: { ...ogre, ac: 30 } } } });
  for (const p of players) await vote(code, p, 1, 'c');
  await settle();
  state = await view(code, host);
  assert.deepEqual([state.scene!.index, state.scene!.combat, state.scene!.imageUrl], [2, true, first], 'round 2 reuses it');

  const now = (await getStore().getGame(code))!;
  await getStore().updateGame(code, {}, { combat: { ...now.combat!, combatants: { ...now.combat!.combatants, [ogre.id]: { ...now.combat!.combatants[ogre.id], ac: 1, hp: 1 } } } });
  d20(15, 15);
  for (const p of players) await vote(code, p, 2, 'a');
  await settle();
  state = await view(code, host);
  assert.equal(state.rules!.combat, null, 'the ogre is down');
  assert.ok(state.scene!.imageUrl && state.scene!.imageUrl !== first, 'the scene after the fight has its own picture');
});

test('a picture still painting when the next round begins reaches that round too', async () => {
  const { code, host } = await intoFight(['fighter'], ['ogre'], 4);
  await wound(code, host, 500);
  const store = getStore();
  const game = (await store.getGame(code))!;
  const first = game.scenes[1].imageUrl!;
  // As if round 1's painting had not landed yet when round 2 was written.
  await store.setSceneImage(code, 1, null as unknown as string);
  const ogre = Object.values(game.combat!.combatants).find((c) => c.side === 'foes')!;
  await store.updateGame(code, {}, { combat: { ...game.combat!, combatants: { ...game.combat!.combatants, [ogre.id]: { ...ogre, ac: 30 } } } });
  await vote(code, host, 1, 'c');
  await settle();
  assert.equal((await view(code, host)).scene!.imageUrl, null);
  const { shareSceneImage } = await import('./game.ts');
  await shareSceneImage(code, 1, first);
  const after = (await store.getGame(code))!;
  assert.deepEqual([after.scenes[1].imageUrl, after.scenes[2].imageUrl], [first, first]);
});

test('a rules error never strands the table: the fight breaks off, the log says so, and the story goes on', async () => {
  // A stored goblin whose Multiattack names an attack it does not have: the engine throws on its turn.
  const { code, host } = await intoFight(['fighter'], ['goblin-warrior'], 4);
  const { combat } = (await getStore().getGame(code))!;
  await getStore().updateGame(code, {}, { combat: { ...combat!, combatants: { ...combat!.combatants, 'foe-1': { ...combat!.combatants['foe-1'], multiattack: ['Tail Lash', 'Tail Lash'] } } } });
  const errors: unknown[][] = [];
  const realError = console.error;
  console.error = (...args: unknown[]) => { errors.push(args); };
  try {
    await vote(code, host, 1, 'c');
    await settle();
  } finally {
    console.error = realError;
  }
  const state = await view(code, host);
  assert.deepEqual([state.status, state.scene!.index, state.scene!.combat, state.rules!.combat], ['voting', 2, false, null]);
  assert.deepEqual(state.rules!.results, ['The rules engine stumbled: the fight breaks off.']);
  assert.ok(state.messages.some((m) => m.kind === 'system' && m.text === 'The rules engine stumbled: the fight breaks off.'));
  assert.equal(errors.length, 1, 'the error is logged for whoever maintains the engine');
  assert.match(String(errors[0][0]), /rules engine failed/);
  assert.equal(state.scene!.choices.length, 3, 'the DM wrote the next scene');
});
