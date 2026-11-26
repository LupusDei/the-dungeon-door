/**
 * The CharacterSheet: the rules side of a hero (the story side is lib/types.ts `Character`). It is plain
 * JSON with a version, so the server can store it and check it again when it comes back.
 */
import { z } from 'zod';
import { ABILITIES } from './abilities.ts';
import { RuleViolation } from './violation.ts';

const int = z.number().int();
const ability = z.enum(ABILITIES);
const score = int.min(1).max(30);
const perAbility = <T extends z.ZodType>(value: T) => z.object({ str: value, dex: value, con: value, int: value, wis: value, cha: value });

export const CharacterSheetSchema = z.object({
  version: z.literal(1),
  name: z.string().trim().min(1).max(40),
  level: z.literal(1),
  classId: z.string(),
  speciesId: z.string(),
  backgroundId: z.string(),
  size: z.enum(['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan']),
  speed: int.positive(),
  abilityScores: perAbility(score),
  /** The six 4d6-drop-lowest results in roll order, when the scores were rolled. */
  abilityRolls: z.array(int).length(6).nullable(),
  proficiencyBonus: int,
  maxHp: int.positive(),
  hp: int.min(0),
  armorClass: int,
  savingThrows: z.array(ability),
  /** Skill ids ("stealth") the hero is proficient in. */
  skills: z.array(z.string()),
  /** Armor, weapon and tool proficiencies by SRD id. */
  otherProficiencies: z.array(z.string()),
  saveBonuses: perAbility(int),
  /** Every skill's check bonus, proficient or not. */
  skillBonuses: z.record(z.string(), int),
  passivePerception: int,
  equipment: z.array(z.object({ id: z.string(), name: z.string(), count: int.positive() })),
  gp: z.number().min(0),
  /** Choices inside equipment options the engine leaves to the player or DM ("one of Gaming Sets"). */
  pendingChoices: z.array(z.string()),
  /** Species trait ids; only the ones the engine models change numbers. */
  traits: z.array(z.string()),
  /** The background's origin feat, by name (not modelled yet). */
  feat: z.string(),
  spellcasting: z.object({
    ability,
    saveDc: int,
    attackBonus: int,
    /** Slots per spell level, 1st through 9th. */
    slots: z.array(int.min(0)).length(9),
    cantrips: z.array(z.string()),
    prepared: z.array(z.string()),
  }).nullable(),
}).refine((s) => s.hp <= s.maxHp, { path: ['hp'], message: 'hit points cannot exceed the maximum' });

export type CharacterSheet = z.infer<typeof CharacterSheetSchema>;

/** Checks a stored or submitted sheet; a bad one throws RuleViolation naming the first bad field. */
export function parseCharacterSheet(json: unknown): CharacterSheet {
  const parsed = CharacterSheetSchema.safeParse(json);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  throw new RuleViolation(`${issue.path.join('.')}: ${issue.message}`);
}
