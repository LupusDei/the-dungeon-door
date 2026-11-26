/**
 * Coming back from the dead (SRD 5.2): Revivify (level 3, a 300 GP diamond, dead no more than a minute) and
 * Raise Dead (level 5, a 500 GP diamond, dead no more than 10 days; the target takes -4 on D20 Tests, one less
 * after each Long Rest). A temple casts Raise Dead as a spellcasting service: 2,000 GP for a level-5 spell.
 */
import type { CharacterSheet } from './sheet.ts';
import { slotsLeft } from './spells.ts';
import { srd } from './srd.ts';
import { require } from './violation.ts';

export type Revival = 'revivify' | 'raise-dead';
/** The diamond each spell consumes, in GP. */
export const DIAMOND: Readonly<Record<Revival, number>> = { revivify: 300, 'raise-dead': 500 };
/** A temple's Raise Dead: the service (a level-5 spell) and its diamond. */
export const TEMPLE_RAISE_DEAD = 2000 + DIAMOND['raise-dead'];
const REVIVAL_PENALTY = 4;

/** Whether the hero can cast `spellId` now: standing, prepared, and a slot of its level or higher left. */
export function canCast(sheet: CharacterSheet, spellId: string): boolean {
  if (sheet.dead || sheet.hp === 0 || !sheet.spellcasting || !sheet.spellcasting.prepared.includes(spellId)) return false;
  return slotsLeft(sheet).slice(srd().spells.get(spellId)!.level - 1).some((n) => n > 0);
}

/** The dead hero lives again with 1 HP; Raise Dead leaves its ordeal, -4 on D20 Tests. */
export function revive(sheet: CharacterSheet, how: Revival): CharacterSheet {
  require(sheet.dead === true, `${sheet.name} is not dead`);
  const { dead: _, ...alive } = sheet;
  return { ...alive, hp: 1, ...(how === 'raise-dead' ? { revivalPenalty: REVIVAL_PENALTY } : {}) };
}
