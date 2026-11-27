/**
 * A rules hook: the mechanic a DM's choice carries (docs/dungeon-master.md). The DM's output is checked
 * here, where it enters; a hook that doesn't hold up is dropped and its choice is pure story.
 */
import { z } from 'zod';
import { ABILITIES, type Ability } from '../rules/abilities.ts';
import { type Condition, CONDITIONS } from '../rules/conditions.ts';
import { HEALING_POTIONS, items } from '../rules/items.ts';
import { capFight, rateEncounter } from '../rules/encounter.ts';
import { monsters } from '../rules/monsters.ts';
import type { HazardKind } from '../rules/hazards.ts';
import { modeOf } from '../rules/resolve.ts';
import { isTrap } from '../rules/traps.ts';
import { srd } from '../rules/srd.ts';
import type { DungeonState } from './state.ts';
import { wayLabel } from './ways.ts';

export type RulesHook =
  | {
    kind: 'check'; ability: Ability; skill?: string | null; tool?: string | null;
    /** The DC; may be left out when the check is against a monster (its passive score or Influence DC). */
    dc?: number | null; against?: string | null;
    /** group: every hero rolls, half must succeed; best: the best hero rolls, the others Help. */
    mode?: 'group' | 'best' | null;
  } & Edge
  /** condition: what a failed save brings, for `minutes` (none: until a long rest). */
  | { kind: 'save'; ability: Ability; dc: number; damage?: string | null; damageType?: string | null; condition?: SaveCondition | null; minutes?: number | null } & Edge
  | { kind: 'fight'; monsters: string[] }
  /** The foes already met: fight them as they stand, with no further cap (play/turn.ts). */
  | { kind: 'engage'; monsters: string[] }
  /** Leave before initiative. In a room, back out the way the party came; wanderers are slipped past. */
  | { kind: 'run' }
  | { kind: 'rest'; rest: 'short' | 'long' }
  | { kind: 'move'; exit: string }
  /** Each item is bought by the richest hero who can pay (a shop scene). */
  | { kind: 'buy'; items: string[] }
  /** Every hero sells all they hold of each item. */
  | { kind: 'sell'; items: string[] }
  /** The most hurt hero drinks a Potion of Healing. */
  | { kind: 'use'; item: string }
  /** An SRD 5.2 example trap (by id) the party may run into. */
  | { kind: 'trap'; trap: string }
  /** An SRD 5.2 hazard that befalls every living hero; feet, minutes, hours or days as the hazard needs. */
  | { kind: 'hazard'; hazard: HazardKind; feet?: number; minutes?: number; hours?: number; days?: number }
  /** Talk to the foes waiting in the room, or to these (play/parley.ts). */
  | { kind: 'parley'; monsters?: string[] | null }
  /** A temple or shrine: every dead hero is raised (Raise Dead) while the party's gold lasts (play/revive.ts). */
  | { kind: 'revive' }
  /** A tale told: the story reaches the quest's goal, and its foes are met (play/quest.ts). */
  | { kind: 'goal' };

interface Edge { advantage?: boolean | null; disadvantage?: boolean | null }

export type RollHook = Extract<RulesHook, { kind: 'check' | 'save' }>;

const MAX_DC = 30;
const dc = z.number().int().min(1).max(MAX_DC);
const ability = z.enum(ABILITIES);
const DICE = /^\d+d\d+([+-]\d+)?$/;

const edge = { advantage: z.boolean().nullish(), disadvantage: z.boolean().nullish() };
const isMonster = (id: string) => monsters().has(id);
const itemList = z.array(z.string()).transform((ids) => ids.filter((id) => items().has(id))).refine((ids) => ids.length > 0);

const amount = (max: number) => z.number().positive().max(max);
/** Each hazard with the amount it needs (and nothing else). */
const hazardSchema = z.discriminatedUnion('hazard', [
  z.object({ kind: z.literal('hazard'), hazard: z.literal('falling'), feet: amount(1000) }),
  z.object({ kind: z.literal('hazard'), hazard: z.literal('burning') }),
  z.object({ kind: z.literal('hazard'), hazard: z.literal('suffocation'), minutes: amount(60) }),
  z.object({ kind: z.literal('hazard'), hazard: z.literal('extreme-cold'), hours: amount(24) }),
  z.object({ kind: z.literal('hazard'), hazard: z.literal('extreme-heat'), hours: amount(24) }),
  z.object({ kind: z.literal('hazard'), hazard: z.literal('dehydration') }),
  z.object({ kind: z.literal('hazard'), hazard: z.literal('malnutrition'), days: amount(60) }),
]);

/** Conditions a DM's save can bring (Exhaustion has its own levels). */
export const SAVE_CONDITIONS = CONDITIONS.filter((c) => c !== 'exhaustion') as Exclude<Condition, 'exhaustion'>[];
export type SaveCondition = Exclude<Condition, 'exhaustion'>;
const MINUTES_IN_A_DAY = 1440;

const HookSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('check'), ability, skill: z.string().refine((s) => srd().skills.has(s)).nullish(),
    tool: z.string().refine((t) => items().get(t)?.kind === 'tool').nullish(),
    dc: dc.nullish(), against: z.string().refine(isMonster).nullish(), mode: z.enum(['group', 'best']).nullish(), ...edge,
  }).refine((h) => typeof h.dc === 'number' || typeof h.against === 'string'),
  z.object({
    kind: z.literal('save'), ability, dc, damage: z.string().regex(DICE).nullish(), damageType: z.string().nullish(),
    condition: z.enum(SAVE_CONDITIONS).nullish(), minutes: amount(MINUTES_IN_A_DAY).nullish(), ...edge,
  }),
  z.object({ kind: z.literal('fight'), monsters: z.array(z.string()).transform((ids) => ids.filter(isMonster)).refine((ids) => ids.length > 0) }),
  z.object({ kind: z.literal('engage'), monsters: z.array(z.string()).transform((ids) => ids.filter(isMonster)).refine((ids) => ids.length > 0) }),
  z.object({ kind: z.literal('run') }),
  z.object({ kind: z.literal('rest'), rest: z.enum(['short', 'long']) }),
  z.object({ kind: z.literal('move'), exit: z.string().min(1) }),
  z.object({ kind: z.literal('buy'), items: itemList }),
  z.object({ kind: z.literal('sell'), items: itemList }),
  z.object({ kind: z.literal('use'), item: z.string().refine((id) => Object.hasOwn(HEALING_POTIONS, id)) }),
  z.object({ kind: z.literal('trap'), trap: z.string().refine(isTrap) }),
  hazardSchema,
  z.object({ kind: z.literal('parley'), monsters: z.array(z.string()).transform((ids) => ids.filter(isMonster)).nullish() }),
  z.object({ kind: z.literal('revive') }),
  z.object({ kind: z.literal('goal') }),
]);

/** The hook, or null when there is none or it doesn't hold up (unknown skill or monster, DC out of 1–30…). */
export function parseHook(json: unknown): RulesHook | null {
  const parsed = HookSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

export const ABILITY_NAMES: Readonly<Record<Ability, string>> = {
  str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma',
};

/** "sleight-of-hand" → "Sleight Of Hand". */
export const titleCase = (id: string) => id.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

/** "2 Goblin Warriors, Bugbear Warrior". */
function countedList(ids: readonly string[], nameOf: (id: string) => string, many: (n: number, name: string) => string): string {
  return [...new Set(ids)].map((id): [string, number] => [id, ids.filter((x) => x === id).length]).map(([id, n]) => (n > 1 ? many(n, nameOf(id)) : nameOf(id))).join(', ');
}
const monsterName = (id: string) => monsters().get(id)!.name;
const itemName = (id: string) => items().get(id)!.name;
const times = (n: number, name: string) => `${name} ×${n}`;
/** "Goblin Warrior ×2, Bugbear Warrior". */
export const foesNamed = (ids: readonly string[]) => countedList(ids, monsterName, times);

/** "Sleight Of Hand with Thieves' Tools", "Thieves' Tools", "Athletics", "Dexterity save". */
export function rollName(hook: RollHook): string {
  if (hook.kind === 'save') return `${ABILITY_NAMES[hook.ability]} save`;
  const tool = hook.tool ? items().get(hook.tool)!.name : null;
  if (!hook.skill) return tool === null ? ABILITY_NAMES[hook.ability] : tool;
  return tool ? `${titleCase(hook.skill)} with ${tool}` : titleCase(hook.skill);
}

const EDGE_LABELS = { normal: '', advantage: ', with Advantage', disadvantage: ', with Disadvantage' };
const edgeLabel = (h: Edge) => EDGE_LABELS[modeOf(!!h.advantage, !!h.disadvantage)];
const target = (h: Extract<RulesHook, { kind: 'check' }>) => (typeof h.dc === 'number' ? `, DC ${h.dc}` : ` vs ${monsters().get(h.against!)!.name}`);

const UNITS = ['feet', 'minutes', 'hours', 'days'] as const;
function hazardAmount(h: Extract<RulesHook, { kind: 'hazard' }>): string {
  const unit = UNITS.find((u) => typeof h[u] === 'number');
  return unit ? ` (${h[unit]} ${unit})` : '';
}

/**
 * "Fight: 2 Goblin Warriors (weak) — low". With no party levels, the names only (a label with nothing to
 * rate it against). A fight the DM proposes is rated after the cap, which is the fight the engine will run;
 * an engage is the foes already standing, uncapped.
 */
function fightText(ids: readonly string[], levels: readonly number[] | undefined, cap: boolean): string {
  const fought = levels && levels.length > 0 && cap ? capFight(ids, levels) : [...ids];
  const rated = levels && levels.length > 0 ? rateEncounter(levels, fought) : null;
  const parts = [...new Set(fought)].map((id) => {
    const n = fought.filter((x) => x === id).length;
    const name = monsterName(id);
    const titled = n > 1 ? `${n} ${name}s` : name;
    return rated ? `${titled} (${rated.monsters.find((m) => m.id === id)!.toughness})` : titled;
  });
  return `Fight: ${parts.join(', ')}${rated ? ` — ${rated.band}` : ''}`;
}

/** What a label may be told: the party's levels (a fight's rating) or the dungeon (a way's name). */
interface LabelContext { levels?: readonly number[]; dungeon?: DungeonState | null }

const LABELS: { [K in RulesHook['kind']]: (hook: Extract<RulesHook, { kind: K }>, ctx: LabelContext) => string } = {
  check: (h) => `${rollName(h)} check${target(h)}${h.mode === 'best' ? ', one hero with help' : ''}${edgeLabel(h)}`,
  save: (h) => `${rollName(h)}, DC ${h.dc}${edgeLabel(h)}`,
  fight: (h, ctx) => fightText(h.monsters, ctx.levels, true),
  engage: (h, ctx) => fightText(h.monsters, ctx.levels, false),
  run: () => 'Run',
  rest: (h) => (h.rest === 'short' ? 'Short rest' : 'Long rest'),
  move: (h, ctx) => wayLabel(ctx.dungeon, h.exit),
  buy: (h) => `Buy ${countedList(h.items, itemName, times)}`,
  sell: (h) => `Sell ${countedList(h.items, itemName, times)}`,
  use: (h) => `Drink a ${itemName(h.item)}`,
  trap: () => 'Risk a trap',
  hazard: (h) => `Hazard: ${titleCase(h.hazard)}${hazardAmount(h)}`,
  parley: (h) => (h.monsters && h.monsters.length > 0 ? `Parley with ${foesNamed(h.monsters)}` : 'Parley'),
  revive: () => 'Raise the dead',
  goal: () => 'The quest’s goal: face its foes',
};

function labelContext(context?: readonly number[] | DungeonState | null): LabelContext {
  // A level list is the only array this is ever given; a dungeon is an object (or null).
  if (Array.isArray(context)) return { levels: context };
  return { dungeon: (context ?? null) as DungeonState | null };
}

/**
 * What the app shows under the choice. A number array rates a fight against that party. A dungeon names
 * a way on from where the party is (play/ways.ts). Passed neither, a way on is "Go on" and a fight is unrated.
 */
export const hookLabel = (hook: RulesHook, context?: readonly number[] | DungeonState | null): string =>
  (LABELS[hook.kind] as (h: RulesHook, ctx: LabelContext) => string)(hook, labelContext(context));
