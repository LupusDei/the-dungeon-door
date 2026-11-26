import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heroSheet } from '../characters.ts';
import { type Combatant, heroCombatant, monsterCombatant } from '../rules/combatant.ts';
import { monster } from '../rules/monsters.ts';
import { type CombatState, startCombat } from '../rules/scene.ts';
import { MORALE_DC, morale, shaken } from './morale.ts';

const bryn = heroCombatant('p1', heroSheet({ id: 'f', name: 'Bryn', race: 'human', characterClass: 'fighter' }));
const foe = (id: string, kind = 'goblin-warrior', o: Partial<Combatant> = {}): Combatant => ({ ...monsterCombatant(id, monster(kind)), name: id, disengages: undefined, ...o });
const fight = (...foes: Combatant[]): CombatState => startCombat(1, [bryn, ...foes]);
const hurt = (s: CombatState, changes: Record<string, Partial<Combatant>>, rng = s.rng): CombatState =>
  ({ ...s, rng, combatants: Object.fromEntries(Object.entries(s.combatants).map(([id, c]) => [id, { ...c, ...changes[id] }])) });
const slain = { hp: 0, status: 'dead' as const };

test('what shakes the foes: their first death, half their total HP gone, their leader (most XP) down; each only as it happens', () => {
  const s = fight(foe('g1'), foe('g2'), foe('boss', 'bugbear-warrior'));
  assert.deepEqual(shaken(s, s), []);
  assert.deepEqual(shaken(s, hurt(s, { g1: slain })), ['their first death']);
  const firstGone = hurt(s, { g1: slain });
  assert.deepEqual(shaken(firstGone, hurt(s, { g1: slain, g2: slain })), [], 'the second death is not the first');
  const total = Object.values(s.combatants).filter((c) => c.side === 'foes').reduce((n, c) => n + c.maxHp, 0);
  const boss = s.combatants.boss.maxHp;
  const half = hurt(s, { boss: { hp: boss - Math.ceil(total / 2) } });
  assert.deepEqual(shaken(s, half), ['half their strength gone']);
  assert.deepEqual(shaken(s, hurt(s, { boss: { hp: boss - Math.ceil(total / 2) + 1 } })), [], 'just over half is not half');
  assert.deepEqual(shaken(half, hurt(s, { boss: { hp: 1 } })), [], 'only when it first falls to half');
  assert.deepEqual(shaken(s, hurt(s, { boss: slain })), ['their first death', 'half their strength gone', 'boss down']);
  assert.deepEqual(shaken(firstGone, hurt(s, { g1: slain, boss: { ...slain } })), ['half their strength gone', 'boss down']);
  const twins = fight(foe('g1'), foe('g2'));
  assert.deepEqual(shaken(twins, hurt(twins, { g1: slain })), ['their first death', 'half their strength gone', 'g1 down'], 'on a tie the first is the leader');
});

test('half their strength: exactly half counts, and only when they first fall to it', () => {
  const s = fight(foe('g1', 'goblin-warrior', { hp: 10, maxHp: 10 }), foe('g2', 'goblin-warrior', { hp: 10, maxHp: 10 }), foe('boss', 'bugbear-warrior', { hp: 20, maxHp: 20 }));
  const at = (hp: number) => hurt(s, { boss: { hp } });
  assert.deepEqual([shaken(s, at(0)), shaken(s, at(1)), shaken(at(0), hurt(s, { boss: { hp: 0 }, g1: { hp: 9 } }))], [['half their strength gone'], [], []]);
});

/** The outcome for each seed, with the total the line shows. */
function trials(after: (rng: number) => CombatState, before: CombatState) {
  return Array.from({ length: 120 }, (_, i) => {
    const m = morale(before, after(i + 1));
    const total = Number(/= (-?\d+) vs DC 10/.exec(m.lines[0])![1]);
    return { m, total };
  });
}

test('a shaken foe band rolls d20 + its best WIS save vs DC 10: hold at 10+, flee below, surrender at 5 or less', () => {
  const s = fight(foe('g1'), foe('g2', 'bugbear-warrior'));
  const results = trials((rng) => hurt(s, { g1: slain }, rng), s);
  for (const { m, total } of results) {
    const expected = total >= MORALE_DC ? null : total <= MORALE_DC - 5 ? 'surrender' : 'flee';
    assert.equal(m.broke, expected, m.lines[0]);
    assert.match(m.lines[0], /^Morale \(their first death\): \d+ [+-] \d+ = -?\d+ vs DC 10: the foes (stand firm|break and flee|throw down their arms and surrender)\.$/);
    assert.notEqual(m.combat.rng, s.rng, 'the dice move on');
  }
  const totals = new Set(results.map((r) => r.total));
  assert.ok([5, 9, 10].every((t) => totals.has(t)), 'the edges are tried');
  const bonus = s.combatants.g2.saveBonuses.wis;
  assert.ok(results.every(({ m, total }) => m.lines[0].includes(`${total - bonus} ${bonus < 0 ? '-' : '+'} ${Math.abs(bonus)} =`)), 'the bugbear\'s save, the best left standing');
});

test('when they flee, each standing hero with a melee weapon gets an Opportunity Attack on the most wounded', () => {
  const doom = [{ name: 'Doom', bonus: 30, ranged: false, damage: [{ dice: '100', type: 'force' }] }];
  const s = fight(foe('g1'), foe('g2'), foe('g3'));
  const results = trials((rng) => hurt(s, { g1: slain, g3: { hp: 1 }, p1: { attacks: doom } }, rng), s);
  const fled = results.find((r) => r.m.broke === 'flee')!.m;
  const reactions = fled.combat.log.filter((e) => e.kind === 'attack' && e.reaction);
  assert.deepEqual(reactions.map((e) => [e.actor, e.kind === 'attack' && e.result.target]), [['p1', 'g3']]);
  const twinBlades = [...doom, { ...doom[0], name: 'Doom Again' }];
  const tied = trials((rng) => hurt(s, { g1: slain, p1: { attacks: twinBlades } }, rng), s).find((r) => r.m.broke === 'flee')!.m;
  const struck = tied.combat.log.filter((e) => e.kind === 'attack' && e.reaction).map((e) => e.kind === 'attack' && [e.result.attack, e.result.target]);
  assert.deepEqual(struck, [['Doom', 'g2']], 'the first of equal weapons, at the first of equally wounded foes');
  const pair = fight(foe('g1'), foe('g2'));
  const lone = trials((rng) => hurt(pair, { g1: slain, p1: { attacks: doom } }, rng), pair).find((r) => r.m.broke === 'flee')!.m;
  assert.deepEqual([lone.combat.combatants.g2.status, lone.combat.outcome], ['dead', 'victory'], 'a lone fleeing foe can be cut down');
  const bow = trials((rng) => hurt(s, { g1: slain, p1: { attacks: doom.map((a) => ({ ...a, ranged: true })) } }, rng), s).find((r) => r.m.broke === 'flee')!.m;
  assert.equal(bow.combat.log.length, s.log.length, 'no melee weapon, no Opportunity Attack');
  const down = trials((rng) => hurt(s, { g1: slain, p1: { attacks: doom, status: 'stable', hp: 0 } }, rng), s).find((r) => r.m.broke === 'flee')!.m;
  assert.equal(down.combat.log.length, s.log.length, 'a fallen hero makes none');
});

test('no check when nothing shook them, when the fight is over, or when any foe left is fearless (undead, constructs, oozes)', () => {
  const s = fight(foe('g1'), foe('g2'));
  assert.deepEqual(morale(s, s), { combat: s, lines: [], broke: null });
  const over = { ...hurt(s, { g1: slain, g2: slain }), outcome: 'victory' as const };
  assert.deepEqual(morale(s, over).lines, []);
  const dead = fight(foe('g1'), foe('z1', 'zombie'));
  const after = hurt(dead, { g1: slain });
  assert.deepEqual(morale(dead, after), { combat: after, lines: [], broke: null });
  const zombiesGone = fight(foe('z1', 'zombie'), foe('g1'), foe('g2'));
  assert.equal(morale(zombiesGone, hurt(zombiesGone, { z1: slain })).lines.length, 1, 'only those still standing count');
});

test('two who Disengage are told together', () => {
  const s = fight(foe('g1', 'goblin-warrior', { hp: 10, maxHp: 10, disengages: true }), foe('g2', 'goblin-warrior', { hp: 10, maxHp: 10, disengages: true }), foe('boss', 'bugbear-warrior', { hp: 20, maxHp: 20 }));
  const fled = Array.from({ length: 80 }, (_, i) => morale(s, hurt(s, { boss: slain }, i + 1))).find((m) => m.broke === 'flee')!;
  assert.ok(fled.lines.includes('g1, g2 Disengage as a Bonus Action: no Opportunity Attacks.'), fled.lines.join(' | '));
});
