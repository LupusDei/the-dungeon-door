import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heroSheet } from '../characters.ts';
import type { Combatant } from '../rules/combatant.ts';
import type { CombatEvent, CombatState } from '../rules/scene.ts';
import type { CharacterSheet } from '../rules/sheet.ts';
import { hitsOn, keepConcentration } from './concentration.ts';
import { startFight } from './fight.ts';

const wizard = heroSheet({ id: 'w', name: 'Cleo', race: 'elf', characterClass: 'wizard' });
const focused: CharacterSheet = { ...wizard, spellcasting: { ...wizard.spellcasting!, concentratingOn: 'sleep' } };
const fighter = heroSheet({ id: 'f', name: 'Bryn', race: 'human', characterClass: 'fighter' });
const roll = { natural: 10, rolls: [10], total: 15 };
const hit = (target: string, damage: number): CombatEvent =>
  ({ kind: 'attack', round: 1, actor: 'foe-1', result: { attacker: 'foe-1', target, attack: 'Scimitar', roll, ac: 12, hit: damage > 0, critical: false, damage } });
const spell = (target: string, damage: number): CombatEvent =>
  ({ kind: 'spell', round: 1, actor: 'foe-1', spellId: 'fire-bolt', outcomes: [{ target, attack: null, save: null, damage, healed: 0 }] });

test('the hits a combatant took: each attack or spell that did it damage, in order', () => {
  assert.deepEqual(hitsOn([hit('p2', 7), hit('p1', 3), hit('p2', 0), spell('p2', 12), { kind: 'dodge', round: 1, actor: 'p2' }], 'p2'), [7, 12]);
});

const fight = () => startFight({ version: 1, rng: 42, sheets: { p1: fighter, p2: focused } }, ['goblin-warrior']).combat;
const after = (combat: CombatState, events: CombatEvent[], p2: Partial<Combatant> = {}): CombatState =>
  ({ ...combat, log: [...combat.log, ...events], combatants: { ...combat.combatants, p2: { ...combat.combatants.p2, ...p2 } } });

test('a concentrating hero who is hit makes a CON save for each hit, DC half the damage (at least 10); failing ends it', () => {
  const before = fight();
  const sheets = { p1: fighter, p2: focused };
  const one = keepConcentration(before, after(before, [hit('p2', 4)]), sheets);
  assert.equal(one.lines.length, 1);
  assert.match(one.lines[0], /^Cleo (keeps concentrating on Sleep|loses concentration on Sleep) \(CON save \d+ vs DC 10\)\.$/);
  assert.equal(one.sheets.p2.spellcasting!.concentratingOn === null, one.lines[0].includes('loses'));
  assert.notEqual(one.combat.rng, before.rng, 'the dice move on');
  const sure = keepConcentration(before, after(before, [hit('p2', 4)], { saveBonuses: { ...before.combatants.p2.saveBonuses, con: 30 } }), sheets);
  assert.equal(sure.sheets.p2.spellcasting!.concentratingOn, 'sleep');
  const hopeless = keepConcentration(before, after(before, [hit('p2', 44), hit('p2', 44)], { saveBonuses: { ...before.combatants.p2.saveBonuses, con: -30 } }), sheets);
  assert.deepEqual(hopeless.lines.map((l) => l.replace(/-?\d+ vs/, 'N vs')), ['Cleo loses concentration on Sleep (CON save N vs DC 22).'], 'once lost, no more saves');
  assert.equal(hopeless.sheets.p2.spellcasting!.concentratingOn, null);
});

test('a concentrating hero who drops or is incapacitated loses it without a save; no hits, no concentration: nothing', () => {
  const before = fight();
  const sheets = { p1: fighter, p2: focused };
  const down = keepConcentration(before, after(before, [hit('p2', 40)], { status: 'dying', hp: 0 }), sheets);
  assert.deepEqual(down.lines, ['Cleo can no longer concentrate on Sleep.']);
  assert.equal(down.sheets.p2.spellcasting!.concentratingOn, null);
  const stunned = keepConcentration(before, after(before, [], { conditions: ['stunned'] }), sheets);
  assert.deepEqual(stunned.lines, ['Cleo can no longer concentrate on Sleep.']);
  const calm = keepConcentration(before, after(before, [hit('p1', 5)]), sheets);
  assert.deepEqual(calm, { combat: after(before, [hit('p1', 5)]), sheets, lines: [] });
  const none = keepConcentration(before, after(before, [hit('p2', 5)]), { p1: fighter, p2: wizard, p3: { ...focused, name: 'Away' } });
  assert.deepEqual(none.lines, []);
});
