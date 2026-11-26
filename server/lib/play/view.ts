/**
 * What the rules engine shows: the API's RulesView (docs/api.md) and the DM's RulesContext
 * (docs/dungeon-master.md). Plain projections of the stored state.
 */
import { passiveScore } from '../rules/checks.ts';
import { conditionsOf, type TimedCondition } from '../rules/conditions.ts';
import { heroResistances } from '../rules/defenses.ts';
import { load } from '../rules/inventory.ts';
import { clockLabel, darkvision, type LightLevel, LIGHTS, type Sight, sightOf } from '../rules/light.ts';
import { candidates, temperedBudget } from '../rules/encounter.ts';
import { resourcesOf } from '../rules/resources.ts';
import type { CharacterSheet } from '../rules/sheet.ts';
import { srd } from '../rules/srd.ts';
import { dungeonLevel, foeLevels, habitatOf, waitingFoes } from './delve.ts';
import { foesNamed } from './hooks.ts';
import type { Attitude } from './parley.ts';
import type { DungeonState } from './state.ts';
import { clockOf, lightLevel } from './time.ts';
import type { RulesState } from './turn.ts';

export interface Waiting { foes: string; attitude: Attitude }
function waiting(dungeon: DungeonState): Waiting | null {
  const here = waitingFoes(dungeon);
  return here && { foes: foesNamed(here.monsters), attitude: here.attitude };
}

const NO_SLOTS = [0, 0, 0, 0, 0, 0, 0, 0, 0];
const slotsLeft = (s: CharacterSheet) => (s.spellcasting ? s.spellcasting.slots.map((n, i) => n - s.spellcasting!.expended[i]) : NO_SLOTS);

export interface HeroView {
  playerId: string; name: string; level: number; xp: number; hp: number; maxHp: number; armorClass: number;
  exhaustion: number; hitDiceLeft: number; slotsLeft: number[];
  resources: { id: string; name: string; left: number; max: number }[]; down: boolean;
  /** Slain: stays dead until revived. */
  dead: boolean;
  passivePerception: number; passiveInsight: number;
  gp: number; inventory: { id: string; name: string; count: number }[];
  /** Pounds carried and the 5.2 carrying capacity; over it the hero is dragging (Speed 5 ft), up to dragLimit. */
  carried: number; capacity: number; dragLimit: number; dragging: boolean;
  /** How the hero sees here: clear, dim (Disadvantage on Perception) or none (effectively Blinded); feet of darkvision. */
  sight: Sight; darkvision: number;
  /** Damage types the hero resists (species traits). */
  resistances: string[];
  /** Conditions carried outside a fight, each with how it ends: "1 hour", "until a long rest", "DC 10 Athletics to break free". */
  conditions: { condition: string; ends: string }[];
  /** The spell the hero holds by concentration ("Bless"), or null. */
  concentratingOn: string | null;
}

const WHEN: { [K in TimedCondition['until']['kind']]: (u: Extract<TimedCondition['until'], { kind: K }>) => string } = {
  time: (u) => (u.left >= 3600 ? `${Math.ceil(u.left / 360) / 10} hours` : `${Math.ceil(u.left / 60)} minutes`),
  'long-rest': () => 'until a long rest',
  save: (u) => `DC ${u.dc} ${u.ability.toUpperCase()} save to end`,
  escape: (u) => `DC ${u.dc} ${u.skill.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')} to break free`,
};
const ends = (c: TimedCondition) => (WHEN[c.until.kind] as (u: TimedCondition['until']) => string)(c.until);
const conditionViews = (s: CharacterSheet) => conditionsOf(s).map((c) => ({ condition: c.condition, ends: ends(c) }));
/** "poisoned (1 hours), restrained (DC 10 Athletics to break free)". */
const conditionsLine = (s: CharacterSheet) => conditionViews(s).map((c) => `${c.condition} (${c.ends})`).join(', ');

/** The party's light: what it is, who carries it, minutes left; null when nothing burns. */
export interface LitView { name: string; holder: string; minutesLeft: number }
function litView(s: RulesState): LitView | null {
  const lit = s.party.lit;
  return lit ? { name: LIGHTS[lit.source].name, holder: s.party.sheets[lit.holder].name, minutesLeft: Math.ceil(lit.left / 60) } : null;
}

export interface RulesView {
  party: HeroView[];
  combat: null | {
    round: number; outcome: 'ongoing' | 'victory' | 'defeat';
    combatants: { id: string; name: string; side: 'party' | 'foes'; hp: number; maxHp: number; status: string; conditions: string[] }[];
  };
  dungeon: null | {
    mode: 'fixed' | 'explore'; kind: string; at: string;
    /** The dungeon level the party has reached (Phase 5), and where it went deeper, oldest first. */
    level: number; deepened: { at: string; level: number }[];
    areas: { id: string; name: string; purpose: string | null; cleared: boolean; exits: { id: string; connection: string; to: string | null }[] }[];
    /** Foes in this area who did not attack: "Boar ×3" and their attitude. */
    waiting: Waiting | null;
  };
  results: string[];
  /** Who levelled up at the quest's end (empty until then). */
  levelUps: { playerId: string; name: string; from: number; to: number }[];
  /** Seconds since the adventure began, and the clock ("Day 1, 08:40"). */
  time: { seconds: number; label: string };
  /** What the party sees by here: the light level and the light it carries. */
  light: { level: LightLevel; source: LitView | null };
}

const heroView = (playerId: string, s: CharacterSheet, light: LightLevel): HeroView => ({
  playerId, name: s.name, level: s.level, xp: s.xp, hp: s.hp, maxHp: s.maxHp, armorClass: s.armorClass,
  exhaustion: s.exhaustion, hitDiceLeft: s.level - s.hitDiceSpent, slotsLeft: slotsLeft(s),
  resources: resourcesOf(s).map(({ id, name, left, max }) => ({ id, name, left, max })), down: s.hp === 0, dead: s.dead === true,
  ...passives(s), gp: s.gp, inventory: s.equipment.map(({ id, name, count }) => ({ id, name, count })),
  ...load(s), sight: sightOf(s, light), darkvision: darkvision(s), resistances: heroResistances(s), conditions: conditionViews(s),
  concentratingOn: held(s),
});

const held = (s: CharacterSheet) => {
  const id = s.spellcasting?.concentratingOn;
  return id ? srd().spells.get(id)!.name : null;
};

const passives = (s: CharacterSheet) => ({
  passivePerception: passiveScore(s, { ability: 'wis', skill: 'perception' }), passiveInsight: passiveScore(s, { ability: 'wis', skill: 'insight' }),
});
/** "Potion of Healing ×2, Rope". */
const itemsLine = (s: CharacterSheet) => s.equipment.map((e) => (e.count > 1 ? `${e.name} ×${e.count}` : e.name)).join(', ');

export function rulesView(state: RulesState, results: string[]): RulesView {
  const { party, combat, dungeon } = state;
  const light = lightLevel(state);
  return {
    party: Object.entries(party.sheets).map(([id, s]) => heroView(id, s, light)),
    combat: combat && {
      round: combat.round,
      outcome: combat.outcome,
      combatants: combat.order.map((id) => combat.combatants[id]).map(({ id, name, side, hp, maxHp, status, conditions }) =>
        ({ id, name, side, hp, maxHp, status, conditions: [...conditions] })),
    },
    dungeon: dungeon && {
      mode: dungeon.map.mode,
      kind: dungeon.map.kind,
      at: dungeon.at,
      level: dungeonLevel(dungeon),
      deepened: dungeon.deepened ?? [],
      areas: dungeon.visited.map((id) => dungeon.map.nodes[id]).map(({ id, name, purpose, exits }) =>
        ({ id, name, purpose, cleared: dungeon.cleared.includes(id), exits: exits.map(({ id: x, connection, to }) => ({ id: x, connection, to })) })),
      waiting: waiting(dungeon),
    },
    results,
    levelUps: (party.levelUps ?? []).map((u) => ({ ...u, name: party.sheets[u.playerId].name })),
    time: { seconds: clockOf(party), label: clockLabel(clockOf(party)) },
    light: { level: light, source: litView(state) },
  };
}

export interface RulesContext {
  party: {
    name: string; level: number; hp: number; maxHp: number; armorClass: number; exhaustion: number; slotsLeft: number[];
    passivePerception: number; passiveInsight: number; gp: number; items: string; dragging: boolean; dead: boolean;
    sees: Sight;
    /** "poisoned (40 minutes)"; "" for none. */
    conditions: string;
  }[];
  /** The clock: "Day 1, 08:40". */
  time: string;
  /** "dark; the party's light: Bryn's Torch (40 minutes left)", or "dim; no light carried". */
  light: string;
  combat: null | { round: number; combatants: { name: string; side: 'party' | 'foes'; hp: number; maxHp: number; status: string }[] };
  dungeon: null | { kind: string; level: number; area: string; purpose: string | null; exits: { id: string; connection: string; leadsTo: string | null }[]; waiting: Waiting | null };
  /** SRD monster ids that suit the party, for fights the DM proposes. */
  monsters: string[];
}

const MONSTER_PICKS = 40;

/** Monsters the engine fights (from `pool`, if given) that a moderate fight for this party could afford, toughest first. */
export function suitableMonsters(levels: readonly number[], pool?: readonly string[]): string[] {
  const budget = temperedBudget(levels, 'moderate');
  return candidates(levels, pool)
    .filter((m) => m.xp <= budget)
    .sort((a, b) => b.xp - a.xp)
    .slice(0, MONSTER_PICKS)
    .map((m) => m.id);
}

function lightLine(s: RulesState): string {
  const lit = litView(s);
  const own = s.party.lit ? 'bright' : lightLevel(s);
  return `${own}; ${lit ? `the party's light: ${lit.holder}'s ${lit.name} (${lit.minutesLeft} minutes left)` : 'no light carried'}`;
}

/** The area a way leads to, named with the corridor it goes by. */
function leadsTo(dungeon: DungeonState, exitId: string, to: string): string {
  const next = dungeon.map.nodes[to];
  return next.type === 'corridor' ? `${dungeon.map.nodes[exitId].name}, by a ${next.name.toLowerCase()}` : next.name;
}

export function rulesContext(state: RulesState): RulesContext {
  const { party, combat, dungeon } = state;
  const sheets = Object.values(party.sheets);
  const light = lightLevel(state);
  const here = dungeon && dungeon.map.nodes[dungeon.at];
  return {
    party: sheets.map((s) => ({
      name: s.name, level: s.level, hp: s.hp, maxHp: s.maxHp, armorClass: s.armorClass, exhaustion: s.exhaustion, slotsLeft: slotsLeft(s),
      ...passives(s), gp: s.gp, items: itemsLine(s), dragging: load(s).dragging, dead: s.dead === true, sees: sightOf(s, light), conditions: conditionsLine(s),
    })),
    time: clockLabel(clockOf(party)),
    light: lightLine(state),
    combat: combat && {
      round: combat.round,
      combatants: combat.order.map((id) => combat.combatants[id]).map(({ name, side, hp, maxHp, status }) => ({ name, side, hp, maxHp, status })),
    },
    dungeon: dungeon && here && {
      kind: dungeon.map.kind,
      level: dungeonLevel(dungeon),
      area: here.name,
      purpose: here.purpose,
      exits: here.exits.map((x) => ({ id: x.id, connection: x.connection, leadsTo: x.to === null ? null : leadsTo(dungeon, x.id, x.to) })),
      waiting: waiting(dungeon),
    },
    monsters: suitableMonsters(foeLevels(party, dungeon), habitatOf(dungeon)),
  };
}
