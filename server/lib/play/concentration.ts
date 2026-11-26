/**
 * Concentration in a fight (SRD 5.2): a hero concentrating on a spell makes a Constitution save each time it
 * takes damage (DC half the damage, 10 to 30), and loses the spell on a failure, or at once when it drops
 * to 0 HP or is Incapacitated. The save itself is rules/spellEffects.ts concentrationCheck.
 */
import type { Combatant } from '../rules/combatant.ts';
import { type Rng, seededRng } from '../rules/rng.ts';
import type { CombatEvent, CombatState } from '../rules/scene.ts';
import type { CharacterSheet } from '../rules/sheet.ts';
import { concentrationCheck } from '../rules/spellEffects.ts';
import { endConcentration } from '../rules/spells.ts';
import { srd } from '../rules/srd.ts';

/** The damage of each attack or spell that hurt `id` in these events, in order. */
export function hitsOn(events: readonly CombatEvent[], id: string): number[] {
  return events.flatMap((e) => {
    if (e.kind === 'attack') return e.result.target === id ? [e.result.damage] : [];
    return e.kind === 'spell' ? e.outcomes.filter((o) => o.target === id).map((o) => o.damage) : [];
  }).filter((d) => d > 0);
}

const INCAPACITATING = ['incapacitated', 'paralyzed', 'petrified', 'stunned', 'unconscious'];
const helpless = (c: Combatant) => c.status !== 'up' || c.conditions.some((x) => INCAPACITATING.includes(x));

/** One hero's concentration through its hits: it ends at once if the hero is helpless, else at the first failed save. */
function concentrate(rng: Rng, sheet: CharacterSheet, me: Combatant, hits: number[], lines: string[]): CharacterSheet {
  const spell = srd().spells.get(sheet.spellcasting!.concentratingOn!)!.name;
  if (helpless(me)) { lines.push(`${sheet.name} can no longer concentrate on ${spell}.`); return endConcentration(sheet); }
  for (const damage of hits) {
    const { dc, roll, success } = concentrationCheck(rng, me, damage);
    lines.push(`${sheet.name} ${success ? 'keeps concentrating on' : 'loses concentration on'} ${spell} (CON save ${roll!.total} vs DC ${dc}).`);
    if (!success) return endConcentration(sheet);
  }
  return sheet;
}

/** Each concentrating hero's saves for the hits it took between `before` and `after`; a lost spell ends on its sheet. */
export function keepConcentration(before: CombatState, after: CombatState, sheets: Record<string, CharacterSheet>): { combat: CombatState; sheets: Record<string, CharacterSheet>; lines: string[] } {
  const events = after.log.slice(before.log.length);
  const rng = seededRng(after.rng);
  const lines: string[] = [];
  const out = Object.fromEntries(Object.entries(sheets).map(([id, sheet]) => {
    const me = after.combatants[id];
    return [id, sheet.spellcasting?.concentratingOn && me ? concentrate(rng, sheet, me, hitsOn(events, id), lines) : sheet];
  }));
  return lines.length ? { combat: { ...after, rng: rng.state() }, sheets: out, lines } : { combat: after, sheets, lines };
}
