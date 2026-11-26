/**
 * Explore-as-you-go dungeons: no map up front. Each exit, when the party takes it, is rolled on the
 * original CC0 tables (extras/exploreGenerator.json) with dice derived from the seed and the new area's
 * id, so the same seed and the same choices always give the same dungeon, in any order.
 */
import { corridorContents } from './corridors.ts';
import { startingLevel } from './depth.ts';
import { type Dungeon, type DungeonNode, type Exit, newRoom, stockRoom } from './dungeon.ts';
import { type Beyond, dungeonTables, rollOn } from './dungeonTables.ts';
import { habitat, kindIdOf } from './habitats.ts';
import { type Rng, derivedRng, pick } from './rng.ts';
import { RuleViolation } from './violation.ts';

const ENTRANCE = 'e';
const MAX_ENTRANCE_EXITS = 3;

export const isDoor = (connection: string) => connection.endsWith('-door');

/** The id of the area beyond an exit once it is explored. */
export const areaBeyond = (nodeId: string, exitId: string) => `${nodeId}.${exitId}`;

function roomExits(rng: Rng, count: number): Exit[] {
  return Array.from({ length: count }, (_, i) => ({ id: `x${i + 1}`, connection: rollOn(rng, dungeonTables().connections), to: null }));
}

const purposesOf = (kind: string): string[] => dungeonTables().purposes[kindIdOf(kind)];

/** A new explore-mode dungeon: just its empty entrance room, with one to three ways on. */
export function startExplore(seed: number, levels: number[]): Dungeon {
  const rng = derivedRng(seed, ENTRANCE);
  const kind = rollOn(rng, dungeonTables().kinds).name;
  const level = startingLevel(levels);
  const entrance = newRoom(rng, ENTRANCE, level, 'Threshold', { kind: 'empty', encounter: null, trap: null, special: null, treasure: null, dressing: rollOn(rng, dungeonTables().dressing) });
  entrance.exits = roomExits(rng, rng.die(MAX_ENTRANCE_EXITS));
  return { version: 1, mode: 'explore', seed, kind, levels, entrance: ENTRANCE, goal: null, nodes: { [ENTRANCE]: entrance }, level };
}

/** Every exit not yet taken, as [area id, exit id]. */
export function unexplored(dungeon: Dungeon): [string, string][] {
  return Object.values(dungeon.nodes).flatMap((n) => n.exits.filter((x) => x.to === null).map((x): [string, string] => [n.id, x.id]));
}

const wayOn = (node: DungeonNode) => node.exits.find((x) => x.id !== 'back');

/**
 * The main line: the entrance, then each area's first way on, and so on. It never ends (no dead end, no
 * room without a way on), so an explore dungeon never closes off. It depends only on ids, not on order.
 */
function onMainLine(dungeon: Dungeon, id: string): boolean {
  let at = dungeon.entrance;
  for (const exitId of id.split('.').slice(1)) {
    if (wayOn(dungeon.nodes[at])!.id !== exitId) return false;
    at = `${at}.${exitId}`;
  }
  return true;
}

function room(rng: Rng, dungeon: Dungeon, id: string, depth: number, mainLine: boolean): DungeonNode {
  const { explore } = dungeonTables();
  const context = { levels: dungeon.levels, depth, difficulty: explore.difficulty(depth - (dungeon.level ?? 1) + 1), pool: habitat(kindIdOf(dungeon.kind)) };
  const node = newRoom(rng, id, depth, pick(rng, purposesOf(dungeon.kind).slice(0, -1)), stockRoom(rng, context));
  node.exits = roomExits(rng, Math.max(rollOn(rng, explore.roomExits), mainLine ? 1 : 0));
  return node;
}

const NOT_A_ROOM: Record<PassageResult, { type: DungeonNode['type']; name: string }> = {
  onward: { type: 'passage', name: 'Passage' },
  bend: { type: 'passage', name: 'Bend in the passage' },
  fork: { type: 'passage', name: 'Fork in the passage' },
  door: { type: 'passage', name: 'Passage ending at a door' },
  stairs: { type: 'stairs', name: 'Stairs down' },
  'dead-end': { type: 'dead-end', name: 'Dead end' },
};

function passageExit(rng: Rng, result: Beyond['result'], id: string): Exit {
  if (result === 'door') return { id, connection: pick(rng, dungeonTables().connections.rows.map((r) => r.value).filter(isDoor)), to: null };
  return { id, connection: result === 'stairs' ? 'stairs' : 'open-passage', to: null };
}

const BEHIND_A_DOOR: Record<'room' | 'onward', Beyond> = { room: { result: 'room', exits: [] }, onward: { result: 'onward', exits: ['ahead'] } };

/** What lies beyond an exit: behind a door, a room or a passage; otherwise a roll on the passage table. */
function beyond(rng: Rng, dungeon: Dungeon, id: string, depth: number, via: Exit, mainLine: boolean): DungeonNode {
  const { explore } = dungeonTables();
  const found: Beyond = isDoor(via.connection) ? BEHIND_A_DOOR[rollOn(rng, explore.behindDoor)] : rollOn(rng, explore.beyond);
  if (found.result === 'room') return room(rng, dungeon, id, depth, mainLine);
  const way = found.result === 'dead-end' && mainLine ? passage(rng, id, depth, 'onward', BEHIND_A_DOOR.onward.exits) : passage(rng, id, depth, found.result, found.exits);
  return { ...way, contents: corridorContents(derivedRng(dungeon.seed, `corridor:${id}`)) };
}

type PassageResult = Exclude<Beyond['result'], 'room'>;

function passage(rng: Rng, id: string, depth: number, result: PassageResult, exits: string[]): DungeonNode {
  const exitIds = result === 'door' ? ['door'] : exits;
  return { id, ...NOT_A_ROOM[result], depth, size: null, purpose: null, contents: null, exits: exitIds.map((x) => passageExit(rng, result, x)) };
}

/**
 * Take an exit: roll the area beyond it, at `level` (the dungeon level the party has reached; by default
 * the area it comes from), a level deeper down stairs, and return the grown dungeon (the old one is
 * untouched). Taking an exit already explored returns the dungeon as it is.
 */
export function expand(dungeon: Dungeon, nodeId: string, exitId: string, level?: number): Dungeon {
  if (!Object.hasOwn(dungeon.nodes, nodeId)) throw new RuleViolation(`there is no area ${nodeId}`);
  const from = dungeon.nodes[nodeId];
  const via = from.exits.find((x) => x.id === exitId);
  if (!via) throw new RuleViolation(`there is no exit ${exitId} from ${nodeId}`);
  if (via.to !== null) return dungeon;
  const id = areaBeyond(nodeId, exitId);
  const depth = Math.max(level ?? from.depth, from.depth) + (via.connection === 'stairs' ? 1 : 0);
  const mainLine = onMainLine(dungeon, nodeId) && wayOn(from) === via;
  const child = beyond(derivedRng(dungeon.seed, id), dungeon, id, depth, via, mainLine);
  child.exits.unshift({ id: 'back', connection: via.connection, to: nodeId });
  const opened = { ...from, exits: from.exits.map((x) => (x === via ? { ...x, to: id } : x)) };
  return { ...dungeon, nodes: { ...dungeon.nodes, [nodeId]: opened, [id]: child } };
}
