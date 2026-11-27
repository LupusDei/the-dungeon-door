/**
 * The CharacterSheet: the rules side of a hero (the story side is lib/types.ts `Character`). It is plain
 * JSON with a version, so the server can store it and check it again when it comes back.
 */
import { z } from 'zod';
import { ABILITIES } from './abilities.ts';
import { TimedConditionSchema } from './conditions.ts';
import { RuleViolation } from './violation.ts';

const int = z.number().int();
export const MAX_LEVEL = 20;
export const MAX_EXHAUSTION = 6;
const ability = z.enum(ABILITIES);
const score = int.min(1).max(30);

/** The player's placement of a background's ability increases (SRD 5.2): +2 and +1, or +1 to each of the three. */
export const AbilityBoostSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('twoOne'), plusTwo: ability, plusOne: ability }),
  z.object({ kind: z.literal('oneOneOne') }),
]);
const perAbility = <T extends z.ZodType>(value: T) => z.object({ str: value, dex: value, con: value, int: value, wis: value, cha: value });

export const CharacterSheetSchema = z.object({
  version: z.literal(1),
  name: z.string().trim().min(1).max(40),
  level: int.min(1).max(MAX_LEVEL),
  xp: int.min(0),
  classId: z.string(),
  speciesId: z.string(),
  backgroundId: z.string(),
  subclassId: z.string().nullable(),
  size: z.enum(['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan']),
  speed: int.positive(),
  abilityScores: perAbility(score),
  /**
   * The player's placement of the background's ability increases. Absent when the server placed them
   * and the player has not chosen (the scores are still that placement while `bonusesOpen` is true).
   */
  abilityBoost: AbilityBoostSchema.optional(),
  /** The six 4d6-drop-lowest results in roll order, when the scores were rolled. */
  abilityRolls: z.array(int).length(6).nullable(),
  proficiencyBonus: int,
  /** The hit die result for each level, level 1's being the die's maximum; max HP is derived from them. */
  hpRolls: z.array(int.positive()),
  /** Hit Point Dice spent since they were last regained (the hero has one per level). */
  hitDiceSpent: int.min(0),
  /** SRD 5.2 Exhaustion level; the hero dies at 6. */
  exhaustion: int.min(0).max(MAX_EXHAUSTION),
  /** Uses spent of limited class features, by resource id ("rage", "second-wind"). */
  resourcesUsed: z.record(z.string(), int.min(0)),
  maxHp: int.positive(),
  hp: int.min(0),
  armorClass: int,
  savingThrows: z.array(ability),
  /** Skill ids ("stealth") the hero is proficient in. */
  skills: z.array(z.string()),
  /** Armor, weapon and tool proficiencies by SRD id. */
  otherProficiencies: z.array(z.string()),
  saveBonuses: perAbility(int),
  /** Skills with Expertise (twice the proficiency bonus); filled in by rederive as features grant it. */
  expertise: z.array(z.string()).optional(),
  /** The hero died (three failed death saves, massive damage or exhaustion 6) and stays dead until revived. */
  dead: z.boolean().optional(),
  /** The game clock (seconds, play/time.ts) at the start of the turn it died: Raise Dead reaches back 10 days. */
  diedAt: z.number().int().nonnegative().optional(),
  /** Days in a row without food (play/provisions.ts); absent: 0. */
  hungry: z.number().int().nonnegative().optional(),
  /** Raised from the dead (Raise Dead): this much off every D20 Test, one less after each Long Rest (5.2). */
  revivalPenalty: int.min(0).max(4).optional(),
  /** Conditions the hero carries outside a fight, each with how it ends (conditions.ts). */
  conditions: z.array(TimedConditionSchema).optional(),
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
  /** Feats taken when leveling, by SRD id. */
  feats: z.array(z.string()),
  /** Class and subclass features gained so far, by name, in the order gained. */
  features: z.array(z.string()),
  spellcasting: z.object({
    ability,
    saveDc: int,
    attackBonus: int,
    /** Slots per spell level, 1st through 9th. */
    slots: z.array(int.min(0)).length(9),
    cantrips: z.array(z.string()),
    prepared: z.array(z.string()),
    /** Slots spent per spell level since they were last regained. */
    expended: z.array(int.min(0)).length(9),
    /** The spell the caster is concentrating on, if any. */
    concentratingOn: z.string().nullable(),
  }).refine((c) => c.expended.every((n, i) => n <= c.slots[i]), { path: ['expended'], message: 'no more slots can be spent than there are' }).nullable(),
})
  .refine((s) => s.hp <= s.maxHp, { path: ['hp'], message: 'hit points cannot exceed the maximum' })
  .refine((s) => s.hpRolls.length === s.level, { path: ['hpRolls'], message: 'one hit die roll per level' })
  .refine((s) => s.hitDiceSpent <= s.level, { path: ['hitDiceSpent'], message: "no more hit dice can be spent than the hero's level" });

export type CharacterSheet = z.infer<typeof CharacterSheetSchema>;

/** Checks a stored or submitted sheet; a bad one throws RuleViolation naming the first bad field. */
export function parseCharacterSheet(json: unknown): CharacterSheet {
  const parsed = CharacterSheetSchema.safeParse(json);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  throw new RuleViolation(`${issue.path.join('.')}: ${issue.message}`);
}
