import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heroSheet } from '../characters.ts';
import type { Combatant } from '../rules/combatant.ts';
import type { CombatState } from '../rules/scene.ts';
import type { CharacterSheet } from '../rules/sheet.ts';
import { startFight } from './fight.ts';
import { canAct, yourChoices } from './your-turn.ts';

const fighter = heroSheet({ id: 'f', name: 'Bryn', race: 'human', characterClass: 'fighter' });
const wizard = heroSheet({ id: 'w', name: 'Cleo', race: 'elf', characterClass: 'wizard' });
const patch = (combat: CombatState, changes: Record<string, Partial<Combatant>>): CombatState =>
  ({ ...combat, combatants: Object.fromEntries(Object.entries(combat.combatants).map(([id, c]) => [id, { ...c, ...changes[id] }])) });
const fight = (sheets: Record<string, CharacterSheet>, foes = ['goblin-warrior']) => startFight({ version: 1, rng: 9, sheets }, foes).combat;

test('who can act: everyone outside a fight; in one, only a hero who is up and in it', () => {
  const combat = fight({ p1: fighter });
  assert.equal(canAct(null, 'p1'), true);
  assert.equal(canAct(combat, 'p1'), true);
  assert.equal(canAct(combat, 'nobody'), false);
  assert.equal(canAct(patch(combat, { p1: { status: 'dying' } }), 'p1'), false);
});

test('a bonus as a sheet writes it: +0 and +5, -1', () => {
  const combat = fight({ p1: fighter });
  const weapon = (bonus: number) => [{ name: 'Club', bonus, ranged: false, damage: [{ dice: '1d4', type: 'bludgeoning' }] }];
  assert.equal(yourChoices(patch(combat, { p1: { attacks: weapon(0) } }), fighter, 'p1')[0].detail, '+0 to hit, 1d4 bludgeoning, at Goblin Warrior. You move to engage Goblin Warrior.');
  assert.equal(yourChoices(patch(combat, { p1: { attacks: weapon(-1) } }), fighter, 'p1')[0].detail, '-1 to hit, 1d4 bludgeoning, at Goblin Warrior. You move to engage Goblin Warrior.');
});

const mage = (prepared: string[], slots: number[], expended: number[]): CharacterSheet =>
  ({ ...wizard, level: 5, spellcasting: { ...wizard.spellcasting!, cantrips: [], prepared, slots, expended } });

test('a spell that spends a slot says which and how many are left: the lowest it can use', () => {
  const combat = fight({ p1: wizard });
  const fresh = mage(['ray-of-sickness'], [4, 2, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.match(yourChoices(combat, fresh, 'p1')[1].detail, / Uses a level 1 slot \(4 left\)\.$/);
  const spent = mage(['ray-of-sickness'], [4, 2, 0, 0, 0, 0, 0, 0, 0], [4, 1, 0, 0, 0, 0, 0, 0, 0]);
  assert.match(yourChoices(combat, spent, 'p1')[1].detail, / Uses a level 2 slot \(1 left\)\.$/);
  const second = mage(['scorching-ray'], [4, 2, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.match(yourChoices(combat, second, 'p1')[1].detail, / Uses a level 2 slot \(2 left\)\.$/, 'not below its own level');
});

test('an area spell names everyone it catches: A, B and C', () => {
  const combat = fight({ p1: wizard }, ['goblin-warrior', 'goblin-warrior', 'goblin-warrior']);
  const blast = mage(['fireball'], [4, 3, 2, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.match(yourChoices(combat, blast, 'p1')[1].detail, /, at Goblin Warrior 1, Goblin Warrior 2 and Goblin Warrior 3\./, 'a 20-foot sphere catches the goblins standing within it');
});

test('Magic Missile says how many darts, that they never miss, and whom they will strike', () => {
  const combat = patch(fight({ p1: wizard }, ['goblin-warrior', 'goblin-warrior']), { 'foe-1': { hp: 3 } }); // one dart drops it, two go on
  const mm = mage(['magic-missile'], [4, 2, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(yourChoices(combat, mm, 'p1')[1].label, 'Cast Magic Missile');
  assert.equal(yourChoices(combat, mm, 'p1')[1].detail, '3 darts of 1d4+1 force that never miss, at Goblin Warrior 1 and Goblin Warrior 2. Uses a level 1 slot (4 left).');
  assert.match(yourChoices(fight({ p1: wizard }, ['goblin-warrior', 'goblin-warrior']), mm, 'p1')[1].detail, /never miss, at Goblin Warrior 1\. /, 'all three at a goblin they can drop');
});

test('a hero at half its HP or less, with a potion (even one), drinks it first; above half, not', () => {
  const combat = fight({ p1: fighter });
  const one = { ...fighter, resourcesUsed: { 'second-wind': 2 }, equipment: [...fighter.equipment, { id: 'potion-of-healing', name: 'Potion of Healing', count: 1 }] };
  const max = combat.combatants.p1.maxHp;
  const at = (hp: number) => yourChoices(patch(combat, { p1: { hp, maxHp: 2 * Math.ceil(max / 2) } }), one, 'p1')[0].detail;
  const half = Math.ceil(max / 2);
  assert.match(at(half), / First drinks a Potion of Healing\.$/);
  assert.doesNotMatch(at(half + 1), /First drinks/);
  assert.doesNotMatch(yourChoices(patch(combat, { p1: { hp: 1 } }), { ...fighter, resourcesUsed: { 'second-wind': 2 } }, 'p1')[0].detail, /First/, 'no potion');
});

test('a fighter at half its HP or less with Second Wind left uses it first, before any potion', () => {
  const combat = fight({ p1: fighter });
  const stocked = { ...fighter, equipment: [...fighter.equipment, { id: 'potion-of-healing', name: 'Potion of Healing', count: 1 }] };
  const choices = yourChoices(patch(combat, { p1: { hp: 1 } }), stocked, 'p1');
  assert.deepEqual(choices.map((c) => c.detail.endsWith(' First uses Second Wind.')), [true, true, true]);
  assert.doesNotMatch(choices[0].detail, /drinks/);
});

test('the choices name the foe the hero will really aim at: past one immune to its damage', () => {
  const combat = fight({ p1: fighter }, ['goblin-warrior', 'goblin-warrior']);
  const type = combat.combatants.p1.attacks.reduce((best, a) => (a.bonus > best.bonus ? a : best)).damage[0].type;
  assert.match(yourChoices(patch(combat, { 'foe-1': { hp: 1, immunities: [type] } }), fighter, 'p1')[0].detail, /, at Goblin Warrior 2\./);
  const bolt = mage(['fire-bolt'], [0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const casting = fight({ p1: wizard }, ['goblin-warrior', 'goblin-warrior']);
  assert.match(yourChoices(patch(casting, { 'foe-1': { hp: 1, immunities: ['fire'] } }), { ...bolt, spellcasting: { ...bolt.spellcasting!, cantrips: ['fire-bolt'], prepared: [] } }, 'p1')[1].detail, /, at Goblin Warrior 2\.$/);
  const blast = mage(['fireball'], [4, 3, 2, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const three = fight({ p1: wizard }, ['goblin-warrior', 'goblin-warrior', 'goblin-warrior']);
  assert.match(yourChoices(patch(three, { 'foe-1': { hp: 1, immunities: ['fire'] }, 'foe-2': { hp: 2 }, 'foe-3': { hp: 3 } }), blast, 'p1')[1].detail, /, at Goblin Warrior 2,/, 'centred on the most wounded foe it can hurt');
});
