/**
 * Damage to a hero outside combat (SRD 5.2 Dropping to 0 Hit Points): HP stops at 0 and the hero is
 * dying; when the damage left over reaches their Hit Point maximum they die outright (massive damage).
 * In combat the same rules live in resolve.ts takeDamage, with death saves; play/dying.ts settles both.
 */
import type { CharacterSheet } from './sheet.ts';

export function damageHero(sheet: CharacterSheet, amount: number): CharacterSheet {
  if (amount <= 0) return sheet;
  const over = amount - sheet.hp;
  if (over < 0) return { ...sheet, hp: -over };
  return over >= sheet.maxHp ? { ...sheet, hp: 0, dead: true } : { ...sheet, hp: 0 };
}
