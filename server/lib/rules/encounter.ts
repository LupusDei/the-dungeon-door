/** Encounter building, SRD 5.2: spend the party's XP budget on monsters no tougher than the party. */
import { type Difficulty, encounterBudget, type Monster, monsters } from './monsters.ts';
import { type Rng, pick } from './rng.ts';
import { require } from './violation.ts';

export interface Encounter { difficulty: Difficulty; budget: number; xp: number; monsters: string[] }

const MAX_MONSTERS = 8;

/** Monsters the engine can fight: an attack roll, a CR no higher than the party's best level. */
export function candidates(levels: readonly number[], pool: readonly string[] | undefined): Monster[] {
  const allowed = pool ? new Set(pool) : null;
  const top = Math.max(...levels);
  return [...monsters().values()].filter((m) => m.attacks.length > 0 && m.cr <= top && (!allowed || allowed.has(m.id)));
}

/** Monsters worth at least 1/16 of the budget, so eight of them spend at least half; any, if none are. */
export function worthwhile(all: Monster[], budget: number): Monster[] {
  const big = all.filter((m) => m.xp * 2 * MAX_MONSTERS >= budget && m.xp <= budget);
  return big.length > 0 ? big : all;
}

/**
 * Keeps adding monsters that fit what is left of the budget (half the time another of the same kind, so
 * encounters come in groups), up to eight.
 */
export function buildEncounter(rng: Rng, levels: readonly number[], difficulty: Difficulty, pool?: readonly string[]): Encounter {
  const budget = encounterBudget(levels, difficulty);
  return { difficulty, ...composeEncounter(rng, budget, worthwhile(candidates(levels, pool), budget)) };
}

/** Spends `budget` on `kinds`, as buildEncounter describes. */
export function composeEncounter(rng: Rng, budget: number, kinds: readonly Monster[]): Omit<Encounter, 'difficulty'> {
  const fits = (left: number) => kinds.filter((m) => m.xp <= left);
  require(fits(budget).length > 0, `no monster in the pool fits a budget of ${budget} XP`);
  const chosen: Monster[] = [];
  let left = budget;
  while (chosen.length < MAX_MONSTERS && fits(left).length > 0) {
    const last = chosen.at(-1);
    const next = last && last.xp <= left && rng.die(2) === 1 ? last : pick(rng, fits(left));
    chosen.push(next);
    left -= next.xp;
  }
  return { budget, xp: budget - left, monsters: chosen.map((m) => m.id) };
}
