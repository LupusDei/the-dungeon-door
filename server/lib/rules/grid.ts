/**
 * A fight on 5-foot squares (an original use of the grid, CC0). Distance in feet is 5 times the Chebyshev
 * distance, so a diagonal costs the same as an orthogonal step. Bands are read off that distance: engaged
 * within melee reach, near at 30 feet or less, far beyond. See docs/api.md.
 */
import type { Attack, Combatant } from './combatant.ts';
import type { Band, Place } from './bands.ts';
import { require } from './violation.ts';

export interface Square { x: number; y: number }

export interface Battlefield {
  width: number;
  height: number;
  squareFeet: 5;
  /** Squares nothing can enter. */
  walls: Square[];
  /** Squares of cover, when the room has any. */
  cover?: Square[];
}

export const SQUARE_FEET = 5;
export const NEAR_FEET = 30;

const NEIGHBORS: readonly (readonly [number, number])[] = [
  [-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1],
];

export const keyOf = (s: Square): string => `${s.x},${s.y}`;

export const sameSquare = (a: Square, b: Square): boolean => a.x === b.x && a.y === b.y;

/** Feet between two squares. A diagonal is one square, the same as a step north. */
export function feetBetween(a: Square, b: Square, squareFeet = SQUARE_FEET): number {
  return squareFeet * Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** The farthest this creature can strike in melee. No melee attack: 0. Otherwise 5, or the weapon's reach. */
export function meleeReach(c: { attacks: readonly Pick<Attack, 'ranged' | 'reach'>[] }): number {
  const melee = c.attacks.filter((a) => !a.ranged);
  if (melee.length === 0) return 0;
  return Math.max(...melee.map((a) => a.reach ?? SQUARE_FEET));
}

/** Where `me` stands, read off the squares. No square: the band already stored. */
export function derivePlace(me: Combatant, all: Readonly<Record<string, Combatant>>, squareFeet = SQUARE_FEET): Place {
  if (!me.square) return me.place ?? { band: 'near', with: [] };
  const foes = Object.values(all).filter((c) => c.id !== me.id && c.side !== me.side && c.status === 'up' && c.square);
  const feetTo = (c: Combatant) => feetBetween(me.square!, c.square!, squareFeet);
  if (me.status === 'up') {
    const engaged = foes.filter((f) => {
      const reach = Math.max(meleeReach(me), meleeReach(f));
      return reach > 0 && feetTo(f) <= reach;
    });
    if (engaged.length > 0) return { band: 'engaged', with: engaged.map((f) => f.id).sort() };
  }
  if (foes.length === 0) return { band: 'near', with: [] };
  const nearest = Math.min(...foes.map(feetTo));
  const band: Band = nearest <= NEAR_FEET ? 'near' : 'far';
  return { band, with: [] };
}

/** Every combatant's band, read again from the squares. */
export function syncPlaces(combatants: Record<string, Combatant>, squareFeet = SQUARE_FEET): Record<string, Combatant> {
  return Object.fromEntries(Object.entries(combatants).map(([id, c]) => [id, { ...c, place: derivePlace(c, combatants, squareFeet) }]));
}

export function roomBattlefield(): Battlefield {
  return { width: 10, height: 8, squareFeet: 5, walls: [] };
}

export function roadBattlefield(): Battlefield {
  return { width: 16, height: 6, squareFeet: 5, walls: [] };
}

export interface GridOpening {
  /** The road: both sides start 60 feet apart. A room starts at 30. */
  far?: boolean;
  /** The fight begins in melee. Whoever is not up stays back at the band. */
  surprise?: boolean;
}

interface Token { id: string; side: 'party' | 'foes'; status: string }

const taken = (squares: Readonly<Record<string, Square>>, s: Square): boolean =>
  Object.values(squares).some((q) => sameSquare(q, s));

function put(squares: Record<string, Square>, bf: Battlefield, id: string, prefer: Square): void {
  if (inBounds(bf, prefer) && !taken(squares, prefer)) {
    squares[id] = prefer;
    return;
  }
  for (let y = 0; y < bf.height; y++) for (let x = 0; x < bf.width; x++) {
    const s = { x, y };
    if (!taken(squares, s)) {
      squares[id] = s;
      return;
    }
  }
  squares[id] = prefer;
}

/** ys starting at `start`, clamped to the map. */
function ysFrom(count: number, start: number, height: number): number[] {
  const begin = Math.max(0, Math.min(start, height - count));
  return Array.from({ length: count }, (_, i) => Math.min(height - 1, begin + i));
}

/**
 * Heroes on the west edge, monsters to the east, at the band's distance: 6 squares (30 ft) in a room,
 * 12 (60 ft) on the road, 1 when someone is surprised. A hero's line sits a little south of the monsters'
 * so a single room still has a corner farther than 30 feet.
 */
export function openingSquares(tokens: readonly Token[], opening: GridOpening = {}): { battlefield: Battlefield; squares: Record<string, Square> } {
  const far = opening.far === true;
  const surprise = opening.surprise === true;
  const battlefield = far ? roadBattlefield() : roomBattlefield();
  const gap = surprise ? 1 : far ? 12 : 6;
  const party = tokens.filter((t) => t.side === 'party');
  const foes = tokens.filter((t) => t.side === 'foes');
  const squares: Record<string, Square> = {};
  const up = (list: readonly Token[]) => list.filter((t) => t.status === 'up');
  const down = (list: readonly Token[]) => list.filter((t) => t.status !== 'up');
  if (!surprise) {
    const shift = Math.min(3, Math.max(0, battlefield.height - Math.max(party.length, 1)));
    const foeYs = ysFrom(foes.length, 0, battlefield.height);
    const heroYs = ysFrom(party.length, shift, battlefield.height);
    foes.forEach((t, i) => put(squares, battlefield, t.id, { x: Math.min(battlefield.width - 1, gap), y: foeYs[i] ?? 0 }));
    party.forEach((t, i) => put(squares, battlefield, t.id, { x: 0, y: heroYs[i] ?? 0 }));
    return { battlefield, squares };
  }
  const standing = up(party);
  const waiting = up(foes);
  const n = Math.max(standing.length, waiting.length, 1);
  const heroAt = Math.floor((n - standing.length) / 2);
  const foeAt = Math.floor((n - waiting.length) / 2);
  standing.forEach((t, i) => put(squares, battlefield, t.id, { x: 0, y: heroAt + i }));
  waiting.forEach((t, i) => put(squares, battlefield, t.id, { x: gap, y: foeAt + i }));
  const enemySquares = (side: Token['side']) => Object.entries(squares)
    .filter(([id]) => tokens.find((t) => t.id === id)?.side !== side)
    .map(([, s]) => s);
  for (const t of [...down(party), ...down(foes)]) {
    putAside(squares, battlefield, t.id, enemySquares(t.side), far ? 'far' : 'near');
  }
  return { battlefield, squares };
}

/** A square whose nearest enemy is about 30 ft (near) or past 30 (far), for someone who is not in the melee. */
function putAside(squares: Record<string, Square>, bf: Battlefield, id: string, enemies: readonly Square[], want: 'near' | 'far'): void {
  let best: Square | null = null;
  let score = Infinity;
  const goal = want === 'near' ? NEAR_FEET : 60;
  for (let y = 0; y < bf.height; y++) for (let x = 0; x < bf.width; x++) {
    const s = { x, y };
    if (taken(squares, s)) continue;
    const nearest = enemies.length === 0 ? goal : Math.min(...enemies.map((e) => feetBetween(s, e)));
    const ok = want === 'near' ? nearest > 10 && nearest <= NEAR_FEET : nearest > NEAR_FEET;
    if (!ok) continue;
    const rank = Math.abs(nearest - goal) * 100 + x + y;
    if (rank < score) {
      best = s;
      score = rank;
    }
  }
  put(squares, bf, id, best ?? { x: 0, y: bf.height - 1 });
}

/** A fight stored as bands, laid onto a grid that keeps those bands. Engaged stand adjacent; near is 30 ft; far is 60. */
export function squaresMatchingPlaces(
  tokens: readonly (Token & { band?: Band })[],
): { battlefield: Battlefield; squares: Record<string, Square> } {
  const far = tokens.some((t) => t.band === 'far');
  const battlefield = far ? roadBattlefield() : roomBattlefield();
  const xOf = (side: Token['side'], band: Band | undefined): number => {
    if (band === 'engaged') return side === 'party' ? 4 : 5;
    if (band === 'far') return side === 'party' ? 0 : Math.min(battlefield.width - 1, 12);
    return side === 'party' ? 0 : Math.min(battlefield.width - 1, 6);
  };
  const groups = new Map<string, (Token & { band?: Band })[]>();
  for (const t of tokens) {
    const k = `${t.side}:${t.band ?? 'near'}`;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const squares: Record<string, Square> = {};
  for (const group of groups.values()) {
    const x = xOf(group[0].side, group[0].band);
    const start = Math.max(0, Math.floor((battlefield.height - group.length) / 2));
    group.forEach((t, i) => put(squares, battlefield, t.id, { x, y: Math.min(battlefield.height - 1, start + i) }));
  }
  return { battlefield, squares };
}

export function inBounds(bf: Battlefield, s: Square): boolean {
  return s.x >= 0 && s.y >= 0 && s.x < bf.width && s.y < bf.height;
}

export interface ReachQuery {
  battlefield: Battlefield;
  from: Square;
  /** Feet of movement. */
  speedFeet: number;
  /** Cannot be entered (an enemy's square). Walls are read off the battlefield. */
  blocked: readonly Square[];
  /** Can be crossed, not ended on (an ally's square). */
  through: readonly Square[];
}

interface Step { x: number; y: number; cost: number }

/** Squares `from` can reach, cheapest first. The square they stand on is not among them. */
export function reachableSquares(q: ReachQuery): Square[] {
  return walk(q).filter((s) => s.cost > 0).sort((a, b) => a.cost - b.cost || a.y - b.y || a.x - b.x).map(({ x, y }) => ({ x, y }));
}

/** Feet of movement to step onto `to`, or null when no path that cheap exists. */
export function pathFeet(q: ReachQuery, to: Square): number | null {
  if (!inBounds(q.battlefield, to) || q.battlefield.walls.some((w) => sameSquare(w, to))) return null;
  if (q.blocked.some((s) => sameSquare(s, to)) || q.through.some((s) => sameSquare(s, to))) return null;
  if (sameSquare(q.from, to)) return 0;
  const hit = walk(q).find((s) => s.x === to.x && s.y === to.y);
  return hit ? hit.cost : null;
}

function walk(q: ReachQuery): Step[] {
  const step = q.battlefield.squareFeet;
  const blocked = new Set([...q.blocked, ...q.battlefield.walls].map(keyOf));
  const through = new Set(q.through.map(keyOf));
  const best = new Map<string, number>([[keyOf(q.from), 0]]);
  const out: Step[] = [{ ...q.from, cost: 0 }];
  const queue: Step[] = [{ ...q.from, cost: 0 }];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const [dx, dy] of NEIGHBORS) {
      const n = { x: cur.x + dx, y: cur.y + dy };
      if (!inBounds(q.battlefield, n)) continue;
      const cost = cur.cost + step;
      if (cost > q.speedFeet) continue;
      const k = keyOf(n);
      if (blocked.has(k) || (best.get(k) ?? Infinity) <= cost) continue;
      best.set(k, cost);
      const landed = { ...n, cost };
      queue.push(landed);
      if (!through.has(k)) out.push(landed);
    }
  }
  return out;
}

/** Enemy squares block entry. Ally squares can be crossed and not ended on. The dead leave their square. */
export function occupancy(me: Combatant, all: Readonly<Record<string, Combatant>>): { blocked: Square[]; through: Square[] } {
  const blocked: Square[] = [];
  const through: Square[] = [];
  for (const c of Object.values(all)) {
    if (c.id === me.id || !c.square || c.status === 'dead') continue;
    (c.side === me.side ? through : blocked).push(c.square);
  }
  return { blocked, through };
}

/** Foes whose melee reach the step from `from` to `to` leaves. */
export function leavesReach(me: Combatant, all: Readonly<Record<string, Combatant>>, to: Square): string[] {
  if (!me.square) return [];
  return Object.values(all).filter((f) => {
    if (f.id === me.id || f.side === me.side || f.status !== 'up' || !f.square) return false;
    const reach = meleeReach(f);
    if (reach <= 0 || !f.attacks.some((a) => !a.ranged)) return false;
    return feetBetween(me.square!, f.square) <= reach && feetBetween(to, f.square) > reach;
  }).map((f) => f.id);
}

export interface SquareStep { x: number; y: number; dash: boolean }

/**
 * `dest` is legal for `name`. `dash` omitted is inferred: past speed and within double speed is a Dash.
 * A stated dash must match. Disengage is refused when the step leaves no one's reach.
 */
export function checkSquare(
  name: string, bf: Battlefield, from: Square, dest: Square, speedFeet: number,
  blocked: readonly Square[], through: readonly Square[],
  dash: boolean | undefined, disengage: boolean | undefined, leaving: boolean,
): SquareStep {
  require(!(dest.x === from.x && dest.y === from.y), `${name} is already there.`);
  const cost = pathFeet({ battlefield: bf, from, speedFeet: speedFeet * 2, blocked, through }, dest);
  require(cost !== null && cost > 0, `${name} cannot get there this turn.`);
  const needsDash = cost > speedFeet;
  const stated = dash === true;
  if (dash !== undefined) {
    require(stated === needsDash, needsDash ? `${name} needs to Dash to get there.` : 'A move is enough; Dash covers two bands.');
  }
  if (disengage) require(leaving, `${name} is not leaving anyone's reach.`);
  return { x: dest.x, y: dest.y, dash: needsDash };
}

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id) => b.includes(id));

export interface BandWish { to: Band; engage?: string[]; dash?: boolean; disengage?: boolean }

/**
 * A square that makes `wish` true, within speed (or double, when it says Dash). The cheapest such square.
 * Throws a RuleViolation when none exists, or when the dash flag does not match the cost.
 */
export function squareForBand(
  name: string, bf: Battlefield, me: Combatant, all: Readonly<Record<string, Combatant>>, wish: BandWish,
): SquareStep {
  require(me.square !== undefined && me.square !== null, `${name} has nowhere to move from.`);
  const speed = me.speed ?? 30;
  const now = derivePlace(me, all);
  const want = [...(wish.engage ?? [])].sort();
  if (wish.to === 'engaged') {
    require(!(now.band === 'engaged' && sameIds(now.with, want)), `${name} is already engaged with them.`);
  } else if (now.band === wish.to) {
    require(false, `${name} is already ${wish.to}.`);
  }
  const { blocked, through } = occupancy(me, all);
  const options = reachableSquares({ battlefield: bf, from: me.square, speedFeet: speed * 2, blocked, through });
  const exact: Square[] = [];
  const loose: Square[] = [];
  for (const sq of options) {
    const moved = { ...me, square: sq };
    const place = derivePlace(moved, { ...all, [me.id]: moved });
    if (wish.to === 'engaged') {
      if (!want.every((id) => place.with.includes(id))) continue;
      (sameIds(place.with, want) ? exact : loose).push(sq);
    } else if (place.band === wish.to) exact.push(sq);
  }
  const pool = exact.length > 0 ? exact : loose;
  require(pool.length > 0, `${name} cannot get there this turn.`);
  const costOf = (sq: Square) => pathFeet({ battlefield: bf, from: me.square!, speedFeet: speed * 2, blocked, through }, sq) ?? Infinity;
  pool.sort((a, b) => costOf(a) - costOf(b) || a.y - b.y || a.x - b.x);
  const dest = pool[0];
  const leaving = leavesReach(me, all, dest).length > 0;
  // A band move states its dash, as the older rule did. Omitting it means a single move.
  return checkSquare(name, bf, me.square, dest, speed, blocked, through, wish.dash ?? false, wish.disengage, leaving);
}

/** True when `dest` is past `me`'s speed and still within a Dash. */
export function moveNeedsDash(bf: Battlefield, me: Combatant, all: Readonly<Record<string, Combatant>>, dest: Square): boolean {
  if (!me.square) return false;
  const { blocked, through } = occupancy(me, all);
  const speed = me.speed ?? 30;
  const cost = pathFeet({ battlefield: bf, from: me.square, speedFeet: speed * 2, blocked, through }, dest);
  return cost !== null && cost > speed;
}

/** The reachable square nearest `goal`, when it is closer than standing still. */
export function closestApproach(
  bf: Battlefield, me: Combatant, all: Readonly<Record<string, Combatant>>, goal: Square, speedFeet: number,
): Square | null {
  if (!me.square) return null;
  const { blocked, through } = occupancy(me, all);
  const options = reachableSquares({ battlefield: bf, from: me.square, speedFeet, blocked, through });
  const here = feetBetween(me.square, goal);
  const closer = options.filter((sq) => feetBetween(sq, goal) < here);
  if (closer.length === 0) return null;
  closer.sort((a, b) => feetBetween(a, goal) - feetBetween(b, goal) || a.y - b.y || a.x - b.x);
  return closer[0];
}

/** A reachable square within `reachFeet` of `goal`. The cheapest. */
export function stepIntoReach(
  bf: Battlefield, me: Combatant, all: Readonly<Record<string, Combatant>>, goal: Square, reachFeet: number, speedFeet: number,
): Square | null {
  if (!me.square) return null;
  if (feetBetween(me.square, goal) <= reachFeet) return null;
  const { blocked, through } = occupancy(me, all);
  const options = reachableSquares({ battlefield: bf, from: me.square, speedFeet, blocked, through })
    .filter((sq) => feetBetween(sq, goal) <= reachFeet);
  return options[0] ?? null;
}
