/**
 * Light and sight (SRD 5.2): light sources from the gear list, darkvision from species traits, and what a
 * creature sees in bright light, dim light or darkness. The game has no grid, so a light either fills the
 * area the party is in or it doesn't; the radii are kept for the narration. The adventure's clock counts
 * seconds from 8 in the morning of day 1 (an original convention, CC0).
 */
import type { Dungeon } from './dungeon.ts';
import type { Monster } from './monsters.ts';
import { held, removeItem } from './inventory.ts';
import { derivedRng } from './rng.ts';
import type { CharacterSheet } from './sheet.ts';

export type LightLevel = 'bright' | 'dim' | 'dark';
/** clear: sees normally. dim: Lightly Obscured (Disadvantage on Perception). none: effectively Blinded. */
export type Sight = 'clear' | 'dim' | 'none';
export type LightSource = 'light-spell' | 'lantern-hooded' | 'lantern-bullseye' | 'lamp' | 'torch' | 'candle';

export interface Light {
  name: string;
  /** Seconds it burns (a torch, a candle, a flask of oil, the spell's duration). */
  burns: number;
  bright: number; dim: number;
  /** The item the hero must hold to use it (a lamp or lantern), if any. */
  holds: string | null;
  /** The item lighting it uses up (the torch, the candle, a flask of oil), if any. */
  uses: string | null;
}

const HOUR = 3600;
const OIL_HOURS = 6;
export const LIGHTS: Readonly<Record<LightSource, Light>> = {
  'light-spell': { name: 'Light', burns: HOUR, bright: 20, dim: 20, holds: null, uses: null },
  'lantern-hooded': { name: 'Hooded Lantern', burns: OIL_HOURS * HOUR, bright: 30, dim: 30, holds: 'lantern-hooded', uses: 'oil' },
  'lantern-bullseye': { name: 'Bullseye Lantern', burns: OIL_HOURS * HOUR, bright: 60, dim: 60, holds: 'lantern-bullseye', uses: 'oil' },
  lamp: { name: 'Lamp', burns: OIL_HOURS * HOUR, bright: 15, dim: 30, holds: 'lamp', uses: 'oil' },
  torch: { name: 'Torch', burns: HOUR, bright: 20, dim: 20, holds: null, uses: 'torch' },
  candle: { name: 'Candle', burns: HOUR, bright: 5, dim: 5, holds: null, uses: 'candle' },
};
const PREFERENCE = Object.keys(LIGHTS) as LightSource[];

function canLight(sheet: CharacterSheet, source: LightSource): boolean {
  if (source === 'light-spell') return !!sheet.spellcasting?.cantrips.includes('light');
  const { holds, uses } = LIGHTS[source];
  return (holds === null || held(sheet, holds) > 0) && held(sheet, uses!) > 0;
}

/** The best light the hero can make now, or null. */
export const bestLight = (sheet: CharacterSheet): LightSource | null => PREFERENCE.find((s) => canLight(sheet, s)) ?? null;

/** The hero lights it: the torch, candle or flask of oil is used up. */
export function kindle(sheet: CharacterSheet, source: LightSource): CharacterSheet {
  const { uses } = LIGHTS[source];
  return uses === null ? sheet : removeItem(sheet, uses);
}

/** Feet of darkvision from the species (darkvision-60, darkvision-120); 0 without. */
export function darkvision(sheet: CharacterSheet): number {
  const trait = sheet.traits.find((t) => t.startsWith('darkvision-'));
  return trait ? Number(trait.slice('darkvision-'.length)) : 0;
}

const DARKVISION_SIGHT: Readonly<Record<LightLevel, Sight>> = { bright: 'clear', dim: 'clear', dark: 'dim' };
const PLAIN_SIGHT: Readonly<Record<LightLevel, Sight>> = { bright: 'clear', dim: 'dim', dark: 'none' };

/** 5.2: darkvision sees dim light as bright and darkness as dim light. */
export const seeingIn = (level: LightLevel, darkvisionFeet: number): Sight => (darkvisionFeet > 0 ? DARKVISION_SIGHT : PLAIN_SIGHT)[level];

export const sightOf = (sheet: CharacterSheet, level: LightLevel): Sight => seeingIn(level, darkvision(sheet));

/** A monster sees by blindsight or truesight in any light, otherwise by darkvision or plain sight. */
export const monsterSight = (m: Pick<Monster, 'senses'>, level: LightLevel): Sight =>
  (m.senses.blindsight > 0 || m.senses.truesight > 0 ? 'clear' : seeingIn(level, m.senses.darkvision));

const START_HOUR = 8;
const DAY = 24;
const two = (n: number) => String(n).padStart(2, '0');

/** "Day 1, 08:40": the clock, `seconds` after 8 in the morning of day 1. */
export function clockLabel(seconds: number): string {
  const minutes = Math.floor(seconds / 60) + START_HOUR * 60;
  const hours = Math.floor(minutes / 60);
  return `Day ${Math.floor(hours / DAY) + 1}, ${two(hours % DAY)}:${two(minutes % 60)}`;
}

const DAWN = 6;
const DUSK = 19;
/** Outdoors (5.2): daylight is bright, twilight dim, night dark, even most moonlit nights. */
export function outdoorLight(seconds: number): LightLevel {
  const hour = (Math.floor(seconds / HOUR) + START_HOUR) % DAY;
  if (hour >= DAWN && hour < DUSK) return 'bright';
  return hour === DAWN - 1 || hour === DUSK ? 'dim' : 'dark';
}

const ROOM_LIGHT: readonly LightLevel[] = ['bright', 'dim', 'dark', 'dark', 'dark', 'dark'];
/**
 * A dungeon area's own light (original table, CC0): the entrance is dim (daylight through the way in);
 * a room rolls d6 (1 lit by fire or daylight, 2 dim with fungus glow or a far light, 3-6 dark); passages,
 * stairs and dead ends are dark. Rolled from the seed and the area's id, so any map, old or new, has it.
 */
export function areaLight(map: Dungeon, id: string): LightLevel {
  if (id === map.entrance) return 'dim';
  if (map.nodes[id].type !== 'room') return 'dark';
  return ROOM_LIGHT[derivedRng(map.seed, `light:${id}`).die(ROOM_LIGHT.length) - 1];
}
