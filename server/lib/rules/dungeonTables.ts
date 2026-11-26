/**
 * The dungeon tables: the CC0 map procedure (extras/dungeonGenerator.json), the CC0 explore-as-you-go
 * procedure (extras/exploreGenerator.json) and OSE stocking (extras/oseDungeonStocking.json, CC-BY-4.0),
 * checked once where they enter and turned into roll tables.
 */
import { z } from 'zod';
import mapJson from '../../data/srd/extras/dungeonGenerator.json' with { type: 'json' };
import exploreJson from '../../data/srd/extras/exploreGenerator.json' with { type: 'json' };
import oseJson from '../../data/srd/extras/oseDungeonStocking.json' with { type: 'json' };
import type { Difficulty } from './monsters.ts';
import type { Rng } from './rng.ts';
import { once, parseTable } from './srd.ts';

export interface RollTable<T> { sides: number; rows: { min: number; max: number; value: T }[] }
export type RowSpec<T> = ({ roll: number | number[] } | { min: number; max: number }) & { value: T };
export type MapSize = 'short' | 'standard' | 'delve';
export type StockKind = 'empty' | 'monster' | 'special' | 'trap';
/** "50%: 1d6 x 10 gp" → { chance: 50, dice: '1d6', multiplier: 10 }. */
export interface Amount { chance: number; dice: string; multiplier: number }
export interface TreasureBand { levels: number[]; silver: Amount; gold: Amount; gems: Amount; jewellery: Amount; magicItem: Amount }
export type Beyond = { result: 'onward' | 'door' | 'fork' | 'bend' | 'room' | 'stairs' | 'dead-end'; exits: string[] };

export interface DungeonTables {
  sizes: Record<MapSize, { rooms: number; path: number; branches: number; loops: number }>;
  kinds: RollTable<{ id: string; name: string }>;
  connections: RollTable<string>;
  roomSizes: RollTable<{ id: string; name: string; feet: string }>;
  purposes: Record<string, string[]>;
  traps: RollTable<string>;
  dressing: RollTable<string>;
  contents: RollTable<{ kind: StockKind; treasureIn6: number }>;
  specials: string[];
  treasure: TreasureBand[];
  explore: {
    beyond: RollTable<Beyond>;
    behindDoor: RollTable<'room' | 'onward'>;
    roomExits: RollTable<number>;
    difficulty: (depth: number) => Difficulty;
  };
}

const span = <T>(row: RowSpec<T>) => {
  if ('min' in row) return { min: row.min, max: row.max };
  const faces = Array.isArray(row.roll) ? row.roll : [row.roll];
  return { min: faces[0], max: faces[faces.length - 1] };
};

/** A table for a d`sides`; its rows must cover 1..sides once, in order. */
export function rollTable<T>(sides: number, specs: readonly RowSpec<T>[]): RollTable<T> {
  const rows = specs.map((s) => ({ ...span(s), value: s.value }));
  let next = 1;
  for (const row of rows) {
    if (row.min !== next) throw new Error(`rows must cover 1 to ${sides} in order; ${next} is missing`);
    if (row.max > sides) throw new Error(`a d${sides} has no ${row.max}`);
    next = row.max + 1;
  }
  if (next !== sides + 1) throw new Error(`rows must cover 1 to ${sides} in order; ${next} is missing`);
  return { sides, rows };
}

export function rollOn<T>(rng: Rng, table: RollTable<T>): T {
  const face = rng.die(table.sides);
  return table.rows.find((r) => face >= r.min && face <= r.max)!.value;
}

const roll = z.union([z.number(), z.array(z.number())]);
const range = z.object({ min: z.number(), max: z.number() });
const sides = z.string().transform((d) => Number(d.split('d')[1]));
const AMOUNT = /^(?:(\d+)%: )?(\d+d\d+|\d+)(?: x ([\d,]+))?/;
const amount = z.string().transform((text): Amount => {
  const [, chance, dice, times] = AMOUNT.exec(text)!;
  return { chance: Number(chance ?? 100), dice, multiplier: Number((times ?? '1').replaceAll(',', '')) };
});

const mapSchema = z.object({
  sizes: z.array(z.object({ index: z.enum(['short', 'standard', 'delve']), rooms: z.number(), pathRoomsBetweenEntranceAndGoal: z.number(), branchRooms: z.number(), extraLoops: z.number() })),
  dungeonKinds: z.object({ dice: sides, rows: z.array(z.object({ roll, index: z.string(), name: z.string() })) }),
  connectionTypes: z.object({ dice: sides, rows: z.array(z.object({ roll, index: z.string() })) }),
  roomSizes: z.object({ dice: sides, rows: z.array(z.object({ roll, index: z.string(), name: z.string(), approxFeet: z.string() })) }),
  roomPurposes: z.object({ byKind: z.record(z.string(), z.array(z.string())) }),
  trapsAndHazards: z.object({ dice: sides, rows: z.array(z.object({ roll, index: z.string() })) }),
  dressing: z.object({ dice: sides, rows: z.array(z.object({ roll, tag: z.string() })) }),
});
const oseSchema = z.object({
  dice: sides,
  roomContents: z.array(z.object({ roll, contents: z.enum(['empty', 'monster', 'special', 'trap']), chanceOfTreasure: z.string() })),
  exampleSpecials: z.array(z.object({ name: z.string() })),
  treasureInEmptyOrTrappedRooms: z.array(z.object({ levels: z.array(z.number()), silver: amount, gold: amount, gems: amount, jewellery: amount, magicItem: amount })),
});
const exploreSchema = z.object({
  beyondAnExit: z.object({ dice: sides, rows: z.array(range.extend({ result: z.enum(['onward', 'door', 'fork', 'bend', 'room', 'stairs', 'dead-end']), exits: z.array(z.string()).default([]) })) }),
  behindADoor: z.object({ dice: sides, rows: z.array(range.extend({ result: z.enum(['room', 'onward']) })) }),
  roomExits: z.object({ dice: sides, rows: z.array(range.extend({ count: z.number() })) }),
  difficultyByDepth: z.array(z.object({ depth: z.number(), difficulty: z.enum(['low', 'moderate', 'high']) })),
});

const inSix = (text: string) => (text === 'none' ? 0 : Number(text.split('-')[0]));

function load(): DungeonTables {
  const [map] = parseTable('dungeonGenerator', mapSchema, mapJson);
  const [ose] = parseTable('oseDungeonStocking', oseSchema, oseJson);
  const [explore] = parseTable('exploreGenerator', exploreSchema, exploreJson);
  const deepest = explore.difficultyByDepth.at(-1)!.difficulty;
  return {
    sizes: Object.fromEntries(map.sizes.map((s) => [s.index, { rooms: s.rooms, path: s.pathRoomsBetweenEntranceAndGoal, branches: s.branchRooms, loops: s.extraLoops }])) as DungeonTables['sizes'],
    kinds: rollTable(map.dungeonKinds.dice, map.dungeonKinds.rows.map((r) => ({ roll: r.roll, value: { id: r.index, name: r.name } }))),
    connections: rollTable(map.connectionTypes.dice, map.connectionTypes.rows.map((r) => ({ roll: r.roll, value: r.index }))),
    roomSizes: rollTable(map.roomSizes.dice, map.roomSizes.rows.map((r) => ({ roll: r.roll, value: { id: r.index, name: r.name, feet: r.approxFeet } }))),
    purposes: map.roomPurposes.byKind,
    traps: rollTable(map.trapsAndHazards.dice, map.trapsAndHazards.rows.map((r) => ({ roll: r.roll, value: r.index }))),
    dressing: rollTable(map.dressing.dice, map.dressing.rows.map((r) => ({ roll: r.roll, value: r.tag }))),
    contents: rollTable(ose.dice, ose.roomContents.map((r) => ({ roll: r.roll, value: { kind: r.contents, treasureIn6: inSix(r.chanceOfTreasure) } }))),
    specials: ose.exampleSpecials.map((s) => s.name),
    treasure: ose.treasureInEmptyOrTrappedRooms,
    explore: {
      beyond: rollTable(explore.beyondAnExit.dice, explore.beyondAnExit.rows.map((r) => ({ ...r, value: { result: r.result, exits: r.exits } }))),
      behindDoor: rollTable(explore.behindADoor.dice, explore.behindADoor.rows.map((r) => ({ ...r, value: r.result }))),
      roomExits: rollTable(explore.roomExits.dice, explore.roomExits.rows.map((r) => ({ ...r, value: r.count }))),
      difficulty: (depth) => explore.difficultyByDepth.find((d) => d.depth === depth)?.difficulty ?? deepest,
    },
  };
}

export const dungeonTables: () => DungeonTables = once(load);
