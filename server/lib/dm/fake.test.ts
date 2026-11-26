import assert from 'node:assert/strict';
import { test } from 'node:test';
import { archetype } from '../catalog.ts';
import { classifyFreeform, fakeDungeonMaster } from './fake.ts';
import type { DMContext, Resolution, RulesContext } from './types.ts';

process.env.DD_FAKE_DELAY_MS = '0';
const rules: RulesContext = { party: [], combat: null, trek: null, dungeon: null, monsters: ['ogre', 'rat'], time: 'Day 1, 08:00', light: 'bright; no light carried' };
const ctx = (r: RulesContext | null): DMContext => ({
  archetype: archetype('chronicler'), adventureTitle: null, party: [], history: [], sceneIndex: 0, sceneCount: 4, recentChat: [], rules: r,
});

test('the fake DM proposes hooks in a rules-engine game: an Athletics check, a Perception check, a Persuasion check', async () => {
  const { choices } = await fakeDungeonMaster.openingScene(ctx(rules));
  assert.deepEqual(choices.map((c) => c.rules), [
    { kind: 'check', ability: 'str', skill: 'athletics', dc: 10 },
    { kind: 'check', ability: 'wis', skill: 'perception', dc: 10 },
    { kind: 'check', ability: 'cha', skill: 'persuasion', dc: 15 },
  ]);
});

test('in a dungeon its first choice takes the first exit; before the engine its choices carry no hooks', async () => {
  const dungeon = { kind: 'Lair', level: 1, area: 'Hall', purpose: null, exits: [{ id: 'r1', connection: 'open-passage', leadsTo: null }], waiting: null };
  const { choices } = await fakeDungeonMaster.openingScene(ctx({ ...rules, dungeon }));
  assert.deepEqual(choices[0].rules, { kind: 'move', exit: 'r1' });
  const { choices: none } = await fakeDungeonMaster.openingScene(ctx({ ...rules, dungeon: { ...dungeon, exits: [] } }));
  assert.deepEqual(none[0].rules, { kind: 'check', ability: 'str', skill: 'athletics', dc: 10 });
  assert.deepEqual(choices[2].rules, { kind: 'check', ability: 'cha', skill: 'persuasion', dc: 15 });
  const { choices: met } = await fakeDungeonMaster.openingScene(ctx({ ...rules, dungeon: { ...dungeon, waiting: { foes: 'Boar ×3', attitude: 'friendly', band: 'low', monsters: [{ name: 'Boar', count: 3, toughness: 'weak' }] } } }));
  assert.deepEqual(met[2].rules, { kind: 'parley' }, 'foes waiting: talk to them');
  const { choices: legacy } = await fakeDungeonMaster.openingScene(ctx(null));
  assert.ok(legacy.every((c) => c.rules === undefined));
});

test('the fake DM classifies a written action without inventing a number', () => {
  const request = { characterName: 'Bryn', text: '', inCombat: true, actions: ['attack', 'cast', 'dodge'], choices: [{ id: 'attack', label: 'Attack' }] };
  assert.equal(classifyFreeform({ ...request, text: 'attack' }).kind, 'known');
  assert.equal(classifyFreeform({ ...request, text: 'attack' }).action, 'attack');
  const kick = classifyFreeform({ ...request, text: 'I kick the brazier onto the goblins' });
  assert.deepEqual([kick.kind, kick.tier, kick.severity, kick.skill], ['check', 'medium', 'moderate', 'athletics']);
  assert.equal(classifyFreeform({ ...request, text: 'I fly to the moon' }).kind, 'impossible');
  assert.equal(JSON.stringify(kick).match(/\d/g), null, 'no digits');
});

test('on the road it tells the road and never offers a way on; it buys from a vendor and talks to foes met', async () => {
  const trek = { stretch: 1, of: 2, terrain: 'a forest road', event: 'quiet' as const, wares: [], waiting: null };
  const quiet = await fakeDungeonMaster.openingScene(ctx({ ...rules, trek }));
  assert.match(quiet.narration, /^The party set out from the tavern along a forest road: a quiet stretch\./);
  assert.ok(quiet.choices.every((c) => (c.rules as { kind: string }).kind !== 'move'));
  const vendor = await fakeDungeonMaster.nextScene({ ...ctx({ ...rules, trek: { ...trek, stretch: 2, event: 'vendor', wares: [{ id: 'rope', name: 'Rope', cost: 1 }] } }), sceneIndex: 1 }, { scene: { choices: [] }, leaders: ['a'], votes: [], abstained: [], tally: { a: 0, b: 0, c: 0 }, rules: null } as unknown as Resolution);
  assert.match(vendor.narration, /^The road goes on along a forest road: a wandering vendor\./);
  assert.deepEqual(vendor.choices[2].rules, { kind: 'buy', items: ['rope'] });
  const met = await fakeDungeonMaster.openingScene(ctx({ ...rules, trek: { ...trek, event: 'bandits', waiting: { foes: 'Bandit', attitude: 'friendly', band: 'low', monsters: [] } } }));
  assert.deepEqual(met.choices[2].rules, { kind: 'parley' });
});

test('the fake DM tells how the vote went: the plan chosen, a tied debate, who lagged behind', async () => {
  const told = async (leaders: string[], abstained: string[]) => (await fakeDungeonMaster.nextScene(ctx(rules),
    { scene: { choices: [{ id: 'a', label: 'Run' }] }, leaders, votes: [], abstained, tally: { a: 0, b: 0, c: 0 }, rules: null } as unknown as Resolution)).outcome;
  assert.equal(await told(['a'], []), 'The party chose to run.');
  assert.equal(await told(['a', 'b'], ['Cleo']), 'The party chose to run after a heated, tied debate. Cleo lagged behind.');
});
