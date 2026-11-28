import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heroSheet } from '../characters.ts';
import type { CombatEvent } from '../rules/scene.ts';
import { fightRound, startFight } from './fight.ts';
import { chanceOf, diceOfRound, dieOfCheck, likelihood, modeRolled, rarityOf } from './odds.ts';

const near = (actual: number, expected: number, message?: string) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message ?? ''} ${actual} is not ${expected}`);

test('the chance of a d20 is the faces that reach the target, out of twenty', () => {
  near(chanceOf(5, 10), 0.8, 'DC 10 with +5: a 5 or better');
  near(chanceOf(5, 15), 0.55, 'DC 15 with +5: a 10 or better');
  near(chanceOf(1, 20), 0.1, 'DC 20 with +1: a 19 or a 20');
  near(chanceOf(9, 10), 1, 'DC 10 with +9: any face');
  near(chanceOf(3, 25), 0, 'DC 25 with +3: no face');
  near(chanceOf(-1, 10), 0.5);
});

test('Advantage and Disadvantage change the chance: the better or the worse of two dice', () => {
  near(chanceOf(7, 15, 'advantage'), 1 - 0.35 ** 2);
  near(chanceOf(7, 15, 'disadvantage'), 0.65 ** 2);
  near(chanceOf(7, 15, 'normal'), 0.65);
  near(chanceOf(9, 10, 'disadvantage'), 1, 'a sure thing stays sure');
});

test('an attack can always miss on a 1 and hit on a 20; a check or a save cannot', () => {
  near(chanceOf(9, 10, 'normal', true), 0.95, 'only a natural 1 misses');
  near(chanceOf(4, 25, 'normal', true), 0.05, 'only a natural 20 hits');
  near(chanceOf(4, 25, 'advantage', true), 1 - 0.95 ** 2);
  near(chanceOf(5, 15, 'normal', true), 0.55, 'between the two it is the same sum');
});

test('how likely what happened was: the chance of success when it came, the rest when it did not', () => {
  near(likelihood({ success: true, chance: 0.8 }), 0.8);
  near(likelihood({ success: false, chance: 0.8 }), 0.2);
});

test('the bands: 1 in 10 or worse is rare, 1 in 4 or worse unlikely, 9 in 10 or better sure; the rest is plain', () => {
  assert.deepEqual([0, 0.05, 0.1].map(rarityOf), ['rare', 'rare', 'rare']);
  assert.deepEqual([0.11, 0.15, 0.25].map(rarityOf), ['unlikely', 'unlikely', 'unlikely']);
  assert.deepEqual([0.26, 0.5, 0.89].map(rarityOf), ['plain', 'plain', 'plain']);
  assert.deepEqual([0.9, 0.95, 1].map(rarityOf), ['sure', 'sure', 'sure']);
  // The other side of a round number lands a hair off it; the band is the same.
  assert.equal(rarityOf(1 - 0.9), 'rare');
  assert.equal(rarityOf(1 - 0.75), 'unlikely');
  assert.equal(rarityOf(likelihood({ success: false, chance: chanceOf(9, 10, 'normal', true) })), 'rare', 'a miss only a natural 1 brings');
});

test('how a recorded d20 was rolled: two different faces tell; two the same, or one, read as a plain roll', () => {
  assert.equal(modeRolled({ natural: 14, rolls: [14] }), 'normal');
  assert.equal(modeRolled({ natural: 14, rolls: [14, 3] }), 'advantage');
  assert.equal(modeRolled({ natural: 3, rolls: [14, 3] }), 'disadvantage');
  assert.equal(modeRolled({ natural: 9, rolls: [9, 9] }), 'normal');
});

test('a check or a save the hero rolled is a die against its DC', () => {
  assert.deepEqual(dieOfCheck({ playerId: 'p1', success: false, bonus: 5, dc: 10, mode: 'normal' }), { playerId: 'p1', success: false, chance: 0.8 });
  near(dieOfCheck({ playerId: 'p1', success: true, bonus: 5, dc: 10, mode: 'advantage' }).chance, 0.96);
});

const d20 = (natural: number, total: number, rolls = [natural]) => ({ natural, rolls, total });
const attack = (actor: string, target: string, natural: number, bonus: number, ac: number, hit: boolean, more: object = {}): CombatEvent => ({
  kind: 'attack', round: 1, actor, result: { attacker: actor, target, attack: 'Longsword', roll: d20(natural, natural + bonus), ac, hit, critical: natural === 20, damage: hit ? 5 : 0 }, ...more,
}) as CombatEvent;

test('a round’s dice are read from the engine’s log: a hero’s attacks and spell attacks, and a foe’s save against a hero’s spell', () => {
  const heroes = new Set(['p1', 'p2']);
  const events: CombatEvent[] = [
    attack('p1', 'foe-1', 3, 5, 15, false),
    attack('foe-1', 'p1', 18, 4, 16, true),                      // a foe's attack is nobody's action
    attack('p1', 'foe-1', 12, 5, 15, true, { reaction: true }),  // an opportunity attack is not the hero's action
    { kind: 'spell', round: 1, actor: 'p2', spellId: 'ray-of-frost', outcomes: [{ target: 'foe-1', attack: { attacker: 'p2', target: 'foe-1', attack: 'Ray of Frost', roll: d20(20, 25), ac: 25, hit: true, critical: true, damage: 4 }, save: null, damage: 4, healed: 0 }] },
    { kind: 'spell', round: 1, actor: 'p2', spellId: 'thunderwave', outcomes: [
      { target: 'foe-1', attack: null, save: { roll: d20(9, 15), success: true }, damage: 2, healed: 0 },   // +6 against DC 13: it saves on a 7, 7 in 10
      { target: 'foe-2', attack: null, save: { roll: d20(2, 11), success: false }, damage: 4, healed: 0 },  // +9 against DC 13: it fails only on a 1, 2 or 3
      { target: 'foe-3', attack: null, save: { roll: null, success: false }, damage: 4, healed: 0 },        // it cannot save: no die
    ] },
    { kind: 'spell', round: 1, actor: 'p2', spellId: 'magic-missile', outcomes: [{ target: 'foe-1', attack: null, save: null, damage: 3, healed: 0 }] },
    { kind: 'dodge', round: 1, actor: 'p1' },
  ] as CombatEvent[];
  const dice = diceOfRound(events, (id) => heroes.has(id), (id) => (id === 'p2' ? 13 : null));
  assert.deepEqual(dice.map((d) => [d.playerId, d.success]), [['p1', false], ['p2', true], ['p2', false], ['p2', true]]);
  near(dice[0].chance, 0.55, 'AC 15 with +5');
  near(dice[1].chance, 0.05, 'a spell attack that only a natural 20 lands');
  near(dice[2].chance, 0.3, 'the foe saves 7 times in 10, so the spell had 3 chances in 10; it saved, so the hero failed');
  near(dice[3].chance, 0.15, 'the foe fails 3 times in 20: the hero’s long odds, and it landed');
  assert.deepEqual(diceOfRound(events, () => false, () => null), [], 'no heroes, no dice');
});

test('a real round: the fight hands up one die for the hero’s attack, with the chance its numbers give', () => {
  const fighter = heroSheet({ id: 'p1', name: 'Bryn', race: 'human', characterClass: 'fighter' });
  const { party, combat } = startFight({ version: 1, rng: 3, sheets: { p1: fighter } }, ['goblin-warrior']);
  const round = fightRound(party, combat, { p1: { choiceId: 'a', roll: 12 } });
  const told = round.lines.map((l) => /^Bryn attacks .+: (\d+) \(total (-?\d+)\) vs AC (\d+), (critical hit|hit|miss)/.exec(l)).find((m) => m !== null);
  if (!told) {
    // Too far to strike this round: the hero moved, and a move rolls nothing.
    assert.deepEqual(round.dice.filter((d) => d.playerId === 'p1'), []);
    return;
  }
  const [, natural, total, ac, outcome] = told;
  const mine = round.dice.filter((d) => d.playerId === 'p1');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].success, outcome !== 'miss');
  near(mine[0].chance, chanceOf(Number(total) - Number(natural), Number(ac), 'normal', true));
  assert.ok(round.dice.every((d) => d.playerId === 'p1'), 'the goblin’s dice are not the heroes’');
});
