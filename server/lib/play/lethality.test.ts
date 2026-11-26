import assert from 'node:assert/strict';
import { test } from 'node:test';
import { atLevel, startingLevel } from '../rules/depth.ts';
import { dungeonTables } from '../rules/dungeonTables.ts';
import { buildEncounter } from '../rules/encounter.ts';
import { habitat } from '../rules/habitats.ts';
import { seededRng } from '../rules/rng.ts';
import { monster } from '../rules/monsters.ts';
import { heroAt, playFight, tally, voteRoll } from './lethality.ts';

const PARTY = ['fighter', 'rogue', 'cleric', 'wizard'];

/** Moderate fights a level-1 dungeon of each kind stocks for four new heroes (its monsters at its level), seed after seed. */
function* moderate(): Generator<string[]> {
  const levels = atLevel(PARTY.length, startingLevel([1, 1, 1, 1]));
  for (let seed = 1; ; seed++) {
    for (const { value: kind } of dungeonTables().kinds.rows) yield buildEncounter(seededRng(seed), levels, 'moderate', habitat(kind.id)).monsters;
  }
}

test('four level-1 heroes usually survive the moderate fights of a level-1 dungeon: three in four won, under 5% of heroes dead a fight', () => {
  const t = tally(PARTY, 1, moderate(), 400);
  assert.ok(t.won / t.fights >= 0.75, `won ${t.won} of ${t.fights}`);
  assert.ok(t.dead / (t.fights * t.heroes) < 0.05, `${t.dead} heroes dead in ${t.fights} fights`);
});

test('the simulation is seeded: the same fights go the same way', () => {
  assert.deepEqual(tally(PARTY, 1, moderate(), 10), tally(PARTY, 1, moderate(), 10));
});

test('a simulated hero is fresh at its level; each vote’s d20 is spread over 1–20, fresh for each hero and round', () => {
  assert.deepEqual([heroAt('fighter', 0, 1).level, heroAt('fighter', 0, 1).xp, heroAt('wizard', 2, 3).level, heroAt('wizard', 2, 3).xp], [1, 0, 3, 900]);
  assert.equal(heroAt('wizard', 2, 3).name, 'wizard 2');
  const rolls = Array.from({ length: 400 }, (_, k) => voteRoll(k, k % 7, k % 4));
  assert.deepEqual([Math.min(...rolls), Math.max(...rolls), new Set(rolls).size], [1, 20, 20]);
  assert.notEqual(voteRoll(3, 1, 0), voteRoll(3, 1, 1));
  assert.notEqual(voteRoll(3, 1, 0), voteRoll(3, 2, 0));
  assert.notEqual(voteRoll(3, 1, 0), voteRoll(4, 1, 0));
  assert.deepEqual([voteRoll(0, 0, 0), voteRoll(1, 1, 1), voteRoll(2, 3, 1)], [1, 20, 1 + ((2 * 7919 + 3 * 104729 + 31) % 20)]);
});

test('the tally adds up each fight as played', () => {
  const fights = [['goblin-warrior'], ['ogre'], ['rat', 'rat'], ['bugbear-warrior'], ['goblin-warrior', 'goblin-warrior'], ['wolf'], ['skeleton', 'zombie'], ['bandit']];
  const t = tally(['fighter', 'wizard'], 1, fights[Symbol.iterator](), fights.length);
  const played = fights.map((foes, f) => playFight({ version: 1, rng: 1000 + f, sheets: { p0: heroAt('fighter', 0, 1), p1: heroAt('wizard', 1, 1) } }, foes, f));
  const count = (end: string) => played.filter((p) => p.ended === end).length;
  assert.deepEqual(t, {
    fights: fights.length, won: count('victory'), fled: count('fled'), lost: count('defeat'), heroes: 2,
    dead: played.reduce((n, p) => n + Object.values(p.party.sheets).filter((s) => s.dead).length, 0),
    rounds: played.reduce((n, p) => n + p.rounds, 0), foes: fights.flat().length, xp: fights.flat().reduce((n, id) => n + monster(id).xp, 0),
  });
  assert.ok(played.some((p) => p.ended === 'victory') && played.some((p) => p.ended !== 'victory'), played.map((p) => p.ended).join());
  assert.ok(t.dead > 0 && t.rounds > fights.length);
});
