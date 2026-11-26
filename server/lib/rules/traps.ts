/**
 * The SRD 5.2 example traps (Gameplay Toolbox, 5.2/traps.json, CC-BY-4.0): how to spot them, how to
 * disarm or avoid them, and what they do, scaled to the party's level by their At Higher Levels tables.
 * Dungeon maps rolled before Phase 3 hold SRD 5.1 trap ids; they map to their 5.2 counterparts.
 */
import { z } from 'zod';
import trapsJson from '../../data/srd/5.2/traps.json' with { type: 'json' };
import { ABILITIES } from './abilities.ts';
import type { Dungeon } from './dungeon.ts';
import { once, parseTable } from './srd.ts';
import { require } from './violation.ts';

const ability = z.enum(ABILITIES);
const check = z.object({ ability, skill: z.string(), dc: z.number() });
const part = z.object({ dice: z.string(), type: z.string(), times: z.string().optional() });
const tier = z.object({ levels: z.tuple([z.number(), z.number()]), dc: z.number().optional(), escapeDc: z.number().optional(), damage: z.array(part).optional() });

const trapSchema = z.object({
  index: z.string(), name: z.string(), severity: z.enum(['nuisance', 'deadly']), levels: z.tuple([z.number(), z.number()]),
  detect: check, disarm: check.extend({ failureTriggers: z.boolean() }).nullable(), avoid: z.string(),
  effect: z.object({
    targets: z.enum(['one', 'all']), save: z.object({ ability, dc: z.number() }).nullable(), damage: z.array(part),
    halfOnSave: z.boolean(), condition: z.string().nullable(), escape: check.optional(),
  }),
  scaling: z.array(tier),
});
const entrySchema = z.union([trapSchema, z.object({ index: z.string() }).transform(() => null)]);

type TrapEntry = z.infer<typeof trapSchema>;
export type DamagePart = z.infer<typeof part>;
export interface Trap {
  id: string; name: string; severity: 'nuisance' | 'deadly';
  detect: z.infer<typeof check>; disarm: TrapEntry['disarm']; avoid: string;
  targets: 'one' | 'all'; save: { ability: z.infer<typeof ability>; dc: number } | null; damage: DamagePart[];
  halfOnSave: boolean; condition: string | null; escape: z.infer<typeof check> | null;
}

const entries = once(() => new Map(parseTable('traps', entrySchema, trapsJson).filter((t) => t !== null).map((t) => [t.index, t])));

/** SRD 5.1 sample trap ids (dungeon maps rolled before Phase 3) and their SRD 5.2 counterparts. */
const LEGACY: Readonly<Record<string, string>> = {
  'fire-breathing-statue': 'fire-casting-statue', pits: 'hidden-pit', 'poison-darts': 'poisoned-darts',
  'poison-needle': 'poisoned-needle', 'rolling-sphere': 'rolling-stone', 'sphere-of-annihilation': 'spiked-pit',
};
const canonical = (id: string) => (Object.hasOwn(LEGACY, id) ? LEGACY[id] : id);

/** The map with every stored 5.1 trap id put as its 5.2 counterpart; the same map when it has none. */
export function currentTraps(map: Dungeon): Dungeon {
  const old = Object.values(map.nodes).filter((n) => n.contents?.trap && Object.hasOwn(LEGACY, n.contents.trap));
  if (old.length === 0) return map;
  const fixed = old.map((n) => [n.id, { ...n, contents: { ...n.contents!, trap: canonical(n.contents!.trap!) } }]);
  return { ...map, nodes: { ...map.nodes, ...Object.fromEntries(fixed) } };
}

export const isTrap = (id: string) => entries().has(canonical(id));

/** The trap for a party of this (average) level: its tier's DCs and damage; a trap above the party's levels becomes a Collapsing Roof. */
export function trapAt(id: string, level: number): Trap {
  const entry = entries().get(canonical(id));
  require(entry !== undefined, `unknown trap: ${id}`);
  if (level < entry.levels[0]) return trapAt('collapsing-roof', level);
  const tiers = [{ levels: entry.levels }, ...entry.scaling];
  const { dc, escapeDc, damage = entry.effect.damage } = tiers.findLast((t) => level >= t.levels[0])!;
  const e = entry.effect;
  const save = e.save && { ...e.save, ...(dc === undefined ? {} : { dc }) };
  const escape = e.escape ? { ...e.escape, ...(escapeDc === undefined ? {} : { dc: escapeDc }) } : null;
  return {
    id: entry.index, name: entry.name, severity: entry.severity, detect: entry.detect, disarm: entry.disarm, avoid: entry.avoid,
    targets: e.targets, save, damage, halfOnSave: e.halfOnSave, condition: e.condition, escape,
  };
}
