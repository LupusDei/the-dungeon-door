import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DAMAGE_TYPES, encounterBudget, monster, monsters, xpForCr } from './monsters.ts';

test('a monster stat block loads with its AC, HP, CR, XP and attacks', () => {
  const goblin = monster('goblin-warrior');
  assert.deepEqual([goblin.name, goblin.ac, goblin.hp, goblin.hitDice, goblin.cr, goblin.xp, goblin.speed], ['Goblin Warrior', 15, 10, '3d6', 0.25, 50, 30]);
  assert.deepEqual(goblin.attacks[0], { name: 'Scimitar', bonus: 4, ranged: false, damage: [{ dice: '1d6+2', type: 'slashing' }, { dice: '1d4', type: 'slashing', advantageOnly: true }] });
  assert.deepEqual(monster('ankheg').attacks[0].damage.map((d) => d.advantageOnly), [undefined, undefined], 'advantage against a grappled target is not extra damage');
  assert.equal(goblin.attacks[1].ranged, true);
});

test('an attack that deals a flat amount keeps its damage, though the table gives it only in the text', () => {
  // "Hit: 1 Slashing damage." has no damage dice in the table.
  assert.deepEqual(monster('cat').attacks[0], { name: 'Scratch', bonus: 4, ranged: false, damage: [{ dice: '1', type: 'slashing' }] });
  assert.deepEqual(monster('giant-fire-beetle').attacks[0].damage, [{ dice: '1', type: 'fire' }]);
  assert.deepEqual(monster('sprite').attacks.find((a) => a.name === 'Enchanting Bow')!.damage, [{ dice: '1', type: 'piercing' }]);
  assert.deepEqual(monster('roper').attacks.find((a) => a.name === 'Tentacle')!.damage, [], 'a hit that only grapples deals none');
  for (const m of monsters().values()) for (const a of m.attacks) for (const d of a.damage) assert.ok(DAMAGE_TYPES.includes(d.type), `${m.id} ${a.name}: ${d.type}`);
});

test('a monster save is its ability modifier, or its listed bonus when proficient', () => {
  const aboleth = monster('aboleth');
  assert.equal(aboleth.saveBonuses.str, 5);
  assert.equal(aboleth.saveBonuses.dex, 3);
  assert.equal(aboleth.saveBonuses.con, 6);
});

test('a monster carries its resistances, vulnerabilities and immunities', () => {
  const skeleton = monster('skeleton');
  assert.deepEqual(skeleton.vulnerabilities, ['bludgeoning']);
  assert.ok(skeleton.immunities.includes('poison'));
  assert.ok(skeleton.conditionImmunities.includes('poisoned'));
});

test('only real damage types are kept; descriptive text in the table is dropped', () => {
  for (const m of monsters().values()) for (const t of [...m.resistances, ...m.vulnerabilities, ...m.immunities]) assert.ok(DAMAGE_TYPES.includes(t), `${m.id}: ${t}`);
});

test('a monster with no actions has no attacks', () => {
  assert.deepEqual(monster('vampire-mist').attacks, []);
});

test('an unknown monster is refused', () => {
  assert.throws(() => monster('tarrasque-jr'), /there is no monster tarrasque-jr/);
});

test('XP by challenge rating comes from the SRD table, fractions included', () => {
  assert.deepEqual([0, 0.125, 0.25, 0.5, 1, 2].map(xpForCr), [10, 25, 50, 100, 200, 450]);
  assert.throws(() => xpForCr(0.3), /no challenge rating 0.3/);
});

test('the encounter budget adds up each character’s XP for the difficulty', () => {
  assert.equal(encounterBudget([1, 1, 1, 1], 'moderate'), 300);
  assert.equal(encounterBudget([1, 2], 'low'), 50 + 100);
  assert.equal(encounterBudget([3], 'high'), 400);
  assert.throws(() => encounterBudget([21], 'low'), /no encounter budget for level 21/);
});

test('a monster carries its skills, passive Perception and alignment (for checks against it and its reactions)', () => {
  const goblin = monster('goblin-warrior');
  assert.deepEqual(goblin.skills, { stealth: 6 });
  assert.equal(goblin.passivePerception, 9);
  assert.equal(goblin.alignment, 'chaotic neutral');
  assert.deepEqual(monster('animated-armor').skills, {});
});

test('special senses in feet: darkvision, blindsight, truesight (0 without)', () => {
  assert.deepEqual(monster('red-dragon-wyrmling').senses, { darkvision: 60, blindsight: 10, truesight: 0 });
  assert.deepEqual(monster('goblin-warrior').senses, { darkvision: 60, blindsight: 0, truesight: 0 });
  assert.deepEqual(monster('bandit').senses, { darkvision: 0, blindsight: 0, truesight: 0 });
  assert.equal(Object.values(Object.fromEntries([...monsters()].map(([id, m]) => [id, m.senses.truesight]))).some((n) => n > 0), true);
});

test('Multiattack: the attacks it makes on its turn, by name; options mean that many of its usual attack; none, or one, is no Multiattack', () => {
  assert.deepEqual(monster('owlbear').multiattack, ['Rend', 'Rend']);
  assert.deepEqual(monster('ghoul').multiattack, ['Bite', 'Bite']);
  assert.deepEqual(monster('chuul').multiattack, ['Pincer', 'Pincer'], 'what is not an attack roll is left out');
  assert.deepEqual(monster('assassin').multiattack, ['Shortsword', 'Shortsword', 'Shortsword']);
  assert.deepEqual(monster('bugbear-stalker').multiattack, ['Javelin', 'Javelin'], 'the first melee attack');
  assert.deepEqual(monster('hydra').multiattack, Array(5).fill('Bite'), 'as many as its five heads');
  assert.deepEqual(monster('young-brass-dragon').multiattack, ['Rend', 'Rend', 'Rend'], 'the text says three, the table lists one');
  assert.deepEqual(monster('behir').multiattack, [], 'one Bite and a Constrict (no attack roll): no Multiattack');
  assert.deepEqual(monster('goblin-warrior').multiattack, []);
  assert.deepEqual(monster('barbed-devil').multiattack, ['Claws', 'Claws'], 'one Claws and one Tail, or two Hurl Flame: two of its usual attack');
  assert.deepEqual(monster('dryad').multiattack, [], 'one attack and a spell is no Multiattack');
});

test('a monster that can Disengage as a Bonus Action', () => {
  assert.equal(monster('goblin-warrior').disengages, true);
  assert.equal(monster('bugbear-warrior').disengages, false);
});
