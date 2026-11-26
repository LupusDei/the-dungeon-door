/**
 * Rests (SRD 5.2): a Short Rest spends hit dice and recharges some features and a warlock's pact slots; a
 * Long Rest restores everything and removes one level of exhaustion. Also exhaustion itself, and the two
 * features that act at the end of a Short Rest: Arcane Recovery and Magical Cunning. See docs/rules-design.md.
 */
import { abilityModifier } from './abilities.ts';
import { endOnLongRest } from './conditions.ts';
import { rechargeResources, useResource } from './resources.ts';
import { maxSpellLevel } from './spells.ts';
import type { Rng } from './rng.ts';
import { type CharacterSheet, MAX_EXHAUSTION } from './sheet.ts';
import { type Srd, srd as bundledSrd } from './srd.ts';
import { require } from './violation.ts';

type Spellcasting = NonNullable<CharacterSheet['spellcasting']>;

const NO_SLOTS_SPENT = [0, 0, 0, 0, 0, 0, 0, 0, 0];
const ARCANE_RECOVERY_MAX_SLOT = 5;
const EXHAUSTION_D20 = -2;
const EXHAUSTION_SPEED = -5;

function requireConscious(sheet: CharacterSheet): void {
  require(sheet.hp >= 1, `${sheet.name} needs at least 1 hit point to rest`);
}

const isPactCaster = (sheet: CharacterSheet, data: Srd) => data.spellcasting.get(sheet.classId)?.casterType === 'pact';

const withCasting = (sheet: CharacterSheet, change: Partial<Spellcasting>): CharacterSheet =>
  sheet.spellcasting ? { ...sheet, spellcasting: { ...sheet.spellcasting, ...change } } : sheet;

export interface ShortRestResult { sheet: CharacterSheet; rolls: number[]; healed: number }

/** A Short Rest, spending `hitDice` of the hero's remaining hit dice to heal. */
export function shortRest(sheet: CharacterSheet, rng: Rng, { hitDice = 0 } = {}, data: Srd = bundledSrd()): ShortRestResult {
  requireConscious(sheet);
  require(hitDice >= 0, 'spend 0 or more hit dice');
  const left = sheet.level - sheet.hitDiceSpent;
  require(hitDice <= left, `${sheet.name} has ${left} hit ${left === 1 ? 'die' : 'dice'} left`);
  const sides = data.classes.get(sheet.classId)!.hitDie;
  const con = abilityModifier(sheet.abilityScores.con);
  const rolls = Array.from({ length: hitDice }, () => rng.die(sides));
  const healed = rolls.reduce((sum, roll) => sum + Math.max(1, roll + con), 0);
  const rested = rechargeResources({ ...sheet, hp: Math.min(sheet.maxHp, sheet.hp + healed), hitDiceSpent: sheet.hitDiceSpent + hitDice }, 'short', data);
  return { sheet: isPactCaster(sheet, data) ? withCasting(rested, { expended: NO_SLOTS_SPENT }) : rested, rolls, healed };
}

/** A Long Rest (SRD 5.2): every spent hit die comes back, not half of them as in 2014; a revival's penalty eases by 1. */
export function longRest(sheet: CharacterSheet, data: Srd = bundledSrd()): CharacterSheet {
  requireConscious(sheet);
  const rested = rechargeResources({
    ...endOnLongRest(sheet),
    hp: sheet.maxHp,
    hitDiceSpent: 0,
    exhaustion: Math.max(0, sheet.exhaustion - 1),
    ...(sheet.revivalPenalty ? { revivalPenalty: sheet.revivalPenalty - 1 } : {}),
  }, 'long', data);
  return withCasting(rested, { expended: NO_SLOTS_SPENT, concentratingOn: null });
}

export function gainExhaustion(sheet: CharacterSheet, levels = 1): CharacterSheet {
  require(levels >= 1, 'gain at least 1 exhaustion level');
  return { ...sheet, exhaustion: Math.min(MAX_EXHAUSTION, sheet.exhaustion + levels) };
}

/** Each level: -2 on every d20 test and -5 feet of speed. At level 6 the hero dies. */
export const exhaustionEffects = ({ exhaustion }: CharacterSheet) =>
  ({ d20: EXHAUSTION_D20 * exhaustion, speed: EXHAUSTION_SPEED * exhaustion, dead: exhaustion === MAX_EXHAUSTION });

/** The speed the hero moves at: its own, 5 ft less a level of exhaustion, never below 0. */
export const speedNow = (sheet: CharacterSheet): number => Math.max(0, sheet.speed + exhaustionEffects(sheet).speed);

/** What every D20 Test (attack, save, check, initiative) loses: exhaustion and a revival's ordeal (5.2). */
export const d20Modifier = ({ exhaustion, revivalPenalty = 0 }: CharacterSheet) => 0 - revivalPenalty + EXHAUSTION_D20 * exhaustion; // 0 - …: never -0

function regainSlots(sheet: CharacterSheet, slotLevels: readonly number[]): CharacterSheet {
  const expended = [...sheet.spellcasting!.expended];
  for (const level of slotLevels) {
    require(expended[level - 1] > 0, `${sheet.name} has no spent level-${level} slot to recover`);
    expended[level - 1] -= 1;
  }
  return withCasting(sheet, { expended });
}

/** Wizard, once per Long Rest after a Short Rest: spent slots totalling half the wizard level, rounded up. */
export function arcaneRecovery(sheet: CharacterSheet, slotLevels: readonly number[], data: Srd = bundledSrd()): CharacterSheet {
  require(slotLevels.length > 0, 'recover at least one slot');
  require(slotLevels.every((l) => l <= ARCANE_RECOVERY_MAX_SLOT), `Arcane Recovery restores no slot above level ${ARCANE_RECOVERY_MAX_SLOT}`);
  const budget = Math.ceil(sheet.level / 2);
  require(slotLevels.reduce((a, b) => a + b, 0) <= budget, `Arcane Recovery restores at most ${budget} levels of slots`);
  return regainSlots(useResource(sheet, 'arcane-recovery', 1, data), slotLevels);
}

/** Warlock, once per Long Rest: up to half its pact slots (rounded up) come back. */
export function magicalCunning(sheet: CharacterSheet, data: Srd = bundledSrd()): CharacterSheet {
  const used = useResource(sheet, 'magical-cunning', 1, data);
  const { slots, expended } = sheet.spellcasting!;
  /** Pact slots are all of one level. */
  const level = maxSpellLevel(slots);
  const regained = Math.min(expended[level - 1], Math.ceil(slots[level - 1] / 2));
  return regainSlots(used, Array(regained).fill(level));
}
