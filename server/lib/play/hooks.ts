/**
 * A rules hook: the mechanic a DM's choice carries (docs/dungeon-master.md). The DM's output is checked
 * here, where it enters; a hook that doesn't hold up is dropped and its choice is pure story.
 */
import { z } from 'zod';
import { ABILITIES, type Ability } from '../rules/abilities.ts';
import { items } from '../rules/items.ts';
import { monsters } from '../rules/monsters.ts';
import { modeOf } from '../rules/resolve.ts';
import { srd } from '../rules/srd.ts';

export type RulesHook =
  | {
    kind: 'check'; ability: Ability; skill?: string | null; tool?: string | null;
    /** The DC; may be left out when the check is against a monster (its passive score or Influence DC). */
    dc?: number | null; against?: string | null;
    /** group: every hero rolls, half must succeed; best: the best hero rolls, the others Help. */
    mode?: 'group' | 'best' | null;
  } & Edge
  | { kind: 'save'; ability: Ability; dc: number; damage?: string | null; damageType?: string | null } & Edge
  | { kind: 'fight'; monsters: string[] }
  | { kind: 'rest'; rest: 'short' | 'long' }
  | { kind: 'move'; exit: string };

interface Edge { advantage?: boolean | null; disadvantage?: boolean | null }

export type RollHook = Extract<RulesHook, { kind: 'check' | 'save' }>;

const MAX_DC = 30;
const dc = z.number().int().min(1).max(MAX_DC);
const ability = z.enum(ABILITIES);
const DICE = /^\d+d\d+([+-]\d+)?$/;

const edge = { advantage: z.boolean().nullish(), disadvantage: z.boolean().nullish() };
const isMonster = (id: string) => monsters().has(id);

const HookSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('check'), ability, skill: z.string().refine((s) => srd().skills.has(s)).nullish(),
    tool: z.string().refine((t) => items().get(t)?.kind === 'tool').nullish(),
    dc: dc.nullish(), against: z.string().refine(isMonster).nullish(), mode: z.enum(['group', 'best']).nullish(), ...edge,
  }).refine((h) => typeof h.dc === 'number' || typeof h.against === 'string'),
  z.object({ kind: z.literal('save'), ability, dc, damage: z.string().regex(DICE).nullish(), damageType: z.string().nullish(), ...edge }),
  z.object({ kind: z.literal('fight'), monsters: z.array(z.string()).transform((ids) => ids.filter(isMonster)).refine((ids) => ids.length > 0) }),
  z.object({ kind: z.literal('rest'), rest: z.enum(['short', 'long']) }),
  z.object({ kind: z.literal('move'), exit: z.string().min(1) }),
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
function monsterList(ids: readonly string[]): string {
  return [...new Set(ids)].map((id): [string, number] => [id, ids.filter((x) => x === id).length]).map(([id, n]) => (n > 1 ? `${n} ${monsters().get(id)!.name}s` : monsters().get(id)!.name)).join(', ');
}

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

const LABELS: { [K in RulesHook['kind']]: (hook: Extract<RulesHook, { kind: K }>) => string } = {
  check: (h) => `${rollName(h)} check${target(h)}${h.mode === 'best' ? ', one hero with help' : ''}${edgeLabel(h)}`,
  save: (h) => `${rollName(h)}, DC ${h.dc}${edgeLabel(h)}`,
  fight: (h) => `Fight: ${monsterList(h.monsters)}`,
  rest: (h) => (h.rest === 'short' ? 'Short rest' : 'Long rest'),
  move: (h) => `Go on (${h.exit})`,
};

/** What the app shows under the choice. */
export const hookLabel = (hook: RulesHook): string => (LABELS[hook.kind] as (h: RulesHook) => string)(hook);
