/**
 * Ability checks (SRD 5.2): d20 + ability modifier, + the skill bonus when a skill applies (proficiency,
 * doubled by Expertise), + proficiency for a tool the hero is proficient with (and Advantage when the
 * skill applies too). Exhaustion costs 2 a level. Passive scores are 10 + the bonus, ±5 for Advantage or
 * Disadvantage. 5.2 has no contests: a check against a creature uses its passive score as the DC.
 */
import { type Ability, abilityModifier } from './abilities.ts';
import { exhaustionEffects } from './rests.ts';
import { type D20, type Mode, modeOf, rollD20 } from './resolve.ts';
import type { Rng } from './rng.ts';
import type { CharacterSheet } from './sheet.ts';

export interface CheckSpec { ability: Ability; skill?: string | null; tool?: string | null }
export interface CheckOptions { advantage?: boolean; disadvantage?: boolean; natural?: number }
export interface Check extends D20 { bonus: number; mode: Mode }

const hasTool = (sheet: CharacterSheet, tool: string) =>
  sheet.otherProficiencies.includes(tool) || sheet.otherProficiencies.includes(`tool-${tool}`);

export function checkBonus(sheet: CharacterSheet, spec: CheckSpec): { bonus: number; advantage: boolean } {
  const skilled = !!spec.skill && Object.hasOwn(sheet.skillBonuses, spec.skill);
  const proficientSkill = skilled && sheet.skills.includes(spec.skill!);
  const tool = !!spec.tool && hasTool(sheet, spec.tool);
  const base = skilled ? sheet.skillBonuses[spec.skill!] : abilityModifier(sheet.abilityScores[spec.ability]);
  const toolBonus = tool && !proficientSkill ? sheet.proficiencyBonus : 0;
  return { bonus: base + toolBonus + exhaustionEffects(sheet).d20, advantage: tool && proficientSkill };
}

export function abilityCheck(rng: Rng, sheet: CharacterSheet, spec: CheckSpec, options: CheckOptions = {}): Check {
  const { bonus, advantage } = checkBonus(sheet, spec);
  const mode = modeOf(advantage || !!options.advantage, !!options.disadvantage);
  return { ...rollD20(rng, bonus, mode, options.natural), bonus, mode };
}

const PASSIVE_SHIFT: Readonly<Record<Mode, number>> = { normal: 0, advantage: 5, disadvantage: -5 };

export const passiveScore = (sheet: CharacterSheet, spec: CheckSpec, mode: Mode = 'normal'): number =>
  10 + checkBonus(sheet, spec).bonus + PASSIVE_SHIFT[mode];
