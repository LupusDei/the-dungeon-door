/**
 * Dungeons: rooms, their contents and treasure, and the fixed seeded map (5, 7 or 9 rooms). The
 * explore-as-you-go mode (explore.ts) shares the room model and stocking. See docs/rules-design.md.
 */
import { z } from 'zod';
import magicItemsJson from '../../data/srd/5.2/magicItems.json' with { type: 'json' };
import { addCorridors } from './corridors.ts';
import { parseDice, rollDice } from './dice.ts';
import { type Amount, dungeonTables, type MapSize, rollOn, type StockKind } from './dungeonTables.ts';
import { buildEncounter, type Encounter } from './encounter.ts';
import { habitat } from './habitats.ts';
import type { Difficulty } from './monsters.ts';
import { type Rng, pick, sample, seededRng } from './rng.ts';
import { once, parseTable } from './srd.ts';

export interface Treasure { sp: number; gp: number; gems: number; jewellery: number; magicItem: string | null }
export interface RoomContents {
  kind: StockKind;
  encounter: Encounter | null;
  /** An SRD 5.2 trap or hazard id (5.2 traps.json, 5.2 hazards.json); a map stored before Phase 3 may hold 5.1 trap ids until it is next loaded (rules/traps.ts currentTraps). */
  trap: string | null;
  special: string | null;
  treasure: Treasure | null;
  dressing: string;
}
export interface Exit {
  id: string;
  /** How the way is closed: "open-passage", "locked-door", "secret-door"… */
  connection: string;
  /** The area it leads to; null while unexplored (explore mode). */
  to: string | null;
}
export interface DungeonNode {
  id: string;
  /** corridor: a fixed map's way between two rooms (corridors.ts); not a room. */
  type: 'room' | 'passage' | 'corridor' | 'stairs' | 'dead-end';
  name: string;
  depth: number;
  size: string | null;
  purpose: string | null;
  contents: RoomContents | null;
  exits: Exit[];
}
export interface Dungeon {
  version: 1;
  mode: 'fixed' | 'explore';
  seed: number;
  kind: string;
  levels: number[];
  entrance: string;
  /** The fixed map's goal room; explore mode has none. */
  goal: string | null;
  nodes: Record<string, DungeonNode>;
}
/** pool: the monsters that live in this kind of dungeon (rules/habitats.ts). */
export interface StockingContext { levels: number[]; depth: number; difficulty: Difficulty; pool?: readonly string[] }

const magicItems = once(() => parseTable('magicItems', z.object({ name: z.string(), rarity: z.string() }), magicItemsJson));
const RARE_FROM_DEPTH = 4;
/** A fixed map is one level deep. */
const FIXED_DEPTH = 1;

/** Magic items fit for a dungeon level: common and uncommon, and rare ones from level 4. */
export function magicItemPool(depth: number): string[] {
  const rarities = depth >= RARE_FROM_DEPTH ? ['Common', 'Uncommon', 'Rare'] : ['Common', 'Uncommon'];
  return magicItems().filter((m) => rarities.some((r) => m.rarity.startsWith(r))).map((m) => m.name);
}

function amountOf(rng: Rng, amount: Amount): number {
  if (rng.die(100) > amount.chance) return 0;
  return rollDice(rng, parseDice(amount.dice)).total * amount.multiplier;
}

/** OSE treasure for an unguarded room on this dungeon level (deeper than the table: its last band). */
export function rollTreasure(rng: Rng, depth: number): Treasure {
  const bands = dungeonTables().treasure;
  const band = bands.find((b) => b.levels.includes(depth)) ?? bands[bands.length - 1];
  return {
    sp: amountOf(rng, band.silver),
    gp: amountOf(rng, band.gold),
    gems: amountOf(rng, band.gems),
    jewellery: amountOf(rng, band.jewellery),
    magicItem: amountOf(rng, band.magicItem) > 0 ? pick(rng, magicItemPool(depth)) : null,
  };
}

function withTreasure(rng: Rng, depth: number, inSix: number): Treasure | null {
  return inSix > 0 && rng.die(6) <= inSix ? rollTreasure(rng, depth) : null;
}

/** OSE stocking: empty, monster, special or trap, each with its chance of treasure, plus dressing. */
export function stockRoom(rng: Rng, context: StockingContext): RoomContents {
  const tables = dungeonTables();
  const { kind, treasureIn6 } = rollOn(rng, tables.contents);
  const room: RoomContents = { kind, encounter: null, trap: null, special: null, treasure: null, dressing: '' };
  if (kind === 'monster') room.encounter = buildEncounter(rng, context.levels, context.difficulty, context.pool);
  if (kind === 'trap') room.trap = rollOn(rng, tables.traps);
  if (kind === 'special') room.special = pick(rng, tables.specials);
  room.treasure = withTreasure(rng, context.depth, treasureIn6);
  room.dressing = rollOn(rng, tables.dressing);
  return room;
}

/** The goal is never empty: a monster guarding treasure, at high difficulty. */
function goalContents(rng: Rng, context: StockingContext): RoomContents {
  return {
    kind: 'monster', encounter: buildEncounter(rng, context.levels, 'high', context.pool), trap: null, special: null,
    treasure: rollTreasure(rng, context.depth), dressing: rollOn(rng, dungeonTables().dressing),
  };
}

const emptyContents = (rng: Rng): RoomContents =>
  ({ kind: 'empty', encounter: null, trap: null, special: null, treasure: null, dressing: rollOn(rng, dungeonTables().dressing) });

/** A room with a rolled size; purpose and contents are the caller's. */
export function newRoom(rng: Rng, id: string, depth: number, purpose: string, contents: RoomContents): DungeonNode {
  const size = rollOn(rng, dungeonTables().roomSizes);
  return { id, type: 'room', name: `${size.name} (${size.feet} ft.)`, depth, size: size.id, purpose, contents, exits: [] };
}

function connect(rng: Rng, nodes: Record<string, DungeonNode>, a: string, b: string): void {
  const connection = rollOn(rng, dungeonTables().connections);
  nodes[a].exits.push({ id: b, connection, to: b });
  nodes[b].exits.push({ id: a, connection, to: a });
}

/** Pairs of distinct rooms with no way between them yet: where a loop may go. */
function loopCandidates(ids: string[], edges: [string, string][]): [string, string][] {
  const linked = new Set(edges.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));
  return ids.flatMap((a, i) => ids.slice(i + 1).filter((b) => !linked.has(`${a}|${b}`)).map((b): [string, string] => [a, b]));
}

/**
 * The fixed map's shape: room ids (entrance r0, the path, the goal, then branches) and its edges: the
 * path, each branch off a path room (off the entrance too on a short map, never off the goal), then loops.
 */
export function layout(rng: Rng, size: MapSize): { ids: string[]; goal: string; edges: [string, string][] } {
  const plan = dungeonTables().sizes[size];
  const ids = Array.from({ length: plan.rooms }, (_, i) => `r${i}`);
  const path = ids.slice(0, plan.path + 2);
  const anchors = size === 'short' ? path.slice(0, -1) : path.slice(1, -1);
  const tree: [string, string][] = [
    ...path.slice(1).map((id, i): [string, string] => [path[i], id]),
    ...ids.slice(path.length).map((id): [string, string] => [pick(rng, anchors), id]),
  ];
  return { ids, goal: path[path.length - 1], edges: [...tree, ...sample(rng, loopCandidates(ids, tree), plan.loops)] };
}

/** A whole map at once, from the seed: 5, 7 or 9 rooms, the same every time for the same seed. */
export function generateDungeon(seed: number, size: MapSize, levels: number[]): Dungeon {
  const rng = seededRng(seed);
  const tables = dungeonTables();
  const kind = rollOn(rng, tables.kinds);
  const purposes = tables.purposes[kind.id];
  const { ids, goal, edges } = layout(rng, size);
  const context = { levels, depth: FIXED_DEPTH, difficulty: 'moderate' as const, pool: habitat(kind.id) };
  const nodes: Record<string, DungeonNode> = {};
  for (const id of ids) {
    if (id === 'r0') nodes[id] = newRoom(rng, id, FIXED_DEPTH, 'Threshold', emptyContents(rng));
    else if (id === goal) nodes[id] = newRoom(rng, id, FIXED_DEPTH, purposes[purposes.length - 1], goalContents(rng, context));
    else nodes[id] = newRoom(rng, id, FIXED_DEPTH, pick(rng, purposes.slice(0, -1)), stockRoom(rng, context));
  }
  for (const [a, b] of edges) connect(rng, nodes, a, b);
  return addCorridors({ version: 1, mode: 'fixed', seed, kind: kind.name, levels, entrance: 'r0', goal, nodes });
}
