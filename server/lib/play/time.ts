/**
 * The adventure's clock and the party's light (SRD 5.2 light sources; the time each choice takes is an
 * original convention, CC0, in turn.ts). One light at a time fills the area for the whole party: the game
 * has no grid. When the place is not bright and nothing burns, the standing hero with the best light
 * lights it; when it burns out the next is lit, until the party has none left.
 */
import { areaLight, bestLight, kindle, type LightLevel, LIGHTS, type LightSource, outdoorLight } from '../rules/light.ts';
import type { CharacterSheet } from '../rules/sheet.ts';
import type { RulesHook } from './hooks.ts';
import type { PartyState } from './state.ts';
import type { RulesState } from './turn.ts';

export interface Lit { source: LightSource; holder: string; left: number }
export interface Timed { party: PartyState; lines: string[] }

const HOUR = 3600;
const ORDER = Object.keys(LIGHTS) as LightSource[];
const standing = (s: CharacterSheet) => s.hp > 0 && !s.dead;

export const clockOf = (party: PartyState): number => party.clock ?? 0;

/** The place's own light: the dungeon area's, or daylight by the clock outside one. */
export const ambientLight = (s: RulesState): LightLevel =>
  (s.dungeon ? areaLight(s.dungeon.map, s.dungeon.at) : outdoorLight(clockOf(s.party)));

/** What the party has to see by: bright where its light burns, otherwise the place's own light. */
export const lightLevel = (s: RulesState): LightLevel => (s.party.lit ? 'bright' : ambientLight(s));

const hours = (seconds: number) => `${seconds / HOUR} hour${seconds === HOUR ? '' : 's'}`;
const verb = (source: LightSource) => (source === 'light-spell' ? 'casts' : 'lights a');

/** Where it is not bright and nothing burns, the standing hero with the best light lights it. */
export function lightUp(party: PartyState, ambient: LightLevel): Timed {
  if (ambient === 'bright' || party.lit) return { party, lines: [] };
  const offers = Object.entries(party.sheets).filter(([, s]) => standing(s)).map(([id, s]) => ({ id, source: bestLight(s) }))
    .filter((o): o is { id: string; source: LightSource } => o.source !== null);
  if (offers.length === 0) return { party, lines: [] };
  const { id, source } = offers.reduce((best, o) => (ORDER.indexOf(o.source) < ORDER.indexOf(best.source) ? o : best));
  const light = LIGHTS[source];
  const sheets = { ...party.sheets, [id]: kindle(party.sheets[id], source) };
  return { party: { ...party, sheets, lit: { source, holder: id, left: light.burns } }, lines: [`${party.sheets[id].name} ${verb(source)} ${light.name} (${hours(light.burns)}).`] };
}

/** Time passes: the clock moves on and the light burns down, the next one lit as each goes out. */
export function passTime(party: PartyState, seconds: number, ambient: LightLevel): Timed {
  let now: PartyState = { ...party, clock: clockOf(party) + seconds };
  const lines: string[] = [];
  let remaining = seconds;
  while (now.lit && remaining > 0) {
    const burn = Math.min(now.lit.left, remaining);
    remaining -= burn;
    if (burn < now.lit.left) { now = { ...now, lit: { ...now.lit, left: now.lit.left - burn } }; break; }
    lines.push(`${now.sheets[now.lit.holder].name}'s ${LIGHTS[now.lit.source].name} ${now.lit.source === 'light-spell' ? 'ends' : 'burns out'}.`);
    const next = lightUp({ ...now, lit: null }, ambient);
    now = next.party;
    lines.push(...next.lines);
    if (!now.lit && ambient !== 'bright') lines.push('The party has no light left.');
  }
  return { party: now, lines };
}

const MINUTE = 60;
const DAY = 24 * HOUR;
const TURN = 10 * MINUTE;
const LONG_REST = 8 * HOUR;

function hazardSeconds(h: Extract<RulesHook, { kind: 'hazard' }>): number {
  if (h.hazard === 'dehydration') return DAY;
  return (h.days ?? 0) * DAY + (h.hours ?? 0) * HOUR + (h.minutes ?? 0) * MINUTE || TURN;
}

/**
 * How long a turn of play takes (original, CC0): ten minutes for a story choice, a check, a move to the next
 * area, a trap, a parley or a potion; an hour to buy, sell or have the dead raised (5.2: Raise Dead's casting
 * time); a rest its own length; a hazard as long as it lasts. A fight counts its 6-second rounds instead.
 */
export function secondsFor(hook: RulesHook | null): number {
  if (hook?.kind === 'rest') return hook.rest === 'long' ? LONG_REST : HOUR;
  if (hook?.kind === 'hazard') return hazardSeconds(hook);
  return hook ? (FIXED_SECONDS[hook.kind] ?? TURN) : TURN;
}
const FIXED_SECONDS: Partial<Record<RulesHook['kind'], number>> = { fight: 0, buy: HOUR, sell: HOUR, revive: HOUR };
