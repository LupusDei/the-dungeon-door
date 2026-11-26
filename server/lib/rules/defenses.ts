/**
 * A hero's damage resistances (SRD 5.2), from species traits: Dwarven Resilience (poison), a dragonborn's
 * Draconic Damage Resistance and a tiefling's Fiendish Legacy resistance. Resisted damage is halved, rounded
 * down. Monsters' resistances, immunities and vulnerabilities come from their stat blocks (monsters.ts).
 */
import type { CharacterSheet } from './sheet.ts';

const BY_TRAIT: readonly [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^dwarven-resilience$/, () => 'poison'],
  [/^(?:draconic-damage-resistance|lineage-resistance)-(\w+)$/, (m) => m[1]],
];

export function heroResistances(sheet: CharacterSheet): string[] {
  return sheet.traits.flatMap((t) => BY_TRAIT.flatMap(([re, type]) => {
    const m = t.match(re);
    return m ? [type(m)] : [];
  }));
}

export const resisted = (sheet: CharacterSheet, amount: number, type: string): number =>
  (heroResistances(sheet).includes(type) ? Math.floor(amount / 2) : amount);
