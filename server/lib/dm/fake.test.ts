import assert from 'node:assert/strict';
import { test } from 'node:test';
import { archetype } from '../catalog.ts';
import { fakeDungeonMaster } from './fake.ts';
import type { DMContext, RulesContext } from './types.ts';

process.env.DD_FAKE_DELAY_MS = '0';
const rules: RulesContext = { party: [], combat: null, dungeon: null, monsters: ['ogre', 'rat'], time: 'Day 1, 08:00', light: 'bright; no light carried' };
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
  const { choices: met } = await fakeDungeonMaster.openingScene(ctx({ ...rules, dungeon: { ...dungeon, waiting: { foes: 'Boar ×3', attitude: 'friendly' } } }));
  assert.deepEqual(met[2].rules, { kind: 'parley' }, 'foes waiting: talk to them');
  const { choices: legacy } = await fakeDungeonMaster.openingScene(ctx(null));
  assert.ok(legacy.every((c) => c.rules === undefined));
});
