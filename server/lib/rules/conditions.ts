/**
 * The SRD 5.2 conditions, and the ones a hero carries outside a fight with how each ends: after a time
 * (seconds of game time), at a Long Rest, on a successful save, or by breaking free with a check. Combat
 * reads the same list (combatant.ts) and adds its own short-lived ones.
 */
import { z } from 'zod';
import type { CharacterSheet } from './sheet.ts';

export const CONDITIONS = [
  'blinded', 'charmed', 'deafened', 'exhaustion', 'frightened', 'grappled', 'incapacitated', 'invisible',
  'paralyzed', 'petrified', 'poisoned', 'prone', 'restrained', 'stunned', 'unconscious',
] as const;
export type Condition = (typeof CONDITIONS)[number];

const ability = z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']);
const dc = z.number().int().min(1).max(30);
export const TimedConditionSchema = z.object({
  condition: z.enum(CONDITIONS),
  until: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('time'), left: z.number().int().positive() }),
    z.object({ kind: z.literal('long-rest') }),
    z.object({ kind: z.literal('save'), ability, dc }),
    z.object({ kind: z.literal('escape'), ability, skill: z.string(), dc }),
  ]),
});
export type TimedCondition = z.infer<typeof TimedConditionSchema>;

export const conditionsOf = (sheet: CharacterSheet): TimedCondition[] => sheet.conditions ?? [];
export const hasCondition = (sheet: CharacterSheet, condition: Condition): boolean => conditionsOf(sheet).some((c) => c.condition === condition);

const withList = (sheet: CharacterSheet, list: TimedCondition[]): CharacterSheet => {
  const { conditions: _, ...rest } = sheet;
  return list.length ? { ...rest, conditions: list } : rest;
};

/** Gains the condition; one already there is replaced (the new one says how it ends). */
export const withCondition = (sheet: CharacterSheet, timed: TimedCondition): CharacterSheet =>
  withList(sheet, [...conditionsOf(sheet).filter((c) => c.condition !== timed.condition), timed]);

export const withoutCondition = (sheet: CharacterSheet, condition: Condition): CharacterSheet =>
  withList(sheet, conditionsOf(sheet).filter((c) => c.condition !== condition));

/** Timed conditions wear down by `seconds`; those that run out end. */
export function letTimePass(sheet: CharacterSheet, seconds: number): { sheet: CharacterSheet; ended: Condition[] } {
  const ended: Condition[] = [];
  const kept = conditionsOf(sheet).flatMap((c): TimedCondition[] => {
    if (c.until.kind !== 'time') return [c];
    if (c.until.left > seconds) return [{ ...c, until: { kind: 'time', left: c.until.left - seconds } }];
    ended.push(c.condition);
    return [];
  });
  return { sheet: withList(sheet, kept), ended };
}

export const endOnLongRest = (sheet: CharacterSheet): CharacterSheet =>
  withList(sheet, conditionsOf(sheet).filter((c) => c.until.kind !== 'long-rest'));
