/**
 * Limited class features (Rage, Channel Divinity, Focus Points, Second Wind, Action Surge, Bardic
 * Inspiration, Wild Shape, Sorcery Points, Lay On Hands, Arcane Recovery, Magical Cunning): how many uses
 * the hero has, from its class table; what is spent, on the sheet; and what a rest gives back, from each
 * feature's own text (srd.ts reads it). See docs/rules-design.md.
 */
import { abilityModifier } from './abilities.ts';
import type { CharacterSheet } from './sheet.ts';
import { type ShortRestRecharge, type Srd, srd as bundledSrd } from './srd.ts';
import { require } from './violation.ts';

export interface Resource { id: string; name: string; max: number; used: number; left: number; shortRest: ShortRestRecharge }

interface Definition {
  id: string;
  classId: string;
  /** The class feature that grants it, by name. */
  feature: string;
  max: (sheet: CharacterSheet, counts: Readonly<Record<string, number>>) => number;
  /** A later feature that changes what a Short Rest gives back (Font of Inspiration). */
  upgradedBy?: string;
}

/** A number from the class table; every level of the class has it (0 before the feature arrives). */
const count = (key: string) => (_: CharacterSheet, counts: Readonly<Record<string, number>>) => counts[key];
const LAY_ON_HANDS_PER_LEVEL = 5;

/** The table order is the order resources are listed in. */
const DEFINITIONS: readonly Definition[] = [
  { id: 'rage', classId: 'barbarian', feature: 'Rage', max: count('rageCount') },
  { id: 'bardic-inspiration', classId: 'bard', feature: 'Bardic Inspiration', max: (s) => Math.max(1, abilityModifier(s.abilityScores.cha)), upgradedBy: 'Font of Inspiration' },
  { id: 'channel-divinity', classId: 'cleric', feature: 'Channel Divinity', max: count('channelDivinityCharges') },
  { id: 'wild-shape', classId: 'druid', feature: 'Wild Shape', max: count('wildShapeUses') },
  { id: 'second-wind', classId: 'fighter', feature: 'Second Wind', max: count('secondWindUses') },
  /** The fighter gains Action Surge at 2 and again (a second use) at 17. */
  { id: 'action-surge', classId: 'fighter', feature: 'Action Surge', max: (s) => s.features.filter((f) => f === 'Action Surge').length },
  { id: 'focus', classId: 'monk', feature: "Monk's Focus", max: count('focusPoints') },
  { id: 'lay-on-hands', classId: 'paladin', feature: 'Lay On Hands', max: (s) => LAY_ON_HANDS_PER_LEVEL * s.level },
  { id: 'channel-divinity', classId: 'paladin', feature: 'Channel Divinity', max: count('channelDivinityCharges') },
  { id: 'sorcery-points', classId: 'sorcerer', feature: 'Font of Magic', max: count('sorceryPoints') },
  { id: 'magical-cunning', classId: 'warlock', feature: 'Magical Cunning', max: () => 1 },
  { id: 'arcane-recovery', classId: 'wizard', feature: 'Arcane Recovery', max: () => 1 },
];

function shortRestOf(sheet: CharacterSheet, def: Definition, data: Srd): ShortRestRecharge {
  const name = def.upgradedBy && sheet.features.includes(def.upgradedBy) ? def.upgradedBy : def.feature;
  return data.classes.get(sheet.classId)!.levels.flatMap((l) => l.features).find((f) => f.name === name)!.shortRest;
}

/** The hero's limited features: those its class has given it so far, with uses left. */
export function resourcesOf(sheet: CharacterSheet, data: Srd = bundledSrd()): Resource[] {
  const counts = data.classes.get(sheet.classId)!.levels[sheet.level - 1].counts;
  return DEFINITIONS
    .filter((def) => def.classId === sheet.classId && sheet.features.includes(def.feature))
    .map((def) => {
      const max = def.max(sheet, counts);
      const used = sheet.resourcesUsed[def.id] ?? 0;
      return { id: def.id, name: def.feature, max, used, left: max - used, shortRest: shortRestOf(sheet, def, data) };
    })
    .filter((r) => r.max > 0);
}

/** Spends `amount` uses (points, for a pool like Lay On Hands or Focus). */
export function useResource(sheet: CharacterSheet, id: string, amount = 1, data: Srd = bundledSrd()): CharacterSheet {
  require(amount >= 1, 'use at least 1');
  const resource = resourcesOf(sheet, data).find((r) => r.id === id);
  require(resource !== undefined, `${sheet.name} has no ${id}`);
  require(resource.left >= amount, `${sheet.name} has no ${resource.name} left`);
  return { ...sheet, resourcesUsed: { ...sheet.resourcesUsed, [id]: resource.used + amount } };
}

const RECOVERED: Readonly<Record<ShortRestRecharge, (used: number) => number>> = {
  one: (used) => Math.max(0, used - 1),
  all: () => 0,
  none: (used) => used,
};

/** What a rest gives back: on a Long Rest, everything; on a Short Rest, what each feature says. */
export function rechargeResources(sheet: CharacterSheet, rest: 'short' | 'long', data: Srd = bundledSrd()): CharacterSheet {
  if (rest === 'long') return { ...sheet, resourcesUsed: {} };
  const used = resourcesOf(sheet, data).map((r) => [r.id, RECOVERED[r.shortRest](r.used)]);
  return { ...sheet, resourcesUsed: Object.fromEntries(used.filter(([id]) => id in sheet.resourcesUsed)) };
}
