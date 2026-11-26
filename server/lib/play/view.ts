/**
 * What the rules engine shows: the API's RulesView (docs/api.md) and the DM's RulesContext
 * (docs/dungeon-master.md). Plain projections of the stored state.
 */
import { passiveScore } from '../rules/checks.ts';
import { load } from '../rules/inventory.ts';
import { encounterBudget, monsters } from '../rules/monsters.ts';
import { resourcesOf } from '../rules/resources.ts';
import type { CharacterSheet } from '../rules/sheet.ts';
import type { RulesState } from './turn.ts';

const NO_SLOTS = [0, 0, 0, 0, 0, 0, 0, 0, 0];
const slotsLeft = (s: CharacterSheet) => (s.spellcasting ? s.spellcasting.slots.map((n, i) => n - s.spellcasting!.expended[i]) : NO_SLOTS);

export interface HeroView {
  playerId: string; name: string; level: number; xp: number; hp: number; maxHp: number; armorClass: number;
  exhaustion: number; hitDiceLeft: number; slotsLeft: number[];
  resources: { id: string; name: string; left: number; max: number }[]; down: boolean;
  passivePerception: number; passiveInsight: number;
  gp: number; inventory: { id: string; name: string; count: number }[];
  /** Pounds carried and the 5.2 carrying capacity; over it the hero is dragging (Speed 5 ft), up to dragLimit. */
  carried: number; capacity: number; dragLimit: number; dragging: boolean;
}

export interface RulesView {
  party: HeroView[];
  combat: null | {
    round: number; outcome: 'ongoing' | 'victory' | 'defeat';
    combatants: { id: string; name: string; side: 'party' | 'foes'; hp: number; maxHp: number; status: string; conditions: string[] }[];
  };
  dungeon: null | {
    mode: 'fixed' | 'explore'; kind: string; at: string;
    areas: { id: string; name: string; purpose: string | null; cleared: boolean; exits: { id: string; connection: string; to: string | null }[] }[];
  };
  results: string[];
}

const heroView = (playerId: string, s: CharacterSheet): HeroView => ({
  playerId, name: s.name, level: s.level, xp: s.xp, hp: s.hp, maxHp: s.maxHp, armorClass: s.armorClass,
  exhaustion: s.exhaustion, hitDiceLeft: s.level - s.hitDiceSpent, slotsLeft: slotsLeft(s),
  resources: resourcesOf(s).map(({ id, name, left, max }) => ({ id, name, left, max })), down: s.hp === 0,
  ...passives(s), gp: s.gp, inventory: s.equipment.map(({ id, name, count }) => ({ id, name, count })),
  ...load(s),
});

const passives = (s: CharacterSheet) => ({
  passivePerception: passiveScore(s, { ability: 'wis', skill: 'perception' }), passiveInsight: passiveScore(s, { ability: 'wis', skill: 'insight' }),
});
/** "Potion of Healing ×2, Rope". */
const itemsLine = (s: CharacterSheet) => s.equipment.map((e) => (e.count > 1 ? `${e.name} ×${e.count}` : e.name)).join(', ');

export function rulesView({ party, combat, dungeon }: RulesState, results: string[]): RulesView {
  return {
    party: Object.entries(party.sheets).map(([id, s]) => heroView(id, s)),
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
      areas: dungeon.visited.map((id) => dungeon.map.nodes[id]).map(({ id, name, purpose, exits }) =>
        ({ id, name, purpose, cleared: dungeon.cleared.includes(id), exits: exits.map(({ id: x, connection, to }) => ({ id: x, connection, to })) })),
    },
    results,
  };
}

export interface RulesContext {
  party: {
    name: string; level: number; hp: number; maxHp: number; armorClass: number; exhaustion: number; slotsLeft: number[];
    passivePerception: number; passiveInsight: number; gp: number; items: string; dragging: boolean;
  }[];
  combat: null | { round: number; combatants: { name: string; side: 'party' | 'foes'; hp: number; maxHp: number; status: string }[] };
  dungeon: null | { kind: string; area: string; purpose: string | null; exits: { id: string; connection: string; leadsTo: string | null }[] };
  /** SRD monster ids that suit the party, for fights the DM proposes. */
  monsters: string[];
}

const MONSTER_PICKS = 40;

/** Monsters a moderate fight for this party could afford, toughest first. */
export function suitableMonsters(levels: readonly number[]): string[] {
  const budget = encounterBudget(levels, 'moderate');
  return [...monsters().values()]
    .filter((m) => m.xp <= budget)
    .sort((a, b) => b.xp - a.xp)
    .slice(0, MONSTER_PICKS)
    .map((m) => m.id);
}

export function rulesContext({ party, combat, dungeon }: RulesState): RulesContext {
  const sheets = Object.values(party.sheets);
  const here = dungeon && dungeon.map.nodes[dungeon.at];
  return {
    party: sheets.map((s) => ({
      name: s.name, level: s.level, hp: s.hp, maxHp: s.maxHp, armorClass: s.armorClass, exhaustion: s.exhaustion, slotsLeft: slotsLeft(s),
      ...passives(s), gp: s.gp, items: itemsLine(s), dragging: load(s).dragging,
    })),
    combat: combat && {
      round: combat.round,
      combatants: combat.order.map((id) => combat.combatants[id]).map(({ name, side, hp, maxHp, status }) => ({ name, side, hp, maxHp, status })),
    },
    dungeon: dungeon && here && {
      kind: dungeon.map.kind,
      area: here.name,
      purpose: here.purpose,
      exits: here.exits.map((x) => ({ id: x.id, connection: x.connection, leadsTo: x.to === null ? null : dungeon.map.nodes[x.to].name })),
    },
    monsters: suitableMonsters(sheets.map((s) => s.level)),
  };
}
