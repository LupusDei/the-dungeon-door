/**
 * The party in a dungeon (PR C's maps): fixed (the whole map from a seed) or explore (each area rolled as
 * it is opened). Entering a room that isn't cleared springs what is there: its monsters are met (a fight if
 * they are Hostile, play/parley.ts), its trap or hazard goes off (play/traps.ts), its treasure is loot.
 */
import { atLevel, deeper } from '../rules/depth.ts';
import type { DungeonNode, Exit, Treasure } from '../rules/dungeon.ts';
import { generateDungeon, restock } from '../rules/dungeon.ts';
import type { MapSize } from '../rules/dungeonTables.ts';
import { areaBeyond, expand, isDoor, startExplore } from '../rules/explore.ts';
import { habitat, kindIdOf } from '../rules/habitats.ts';
import { derivedRng } from '../rules/rng.ts';
import type { Attitude } from './parley.ts';
import type { DungeonState, PartyState } from './state.ts';
import { itemIdOf, stow } from './trade.ts';

/** Short adventures get small maps. */
export const mapSize = (sceneCount: number): MapSize => (sceneCount <= 4 ? 'short' : sceneCount <= 6 ? 'standard' : 'delve');

export function startDungeon(mode: 'fixed' | 'explore', seed: number, levels: number[], sceneCount: number): DungeonState {
  const map = mode === 'fixed' ? generateDungeon(seed, mapSize(sceneCount), levels) : startExplore(seed, levels);
  return { version: 1, map, at: map.entrance, visited: [map.entrance], cleared: [map.entrance] };
}

/** The dungeon level the party has reached: absent, the level its map starts at (1 on a map from before levels). */
export const dungeonLevel = (dungeon: DungeonState): number => dungeon.level ?? dungeon.map.level ?? 1;

/** In a dungeon, the heroes standing counted at its level (what a band, a trap or a fight is scaled to); outside one, the heroes' own levels. */
export function foeLevels(party: PartyState, dungeon: DungeonState | null): number[] {
  const sheets = Object.values(party.sheets);
  if (!dungeon) return sheets.map((h) => h.level);
  return atLevel(sheets.filter((h) => !h.dead).length, dungeonLevel(dungeon));
}

/** The monsters that live in the party's dungeon (none outside one: any may come). */
export const habitatOf = (dungeon: DungeonState | null) => (dungeon ? habitat(kindIdOf(dungeon.map.kind)) : undefined);

/** The level beyond this exit: through a door into an area not yet seen (a fixed map's corridor aside), a seeded chance of a level deeper. */
function levelBeyond(dungeon: DungeonState, via: Exit, to: string): number {
  const level = dungeonLevel(dungeon);
  const corridor = dungeon.map.nodes[to]?.type === 'corridor';
  if (!isDoor(via.connection) || corridor || dungeon.visited.includes(to)) return level;
  return deeper(derivedRng(dungeon.map.seed, `deeper:${to}`), level);
}

/**
 * Takes an exit from where the party is; null if there is no such exit. Through a new door the dungeon may
 * go a level deeper: the area beyond is rolled (explore mode) or restocked (a fixed map) for that level.
 */
export function enter(dungeon: DungeonState, exitId: string): { dungeon: DungeonState; node: DungeonNode } | null {
  const via = dungeon.map.nodes[dungeon.at].exits.find((x) => x.id === exitId);
  if (!via) return null;
  const to = via.to ?? areaBeyond(dungeon.at, exitId);
  const reached = levelBeyond(dungeon, via, to);
  const grown = via.to === null ? expand(dungeon.map, dungeon.at, exitId, reached) : dungeon.map;
  const node = dungeon.visited.includes(to) ? grown.nodes[to] : restock(grown, grown.nodes[to], reached);
  const map = { ...grown, nodes: { ...grown.nodes, [to]: node } };
  const visited = dungeon.visited.includes(to) ? dungeon.visited : [...dungeon.visited, to];
  return { dungeon: { ...deepenedTo(dungeon, to, Math.max(reached, node.depth)), map, at: to, visited }, node };
}

/** The dungeon at this level from here on, the change recorded; no deeper, unchanged. */
function deepenedTo(dungeon: DungeonState, at: string, level: number): DungeonState {
  if (level <= dungeonLevel(dungeon)) return dungeon;
  return { ...dungeon, level, deepened: [...(dungeon.deepened ?? []), { at, level }] };
}

export const clearRoom = (dungeon: DungeonState, id: string): DungeonState =>
  (dungeon.cleared.includes(id) ? dungeon : { ...dungeon, cleared: [...dungeon.cleared, id] });

/** The party's level for scaling traps: the average, rounded down. */
export const partyLevel = (levels: readonly number[]) => Math.floor(levels.reduce((x, y) => x + y, 0) / levels.length);

/** trap: an SRD 5.2 trap or hazard id (play/traps.ts springs it). */
export interface Arrival { fight: string[] | null; trap: string | null; treasure: Treasure | null }

const NOTHING: Arrival = { fight: null, trap: null, treasure: null };

/** What springs on the party in this area: nothing once it is cleared. */
export function arrival(dungeon: DungeonState, node: DungeonNode): Arrival {
  const contents = node.contents;
  if (!contents || dungeon.cleared.includes(node.id)) return NOTHING;
  return {
    fight: contents.encounter ? contents.encounter.monsters : null,
    trap: contents.trap,
    treasure: contents.treasure,
  };
}

/** The foes met in the room the party is in who did not attack and are still there; null if none. */
export function waitingFoes(dungeon: DungeonState): { monsters: string[]; attitude: Attitude } | null {
  const attitude = dungeon.attitudes?.[dungeon.at];
  const encounter = dungeon.map.nodes[dungeon.at].contents?.encounter;
  if (!attitude || !encounter || dungeon.cleared.includes(dungeon.at)) return null;
  return { monsters: encounter.monsters, attitude };
}

/** The foes' attitude in the room the party is in. */
export const withAttitude = (dungeon: DungeonState, attitude: Attitude): DungeonState =>
  ({ ...dungeon, attitudes: { ...dungeon.attitudes, [dungeon.at]: attitude } });

const SP_PER_GP = 10;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Coins are shared out evenly as gold; gems, jewellery and the magic item go to whoever has room. */
export function claimTreasure(party: PartyState, treasure: Treasure): { party: PartyState; lines: string[] } {
  const coin = treasure.gp + treasure.sp / SP_PER_GP;
  const ids = Object.keys(party.sheets);
  const share = coin / ids.length;
  const sheets = Object.fromEntries(ids.map((id) => [id, { ...party.sheets[id], gp: party.sheets[id].gp + share }]));
  const extras = [
    treasure.gems ? plural(treasure.gems, 'gem', 'gems') : '',
    treasure.jewellery ? plural(treasure.jewellery, 'piece of jewellery', 'pieces of jewellery') : '',
    treasure.magicItem,
  ].filter((x) => x);
  const magic = treasure.magicItem ? itemIdOf(treasure.magicItem) : null;
  const found = [...Array<string>(treasure.gems).fill('gemstone'), ...Array<string>(treasure.jewellery).fill('jewellery'), ...(magic ? [magic] : [])];
  const stowed = stow({ ...party, sheets }, found);
  return { party: stowed.party, lines: [`Treasure: ${[`${coin} gp in coin (${share} each)`, ...extras].join(', ')}.`, ...stowed.lines] };
}
