/**
 * Food and water by the game clock (SRD 5.2, kept light for a dungeon game). Each morning (every 24 hours
 * from the start, 08:00) each living hero eats a day's Rations; one with none counts a day without food,
 * and malnutrition's rule (rules/hazards.ts) says when that costs Exhaustion. A hero with a Waterskin has
 * water enough (the dungeon's streams and the party's stores are not tracked); one without suffers
 * dehydration, 1 Exhaustion.
 */
import { held, removeItem } from '../rules/inventory.ts';
import { scriptedRng } from '../rules/rng.ts';
import { sufferHazard } from '../rules/hazards.ts';
import type { CharacterSheet } from '../rules/sheet.ts';
import type { PartyState } from './state.ts';
import { clockOf } from './time.ts';

export const DAY = 86_400;

/** One hero's morning: a ration eaten, or another day without; water, or dehydration. */
function morning(sheet: CharacterSheet, lines: string[]): CharacterSheet {
  const rng = scriptedRng([]); // these hazards roll no dice
  let s: CharacterSheet;
  if (held(sheet, 'rations') > 0) {
    s = { ...removeItem(sheet, 'rations'), hungry: 0 };
    lines.push(`${sheet.name} eats a day's Rations (${held(s, 'rations')} left).`);
  } else {
    const days = (sheet.hungry ?? 0) + 1;
    const starved = sufferHazard(rng, sheet, { kind: 'malnutrition', days });
    s = { ...starved.sheet, hungry: days };
    lines.push(`${starved.line}.`);
  }
  if (held(s, 'waterskin') > 0 || s.dead) return s;
  const dry = sufferHazard(rng, s, { kind: 'dehydration' });
  lines.push(`${dry.line}.`);
  return dry.sheet;
}

/** Every morning between `since` and the party's clock now, each living hero eats and drinks, or goes without. */
export function provisions(party: PartyState, since: number): { party: PartyState; lines: string[] } {
  const mornings = Math.floor(clockOf(party) / DAY) - Math.floor(since / DAY);
  if (mornings <= 0) return { party, lines: [] };
  const lines: string[] = [];
  let sheets = party.sheets;
  for (let m = 0; m < mornings; m++) {
    lines.push('A new day.');
    sheets = Object.fromEntries(Object.entries(sheets).map(([id, s]) => [id, s.dead ? s : morning(s, lines)]));
  }
  return { party: { ...party, sheets }, lines };
}
