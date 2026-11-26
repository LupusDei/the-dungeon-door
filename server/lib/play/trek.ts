/**
 * The trek (Robert, 2026-11-26): from the tavern to the dungeon door the party crosses open country in two
 * stretches of road, a scene each. What each stretch holds is rolled on a d12 when the game starts (seeded
 * by the map): 1–3 bandits, 4–6 varmints (beasts), 7–8 a band of surface monsters, 9–10 a wandering vendor,
 * 11–12 a quiet stretch. Foes are a low SRD 5.2 encounter for the dungeon's starting level, as wandering
 * monsters are; they roll an attitude when met, and Hostile ones bar the way (Engage, Run or Parley).
 * Bandits and monster bands carry the treasure of a room at that level; beasts carry none. A vendor sells
 * a Potion of Healing and some SRD gear at SRD prices. See docs/rules-design.md, "The road".
 */
import { rollTreasure, type Treasure } from '../rules/dungeon.ts';
import { buildEncounter } from '../rules/encounter.ts';
import { items } from '../rules/items.ts';
import { derivedRng, pick, type Rng, sample, seededRng } from '../rules/rng.ts';
import { foesNamed } from './hooks.ts';
import { rollAttitude } from './parley.ts';
import type { DungeonState, PartyState } from './state.ts';

export const TREK_SCENES = 2;

export type TrekEvent = 'bandits' | 'varmints' | 'band' | 'vendor' | 'quiet';
/** roll: the d12 on the road table; wares: SRD item ids a vendor sells. */
export interface TrekLeg { event: TrekEvent; roll: number; monsters: string[]; treasure: Treasure | null; wares: string[] }
/** leg: the stretch the party is on (0 first). */
export interface Trek { terrain: string; leg: number; legs: TrekLeg[] }

const ROAD_TABLE: readonly [number, TrekEvent][] = [[3, 'bandits'], [6, 'varmints'], [8, 'band'], [10, 'vendor'], [12, 'quiet']];
export const eventFor = (d12: number): TrekEvent => ROAD_TABLE.find(([upTo]) => d12 <= upTo)![1];

/** SRD 5.2 creatures of the open road; the encounter budget keeps the tougher ones (a Bandit Captain, a Giant Boar) for stronger parties. */
export const ROAD_POOLS: Readonly<Record<'bandits' | 'varmints' | 'band', readonly string[]>> = {
  bandits: ['bandit', 'scout', 'tough', 'bandit-captain'],
  varmints: ['giant-rat', 'giant-weasel', 'jackal', 'hyena', 'wolf', 'boar', 'giant-badger', 'giant-wolf-spider', 'constrictor-snake', 'swarm-of-rats', 'black-bear', 'dire-wolf', 'brown-bear', 'giant-boar'],
  band: ['goblin-minion', 'goblin-warrior', 'goblin-boss', 'hobgoblin-warrior', 'gnoll-warrior', 'worg', 'bugbear-warrior'],
};
export const ROAD_MONSTERS: readonly string[] = [...ROAD_POOLS.bandits, ...ROAD_POOLS.varmints, ...ROAD_POOLS.band];

const TERRAINS = ['a rutted cart road through farmland and hedgerows', 'a forest road under old oaks', 'a moorland track in the wind',
  'hill trails over broken ground', 'a river valley path by the ford'];
const WARES = 4;
const VENDOR_PRICE_LIMIT = 25;
const goods = () => [...items().values()].filter((i) => i.kind === 'gear' && i.cost > 0 && i.cost <= VENDOR_PRICE_LIMIT && i.id !== 'potion-of-healing').map((i) => i.id);

/** One stretch of road holding `event`: its foes (and their treasure) or a vendor's wares. */
export function legOf(rng: Rng, event: TrekEvent, roll: number, levels: readonly number[], level: number): TrekLeg {
  const none: TrekLeg = { event, roll, monsters: [], treasure: null, wares: [] };
  if (event === 'vendor') return { ...none, wares: ['potion-of-healing', ...sample(rng, goods(), WARES)] };
  if (event === 'quiet' || levels.length === 0) return none; // no living hero to meet them: an empty road
  const { monsters } = buildEncounter(rng, levels, 'low', ROAD_POOLS[event]);
  return { ...none, monsters, treasure: event === 'varmints' ? null : rollTreasure(rng, level) };
}

/** The road from the tavern to the door, rolled when the game starts, for the party's levels and the dungeon's starting level. */
export function planTrek(seed: number, levels: readonly number[], level: number): Trek {
  const rng = derivedRng(seed, 'trek');
  const terrain = pick(rng, TERRAINS);
  const legs = Array.from({ length: TREK_SCENES }, () => {
    const roll = rng.die(12);
    return legOf(rng, eventFor(roll), roll, levels, level);
  });
  return { terrain, leg: 0, legs };
}

const price = (id: string) => `${items().get(id)!.name} (${items().get(id)!.cost} gp)`;
/** What is on a stretch, in words. */
export const ROAD_EVENTS: Readonly<Record<TrekEvent, string>> = {
  bandits: 'bandits', varmints: 'wild beasts', band: 'a band of monsters', vendor: 'a wandering vendor', quiet: 'a quiet stretch',
};
const told = (leg: TrekLeg) => (leg.event === 'vendor' ? `${ROAD_EVENTS.vendor}, selling ${leg.wares.map(price).join(', ')}` : ROAD_EVENTS[leg.event]);

/** The stretch the party has come to: its foes are met (they roll an attitude and wait, Hostile ones barring the way), or what else is there is told. */
export function meetOnTheRoad(party: PartyState, dungeon: DungeonState): { party: PartyState; dungeon: DungeonState; lines: string[] } {
  const leg = dungeon.trek!.legs[dungeon.trek!.leg];
  const head = `On the road (d12: ${leg.roll}): ${told(leg)}.`;
  if (!leg.monsters.length) return { party, dungeon, lines: [head] };
  const rng = seededRng(party.rng);
  const met = rollAttitude(rng, leg.monsters);
  const stance = met.attitude === 'hostile' ? 'They bar the way.' : 'They watch and wait.';
  return {
    party: { ...party, rng: rng.state() },
    dungeon: { ...dungeon, facing: { monsters: [...leg.monsters], attitude: met.attitude } },
    lines: [`${head} ${foesNamed(leg.monsters)}: ${met.attitude}${met.roll === null ? '' : ` (2d6: ${met.roll})`}. ${stance}`],
  };
}
