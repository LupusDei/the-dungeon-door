/**
 * The combat HUD (docs/api.md, `rules.combat.hud`): at a glance, each hero's hit points and each foe's
 * general condition, with what holds each of them. A foe's hit points never leave the server: the HUD sends
 * its tier, worked out here (Micah: "which enemy to hit, who needs healing, who is asleep").
 */
import { conditionsOf, type TimedCondition } from '../rules/conditions.ts';
import type { Combatant } from '../rules/combatant.ts';
import { type Hold, holdsOn } from '../rules/holds.ts';
import { canAct, type CombatState } from '../rules/scene.ts';
import type { CharacterSheet } from '../rules/sheet.ts';
import { srd } from '../rules/srd.ts';
import { counted } from '../rules/counted.ts';

/**
 * A foe's general condition by its share of hit points left. Unhurt: full. Hurt: below full. Bloodied: half
 * or less (the 2024 term). Near death: a quarter or less. Down: 0 (a foe at 0 HP is dead).
 */
export type Tier = 'unhurt' | 'hurt' | 'bloodied' | 'near-death' | 'down';
export const TIERS: readonly Tier[] = ['unhurt', 'hurt', 'bloodied', 'near-death', 'down'];
export const TIER_LABELS: Readonly<Record<Tier, string>> = { unhurt: 'Unhurt', hurt: 'Hurt', bloodied: 'Bloodied', 'near-death': 'Near death', down: 'Down' };

export function tierOf(hp: number, maxHp: number): Tier {
  if (hp <= 0) return 'down';
  if (hp >= maxHp) return 'unhurt';
  if (hp * 4 <= maxHp) return 'near-death';
  return hp * 2 <= maxHp ? 'bloodied' : 'hurt';
}

/** One thing on a combatant: an SRD condition id ("prone"), or "asleep", "concentrating", "dodging". */
export interface HudCondition {
  id: string;
  label: string;
  /** The spell behind it ("Sleep", "Hold Person"), or null. */
  source: string | null;
  /** How it ends, when the engine knows: "DC 13 WIS save at the end of its turns", "1 hour". */
  ends: string | null;
}

export interface HudHero { id: string; name: string; hp: number; maxHp: number; status: Combatant['status']; conditions: HudCondition[] }
/** No hp or maxHp: a foe's hit points are hidden. */
export interface HudFoe { id: string; name: string; tier: Tier; label: string; status: Combatant['status']; conditions: HudCondition[] }
/**
 * Both sides in initiative order, and the turn order itself: everyone's id in one list, who acts now
 * (`combat.turn`) and who comes up after them, passing over anyone who cannot act. Null once the
 * fight is over.
 */
export interface CombatHud { party: HudHero[]; foes: HudFoe[]; order: string[]; now: string | null; next: string | null }

const titled = (s: string) => s.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

const WHEN: { [K in TimedCondition['until']['kind']]: (u: Extract<TimedCondition['until'], { kind: K }>) => string } = {
  time: (u) => (u.left >= 3600 ? counted(Math.ceil(u.left / 360) / 10, 'hour') : counted(Math.ceil(u.left / 60), 'minute')),
  'long-rest': () => 'until a long rest',
  save: (u) => `DC ${u.dc} ${u.ability.toUpperCase()} save to end`,
  escape: (u) => `DC ${u.dc} ${titled(u.skill)} to break free`,
};
/** How a carried condition ends: "40 minutes", "until a long rest", "DC 10 Athletics to break free". */
export const endsOf = (c: TimedCondition): string => (WHEN[c.until.kind] as (u: TimedCondition['until']) => string)(c.until);

const spellName = (id: string) => srd().spells.get(id)?.name ?? titled(id);

function holdEnds(h: Hold): string | null {
  const ways = [
    ...(h.save ? [`a DC ${h.save.dc} ${h.save.ability.toUpperCase()} save at the end of its turns`] : []),
    ...(h.brokenByHarm ? ['any damage'] : []),
    ...(srd().spells.get(h.spellId)?.concentration ? ['the caster losing concentration'] : []),
  ];
  if (!ways.length) return null;
  return `Ends with ${ways.length > 1 ? `${ways.slice(0, -1).join(', ')} or ${ways.at(-1)}` : ways[0]}`;
}

/** Sleep's Unconscious is sleep: shown as Asleep, so the table can tell a sleeper from the fallen. */
function fromHold(condition: string, h: Hold): HudCondition {
  const asleep = h.spellId === 'sleep' && condition === 'unconscious';
  return { id: asleep ? 'asleep' : condition, label: asleep ? 'Asleep' : titled(condition), source: spellName(h.spellId), ends: holdEnds(h) };
}

function conditionsOn(c: Combatant, sheet: CharacterSheet | undefined, combat: CombatState): HudCondition[] {
  if (c.status === 'dead') return [];
  const holds = holdsOn(c);
  const carried = sheet ? conditionsOf(sheet) : [];
  const listed = [...new Set(c.conditions)].map((x): HudCondition => {
    const h = holds.find((hold) => hold.conditions.includes(x));
    if (h) return fromHold(x, h);
    const timed = carried.find((t) => t.condition === x);
    return { id: x, label: titled(x), source: null, ends: timed ? endsOf(timed) : null };
  });
  const spell = sheet?.spellcasting?.concentratingOn;
  return [
    ...listed,
    ...(spell ? [{ id: 'concentrating', label: 'Concentrating', source: spellName(spell), ends: null }] : []),
    ...(combat.dodging.includes(c.id) && c.status === 'up' ? [{ id: 'dodging', label: 'Dodging', source: null, ends: 'Until its next turn' }] : []),
  ];
}

/** The HUD for a fight, both sides in initiative order. */
export function combatHud(combat: CombatState, sheets: Readonly<Record<string, CharacterSheet>>): CombatHud {
  const ordered = combat.order.map((id) => combat.combatants[id]);
  return {
    ...turns(combat),
    party: ordered.filter((c) => c.side === 'party').map((c) => ({
      id: c.id, name: c.name, hp: c.hp, maxHp: c.maxHp, status: c.status, conditions: conditionsOn(c, sheets[c.id], combat),
    })),
    foes: ordered.filter((c) => c.side === 'foes').map((c) => {
      const tier = c.status === 'dead' ? 'down' : tierOf(c.hp, c.maxHp);
      return { id: c.id, name: c.name, tier, label: c.status === 'dead' ? 'Dead' : TIER_LABELS[tier], status: c.status, conditions: conditionsOn(c, undefined, combat) };
    }),
  };
}

function turns(combat: CombatState): Pick<CombatHud, 'order' | 'now' | 'next'> {
  const order = combat.order.filter((id) => combat.combatants[id]);
  const now = combat.outcome === 'ongoing' ? combat.order[combat.turn] ?? null : null;
  if (!now) return { order, now: null, next: null };
  const after = [...combat.order.slice(combat.turn + 1), ...combat.order.slice(0, combat.turn + 1)];
  const next = after.find((id) => combat.combatants[id] && canAct(combat.combatants[id])) ?? null;
  return { order, now, next };
}
