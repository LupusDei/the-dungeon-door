/**
 * Corridors between the rooms of a fixed map (original tables, CC0). They are areas, not rooms: a 5, 7 or 9
 * room map keeps its rooms, and some of the ways between them become passages, winding passages, junctions
 * or short stairs. A corridor holds no encounter and no treasure, but it may hold a trap or hazard from the
 * dungeon table, or a wandering monster's spoor. Rolled with dice derived from the seed and the two rooms,
 * so the rooms come out exactly as they would without corridors, and the same seed gives the same map.
 */
import type { Dungeon, DungeonNode, RoomContents } from './dungeon.ts';
import { dungeonTables, rollOn, rollTable } from './dungeonTables.ts';
import { derivedRng, type Rng } from './rng.ts';

/** d12: null, the rooms open straight onto each other; otherwise the corridor between them. */
export const CORRIDORS = rollTable<string | null>(12, [
  { min: 1, max: 4, value: null },
  { min: 5, max: 8, value: 'Passage' },
  { min: 9, max: 10, value: 'Winding passage' },
  { roll: 11, value: 'Junction (side passages lead off into the dark)' },
  { roll: 12, value: 'Short stair' },
]);

/** d20: what lies in a corridor. Spoor makes wandering monsters likelier there. */
export const CORRIDOR_CONTENTS = rollTable<'empty' | 'trap' | 'spoor'>(20, [
  { min: 1, max: 13, value: 'empty' }, { min: 14, max: 17, value: 'trap' }, { min: 18, max: 20, value: 'spoor' },
]);

export function corridorContents(rng: Rng): RoomContents {
  const tables = dungeonTables();
  const found = rollOn(rng, CORRIDOR_CONTENTS);
  const trap = found === 'trap' ? rollOn(rng, tables.traps) : null;
  return {
    kind: trap ? 'trap' : 'empty', encounter: null, trap, special: found === 'spoor' ? 'spoor' : null, treasure: null,
    dressing: rollOn(rng, tables.dressing),
  };
}

function corridor(map: Dungeon, a: string, b: string): DungeonNode | null {
  const rng = derivedRng(map.seed, `corridor:${a}-${b}`);
  const name = rollOn(rng, CORRIDORS);
  if (name === null) return null;
  const connection = map.nodes[a].exits.find((x) => x.id === b)!.connection;
  return {
    id: `${a}-${b}`, type: 'corridor', name, depth: map.nodes[a].depth, size: null, purpose: null,
    contents: corridorContents(rng), exits: [{ id: a, connection, to: a }, { id: b, connection, to: b }],
  };
}

const leadVia = (node: DungeonNode, to: string, via: string): DungeonNode =>
  ({ ...node, exits: node.exits.map((x) => (x.id === to ? { ...x, to: via } : x)) });

/** Puts the rolled corridors between linked rooms; each pair once, in the order their ways were made. */
export function addCorridors(map: Dungeon): Dungeon {
  const nodes = { ...map.nodes };
  const ids = Object.keys(map.nodes);
  for (const a of ids) for (const exit of map.nodes[a].exits) {
    if (ids.indexOf(exit.id) < ids.indexOf(a)) continue;
    const c = corridor(map, a, exit.id);
    if (!c) continue;
    nodes[c.id] = c;
    nodes[a] = leadVia(nodes[a], exit.id, c.id);
    nodes[exit.id] = leadVia(nodes[exit.id], a, c.id);
  }
  return { ...map, nodes };
}
