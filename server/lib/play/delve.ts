/**
 * The party in a dungeon (PR C's maps): fixed (the whole map from a seed) or explore (each area rolled as
 * it is opened). Entering a room that isn't cleared springs what is there: its monsters are a fight, its
 * trap or hazard goes off (play/traps.ts), its treasure is loot.
 */
import type { DungeonNode, Treasure } from '../rules/dungeon.ts';
import { generateDungeon } from '../rules/dungeon.ts';
import type { MapSize } from '../rules/dungeonTables.ts';
import { expand, startExplore } from '../rules/explore.ts';
import type { DungeonState, PartyState } from './state.ts';
import { itemIdOf, stow } from './trade.ts';

/** Short adventures get small maps. */
export const mapSize = (sceneCount: number): MapSize => (sceneCount <= 4 ? 'short' : sceneCount <= 6 ? 'standard' : 'delve');

export function startDungeon(mode: 'fixed' | 'explore', seed: number, levels: number[], sceneCount: number): DungeonState {
  const map = mode === 'fixed' ? generateDungeon(seed, mapSize(sceneCount), levels) : startExplore(seed, levels);
  return { version: 1, map, at: map.entrance, visited: [map.entrance], cleared: [map.entrance] };
}

/** Takes an exit from where the party is (rolling the area beyond in explore mode); null if there is no such exit. */
export function enter(dungeon: DungeonState, exitId: string): { dungeon: DungeonState; node: DungeonNode } | null {
  const via = dungeon.map.nodes[dungeon.at].exits.find((x) => x.id === exitId);
  if (!via) return null;
  const map = via.to === null ? expand(dungeon.map, dungeon.at, exitId) : dungeon.map;
  const to = map.nodes[dungeon.at].exits.find((x) => x.id === exitId)!.to!;
  const visited = dungeon.visited.includes(to) ? dungeon.visited : [...dungeon.visited, to];
  return { dungeon: { ...dungeon, map, at: to, visited }, node: map.nodes[to] };
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
