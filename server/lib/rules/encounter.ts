/**
 * Encounter building, SRD 5.2: spend the party's XP budget on monsters no tougher than the party. At
 * levels 1 and 2, where the 5.2 table is swingy, the budget is halved and the foes are few; an encounter
 * is at most two kinds of monster. The same budgets rate a list of monsters the party can already see
 * (rateEncounter): the fight is low, moderate, high, or deadly above high, and each monster is puny,
 * weak, even, strong or deadly. Puny is under half the low line; the others sit on those same lines.
 * See docs/rules-design.md (Phase 5).
 */
import { type Difficulty, encounterBudget, type Monster, monster, monsters } from './monsters.ts';
import { type Rng, pick } from './rng.ts';
import { require } from './violation.ts';

export interface Encounter { difficulty: Difficulty; budget: number; xp: number; monsters: string[] }

/** The 5.2 budgets, plus deadly: more XP than a high encounter for this party. */
export type FightBand = Difficulty | 'deadly';
/**
 * One monster against this party. Puny is under half the low budget; weak fills the rest of a low fight,
 * even a moderate one, strong a high one, deadly anything above high.
 */
export type Toughness = 'puny' | 'weak' | 'even' | 'strong' | 'deadly';

const TOUGHNESS = { low: 'weak', moderate: 'even', high: 'strong', deadly: 'deadly' } as const satisfies Record<FightBand, Toughness>;

const MAX_MONSTERS = 8;
const MAX_KINDS = 2;
/** Up to this level the 5.2 budget is halved. */
const GENTLE_UP_TO = 2;

const top = (levels: readonly number[]) => Math.max(...levels);

/** The 5.2 budget for these levels, halved (rounded down) when the best of them is 1 or 2. */
export function temperedBudget(levels: readonly number[], difficulty: Difficulty): number {
  const budget = encounterBudget(levels, difficulty);
  return top(levels) <= GENTLE_UP_TO ? Math.floor(budget / 2) : budget;
}

/**
 * What a room's encounter may spend: the tempered budget, except that a lone hero at levels 1–2 meets no
 * more than a moderate fight (a high one is stocked to the moderate line). Alone, a hero has nobody to get
 * them up or stabilize them, and one hit can drop a level-1 hero (issue q-mwxtmmia-9b6443).
 */
export function stockedBudget(levels: readonly number[], difficulty: Difficulty): number {
  const lone = levels.length === 1 && top(levels) <= GENTLE_UP_TO;
  return temperedBudget(levels, lone && difficulty === 'high' ? 'moderate' : difficulty);
}

/** How many foes an encounter may have: half the party (rounded up) at levels 1–2, the party at 3–4, twice it from 5; never above eight. */
export function foeCap(partySize: number, level: number): number {
  const cap = level <= GENTLE_UP_TO ? Math.ceil(partySize / 2) : level <= 4 ? partySize : 2 * partySize;
  return Math.min(MAX_MONSTERS, cap);
}

/** Monsters the engine can fight: an attack roll, a CR no higher than the party's best level. */
export function candidates(levels: readonly number[], pool: readonly string[] | undefined): Monster[] {
  const allowed = pool ? new Set(pool) : null;
  return [...monsters().values()].filter((m) => m.attacks.length > 0 && m.cr <= top(levels) && (!allowed || allowed.has(m.id)));
}

/** Monsters worth at least 1/(2 × cap) of the budget, so `cap` of them spend at least half; any, if none are. */
export function worthwhile(all: Monster[], budget: number, cap: number = MAX_MONSTERS): Monster[] {
  const big = all.filter((m) => m.xp * 2 * cap >= budget && m.xp <= budget);
  return big.length > 0 ? big : all;
}

/**
 * Keeps adding monsters that fit what is left of the budget (half the time another of the same kind, so
 * encounters come in groups), up to the cap for the party's size and level. `budget` is stockedBudget's
 * for the difficulty unless given (the road's, play/trek.ts roadBudget).
 */
export function buildEncounter(rng: Rng, levels: readonly number[], difficulty: Difficulty, pool?: readonly string[], budget = stockedBudget(levels, difficulty)): Encounter {
  const cap = foeCap(levels.length, top(levels));
  return { difficulty, ...composeEncounter(rng, budget, worthwhile(candidates(levels, pool), budget, cap), cap) };
}

/** Spends `budget` on `kinds`, as buildEncounter describes: at most `cap` monsters of at most two kinds. */
export function composeEncounter(rng: Rng, budget: number, kinds: readonly Monster[], cap: number = MAX_MONSTERS): Omit<Encounter, 'difficulty'> {
  const chosen: Monster[] = [];
  const fits = (left: number) => {
    const met = [...new Set(chosen)];
    return (met.length < MAX_KINDS ? kinds : met).filter((m) => m.xp <= left);
  };
  require(fits(budget).length > 0, `no monster in the pool fits a budget of ${budget} XP`);
  let left = budget;
  while (chosen.length < cap && fits(left).length > 0) {
    const last = chosen.at(-1);
    const next = last && last.xp <= left && rng.die(2) === 1 ? last : pick(rng, fits(left));
    chosen.push(next);
    left -= next.xp;
  }
  return { budget, xp: budget - left, monsters: chosen.map((m) => m.id) };
}

/**
 * The DM's proposed foes held to a high encounter for these levels: each in order while it fits what is
 * left of the budget, up to the foe cap. One always stays: the least of them, when none fits.
 */
export function capFight(ids: readonly string[], levels: readonly number[]): string[] {
  const cap = foeCap(levels.length, top(levels));
  let left = temperedBudget(levels, 'high');
  const kept: string[] = [];
  for (const id of ids) {
    const xp = monster(id).xp;
    if (kept.length < cap && xp <= left) { kept.push(id); left -= xp; }
  }
  return kept.length > 0 ? kept : [ids.reduce((a, b) => (monster(b).xp < monster(a).xp ? b : a))];
}

/** Where `xp` sits on the party's tempered budget: low, moderate, high, or deadly above high. */
export function fightBand(levels: readonly number[], xp: number): FightBand {
  if (xp <= temperedBudget(levels, 'low')) return 'low';
  if (xp <= temperedBudget(levels, 'moderate')) return 'moderate';
  if (xp <= temperedBudget(levels, 'high')) return 'high';
  return 'deadly';
}

/**
 * How hard one monster is for this party. Under half the low budget it is puny (a rat against four
 * level-1 heroes); at half that line through low it is weak (a goblin, exactly half, stays weak).
 * The comparison is `xp * 2 < low`, so an odd budget needs no rounding. The fight's own band is unchanged.
 */
export function toughnessFor(levels: readonly number[], xp: number): Toughness {
  const band = fightBand(levels, xp);
  if (band === 'low' && xp * 2 < temperedBudget(levels, 'low')) return 'puny';
  return TOUGHNESS[band];
}

export interface RatedMonster { id: string; name: string; xp: number; toughness: Toughness }
export interface RatedEncounter { band: FightBand; xp: number; monsters: RatedMonster[] }

/** Rates these monsters, in order, against the party. The fight's band is their XP together. */
export function rateEncounter(levels: readonly number[], ids: readonly string[]): RatedEncounter {
  const monsters = ids.map((id) => {
    const m = monster(id);
    return { id, name: m.name, xp: m.xp, toughness: toughnessFor(levels, m.xp) };
  });
  const xp = monsters.reduce((sum, m) => sum + m.xp, 0);
  return { band: fightBand(levels, xp), xp, monsters };
}
