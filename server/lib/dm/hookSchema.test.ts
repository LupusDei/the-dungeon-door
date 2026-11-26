import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { parseHook } from '../play/hooks.ts';
import { FlatHook, hookFromFlat } from './hookSchema.ts';
import { DM_SCHEMAS } from './llm.ts';

/** A hook as the model must write it: every field present, the unused ones empty. */
const EMPTY = {
  ability: 'none', skill: '', tool: '', dc: 0, against: '', mode: 'none', advantage: false, disadvantage: false, damage: '', damageType: '',
  monsters: [], rest: 'none', exit: '', items: [], item: '', trap: '', hazard: 'none', condition: 'none', feet: 0, minutes: 0, hours: 0, days: 0,
};
const flat = (fields: Record<string, unknown>) => FlatHook.parse({ ...EMPTY, ...fields });
const hook = (fields: Record<string, unknown>) => parseHook(hookFromFlat(flat(fields)));

/** JSON-schema nodes a provider counts as union-typed: anyOf/oneOf, or a list of types (what .nullable() makes). */
function unions(node: unknown): number {
  if (Array.isArray(node)) return node.reduce((n, x) => n + unions(x), 0);
  if (!node || typeof node !== 'object') return 0;
  const o = node as Record<string, unknown>;
  const here = ('anyOf' in o || 'oneOf' in o || Array.isArray(o.type)) ? 1 : 0;
  return here + Object.values(o).reduce((n: number, x) => n + unions(x), 0);
}

test('the DM’s output schemas stay within what model providers accept: few union-typed (nullable) fields', () => {
  // Anthropic refuses a structured-output schema with more than 16 (a 400 before any text is written),
  // which is how every real game once failed to start. No test with the fake DM can see that.
  for (const [name, schema] of Object.entries(DM_SCHEMAS)) {
    const count = unions(z.toJSONSchema(schema));
    assert.ok(count <= 8, `${name} has ${count} union-typed fields; keep hooks flat with empty values instead of nullable ones`);
  }
});

test('a hook as the model writes it (unused fields empty) is the hook the engine reads', () => {
  assert.deepEqual(hook({ kind: 'check', ability: 'str', skill: 'athletics', dc: 12 }), { kind: 'check', ability: 'str', skill: 'athletics', dc: 12, advantage: false, disadvantage: false });
  assert.deepEqual(hook({ kind: 'check', ability: 'dex', skill: 'sleight-of-hand', tool: 'thieves-tools', dc: 15, mode: 'best', advantage: true }),
    { kind: 'check', ability: 'dex', skill: 'sleight-of-hand', tool: 'thieves-tools', dc: 15, mode: 'best', advantage: true, disadvantage: false });
  assert.deepEqual(hook({ kind: 'check', ability: 'dex', skill: 'stealth', against: 'goblin-warrior', mode: 'group' }),
    { kind: 'check', ability: 'dex', skill: 'stealth', against: 'goblin-warrior', mode: 'group', advantage: false, disadvantage: false }, 'dc 0 means "use the monster’s score"');
  assert.deepEqual(hook({ kind: 'save', ability: 'dex', dc: 13, damage: '2d6', damageType: 'fire' }), { kind: 'save', ability: 'dex', dc: 13, damage: '2d6', damageType: 'fire', advantage: false, disadvantage: false });
  assert.deepEqual(hook({ kind: 'save', ability: 'con', dc: 12, condition: 'poisoned', minutes: 60 }), { kind: 'save', ability: 'con', dc: 12, condition: 'poisoned', minutes: 60, advantage: false, disadvantage: false });
  assert.deepEqual(hook({ kind: 'fight', monsters: ['goblin-warrior', 'goblin-warrior'] }), { kind: 'fight', monsters: ['goblin-warrior', 'goblin-warrior'] });
  assert.deepEqual(hook({ kind: 'rest', rest: 'short' }), { kind: 'rest', rest: 'short' });
  assert.deepEqual(hook({ kind: 'move', exit: 'r2' }), { kind: 'move', exit: 'r2' });
  assert.deepEqual(hook({ kind: 'buy', items: ['potion-of-healing'] }), { kind: 'buy', items: ['potion-of-healing'] });
  assert.deepEqual(hook({ kind: 'sell', items: ['dagger'] }), { kind: 'sell', items: ['dagger'] });
  assert.deepEqual(hook({ kind: 'use', item: 'potion-of-healing' }), { kind: 'use', item: 'potion-of-healing' });
  assert.deepEqual(hook({ kind: 'trap', trap: 'poisoned-needle' }), { kind: 'trap', trap: 'poisoned-needle' });
  assert.deepEqual(hook({ kind: 'hazard', hazard: 'falling', feet: 30 }), { kind: 'hazard', hazard: 'falling', feet: 30 });
  assert.deepEqual(hook({ kind: 'hazard', hazard: 'burning' }), { kind: 'hazard', hazard: 'burning' });
  assert.deepEqual(hook({ kind: 'parley' }), { kind: 'parley' }, 'the foes waiting in the room');
  assert.deepEqual(hook({ kind: 'parley', monsters: ['goblin-warrior'] }), { kind: 'parley', monsters: ['goblin-warrior'] });
  assert.deepEqual(hook({ kind: 'revive' }), { kind: 'revive' });
});

test('a hook left empty, or filled for the wrong kind, is no hook: the choice is pure story', () => {
  assert.equal(hook({ kind: 'check' }), null);
  assert.equal(hook({ kind: 'fight' }), null);
  assert.equal(hook({ kind: 'fight', monsters: ['no-such-monster'] }), null);
  assert.equal(hook({ kind: 'hazard', hazard: 'falling' }), null, 'falling needs its feet');
  assert.equal(parseHook(hookFromFlat(null)), null);
  assert.equal(parseHook(hookFromFlat('fight')), null);
});
