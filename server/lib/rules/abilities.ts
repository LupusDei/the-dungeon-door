/** Ability scores: modifiers and the three SRD 5.2 ways to generate them, plus the background increase. */
import type { Rng } from './rng.ts';
import { require } from './violation.ts';

export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
export type Ability = (typeof ABILITIES)[number];
export type AbilityScores = Record<Ability, number>;

export const STANDARD_ARRAY: readonly number[] = [15, 14, 13, 12, 10, 8];
export const POINT_BUY_BUDGET = 27;
const MAX_SCORE = 20;

/** How the player generates scores. `order` names the ability that gets each value, in turn. */
export type AbilityMethod =
  | { kind: 'standardArray'; order: Ability[] }
  | { kind: 'pointBuy'; scores: AbilityScores }
  | { kind: 'rolled'; order: Ability[] };

/** The 5.2 background increase: +2 and +1 to two of its three abilities, or +1 to all three. */
export type BackgroundBoost = { kind: 'twoOne'; plusTwo: Ability; plusOne: Ability } | { kind: 'oneOneOne' };

export const abilityModifier = (score: number): number => Math.floor((score - 10) / 2);

/** values[i] goes to order[i]. */
export function assignScores(values: readonly number[], order: readonly Ability[]): AbilityScores {
  require(order.length === ABILITIES.length && new Set(order).size === ABILITIES.length, 'assign each of the six abilities exactly once');
  return Object.fromEntries(order.map((ability, i) => [ability, values[i]])) as AbilityScores;
}

/** What these scores cost under point buy; `costs` is score → points (8–15 in the SRD). */
export function pointBuyCost(scores: AbilityScores, costs: ReadonlyMap<number, number>): number {
  return ABILITIES.reduce((total, ability) => {
    const cost = costs.get(scores[ability]);
    require(cost !== undefined, `point buy scores run from 8 to 15; ${ability} is ${scores[ability]}`);
    return total + cost;
  }, 0);
}

export function roll4d6DropLowest(rng: Rng): number {
  const dice = [rng.die(6), rng.die(6), rng.die(6), rng.die(6)];
  return dice.reduce((a, b) => a + b) - Math.min(...dice);
}

export function rollAbilityScores(rng: Rng): number[] {
  return ABILITIES.map(() => roll4d6DropLowest(rng));
}

/** Scores from a method, and the six rolled values when the method rolls (null otherwise). */
export function scoresFor(
  method: AbilityMethod,
  rng: Rng,
  costs: ReadonlyMap<number, number>,
): { scores: AbilityScores; rolls: number[] | null } {
  if (method.kind === 'standardArray') return { scores: assignScores(STANDARD_ARRAY, method.order), rolls: null };
  if (method.kind === 'rolled') {
    const rolls = rollAbilityScores(rng);
    return { scores: assignScores(rolls, method.order), rolls };
  }
  const cost = pointBuyCost(method.scores, costs);
  require(cost <= POINT_BUY_BUDGET, `point buy costs ${cost}; the budget is ${POINT_BUY_BUDGET}`);
  return { scores: { ...method.scores }, rolls: null };
}

function boosts(boost: BackgroundBoost, allowed: readonly Ability[]): [Ability, number][] {
  if (boost.kind === 'oneOneOne') return allowed.map((a) => [a, 1]);
  require(boost.plusTwo !== boost.plusOne, 'the +2 and +1 go to two different abilities');
  return [[boost.plusTwo, 2], [boost.plusOne, 1]];
}

export function applyBackgroundBoost(scores: AbilityScores, allowed: readonly Ability[], boost: BackgroundBoost): AbilityScores {
  const result = { ...scores };
  for (const [ability, amount] of boosts(boost, allowed)) {
    require(allowed.includes(ability), `${ability} is not one of this background's abilities (${allowed.join(', ')})`);
    result[ability] += amount;
    require(result[ability] <= MAX_SCORE, `${ability} would be ${result[ability]}; the most is ${MAX_SCORE}`);
  }
  return result;
}
