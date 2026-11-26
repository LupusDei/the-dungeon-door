/**
 * Spellcasting on the sheet: preparing spells, casting (slots, upcasting, pact slots, cantrip scaling)
 * and concentration. Resolving a cast against targets is spellEffects.ts. See docs/rules-design.md.
 */
import { requireSpells } from './character.ts';
import type { CharacterSheet } from './sheet.ts';
import { type Srd, type SrdSpell, srd as bundledSrd } from './srd.ts';
import { lookup, require } from './violation.ts';

type Spellcasting = NonNullable<CharacterSheet['spellcasting']>;

/** What a cast produced, for spellEffects to resolve and the DM to narrate. */
export interface Cast {
  spellId: string;
  /** 0 for a cantrip. */
  slotLevel: number;
  /** Damage per target (per beam for Eldritch Blast), after cantrip scaling or upcasting. */
  damageDice: string | null;
  /** Separate attacks the spell makes (Eldritch Blast's beams); 1 for most. */
  beams: number;
  /** Hit points regained, before the caster's spellcasting modifier is added. */
  healingDice: string | null;
  /** The spell whose concentration this cast ended, if any. */
  endedConcentration: string | null;
}

const SLOT_LEVELS = 9;
const CONCENTRATION_DC = { min: 10, max: 30 };

/** The highest spell level with a slot (0 when there are none). */
export const maxSpellLevel = (slots: readonly number[]): number => slots.findLastIndex((n) => n > 0) + 1;

export const slotsLeft = (sheet: CharacterSheet): number[] =>
  sheet.spellcasting ? sheet.spellcasting.slots.map((n, i) => n - sheet.spellcasting!.expended[i]) : [];

function castingOf(sheet: CharacterSheet): Spellcasting {
  require(sheet.spellcasting !== null, `${sheet.name} casts no spells`);
  return sheet.spellcasting;
}

/**
 * Replaces the hero's cantrips and prepared spells: as many of each as its class and level allow, from
 * its class list, and no higher than its highest slot level.
 */
export function prepareSpells(sheet: CharacterSheet, cantrips: readonly string[], prepared: readonly string[], data: Srd = bundledSrd()): CharacterSheet {
  const casting = castingOf(sheet);
  const counts = data.spellcasting.get(sheet.classId)!.byLevel[sheet.level - 1];
  const cls = data.classes.get(sheet.classId)!;
  const max = maxSpellLevel(casting.slots);
  const onList = (low: number, high: number) => (id: string) => {
    const spell = data.spells.get(id);
    return spell !== undefined && spell.level >= low && spell.level <= high && spell.classes.includes(cls.id);
  };
  return {
    ...sheet,
    spellcasting: {
      ...casting,
      cantrips: requireSpells(cantrips, { count: counts.cantrips, noun: 'cantrips', list: `${cls.name} cantrip`, onList: onList(0, 0) }),
      prepared: requireSpells(prepared, { count: counts.prepared, noun: 'prepared spells', list: `${cls.name} spell of level 1 to ${max}`, onList: onList(1, max) }),
    },
  };
}

/** Separate attacks a spell makes at a character level: Eldritch Blast's beams grow; others make 1. */
export function beamsAt(spell: SrdSpell, characterLevel: number, data: Srd = bundledSrd()): number {
  const steps = (data.cantripScaling.get(spell.id) ?? []).filter((s) => s.beams !== null && s.level <= characterLevel);
  return steps.length > 0 ? steps[steps.length - 1].beams! : 1;
}

/** Separate strikes of a cast at a slot level: Magic Missile's darts (more for a higher slot), else its beams. */
export function strikesAt(spell: SrdSpell, slotLevel: number, characterLevel: number, data: Srd = bundledSrd()): number {
  return spell.darts ? spell.darts.count + spell.darts.perSlot * (slotLevel - spell.level) : beamsAt(spell, characterLevel, data);
}

const addDice = (base: string, extra: string, times: number) => {
  const [count, sides] = base.split('d').map(Number);
  return `${count + Number(extra.split('d')[0]) * times}d${sides}`;
};

/** The damage dice for a cast: a cantrip's by character level, a leveled spell's by slot level. */
export function spellDamageDice(spell: SrdSpell, slotLevel: number, characterLevel: number, data: Srd = bundledSrd()): string | null {
  if (!spell.damage) return null;
  if (spell.level === 0) {
    const steps = (data.cantripScaling.get(spell.id) ?? []).filter((s) => s.dice !== null && s.level <= characterLevel);
    return steps.length > 0 ? steps[steps.length - 1].dice! : spell.damage.dice;
  }
  return spell.upcastDice ? addDice(spell.damage.dice, spell.upcastDice, slotLevel - spell.level) : spell.damage.dice;
}

/** The healing dice for a cast at a slot level (the caster's spellcasting modifier is added on top). */
export function spellHealingDice(spell: SrdSpell, slotLevel: number): string | null {
  if (!spell.healing) return null;
  const { dice, upcastDice } = spell.healing;
  return upcastDice ? addDice(dice, upcastDice, slotLevel - spell.level) : dice;
}

/** The slot a leveled spell uses: the one asked for, or the lowest left at or above the spell's level. */
function slotFor(sheet: CharacterSheet, spell: SrdSpell, asked: number | undefined): number {
  const left = slotsLeft(sheet);
  if (asked === undefined) {
    const lowest = left.findIndex((n, i) => n > 0 && i + 1 >= spell.level);
    require(lowest >= 0, `${sheet.name} has no slot of level ${spell.level} or higher left`);
    return lowest + 1;
  }
  require(asked <= SLOT_LEVELS, `there are no level-${asked} slots`);
  require(asked >= spell.level, `${spell.id} is a level-${spell.level} spell`);
  require(left[asked - 1] > 0, `${sheet.name} has no level-${asked} slot left`);
  return asked;
}

function slotUsed(sheet: CharacterSheet, casting: Spellcasting, spell: SrdSpell, asked: number | undefined): number {
  if (spell.level === 0) {
    require(casting.cantrips.includes(spell.id), `${sheet.name} does not know the cantrip ${spell.id}`);
    require(asked === undefined, 'a cantrip uses no slot');
    return 0;
  }
  require(casting.prepared.includes(spell.id), `${sheet.name} has not prepared ${spell.id}`);
  return slotFor(sheet, spell, asked);
}

/**
 * Casts a known cantrip or a prepared spell: spends the slot (none for a cantrip), starts concentration
 * (ending any other), and works out its dice.
 */
export function castSpell(sheet: CharacterSheet, spellId: string, slotLevel?: number, data: Srd = bundledSrd()): { sheet: CharacterSheet; cast: Cast } {
  const casting = castingOf(sheet);
  const spell = lookup(data.spells, spellId, 'spell');
  const slot = slotUsed(sheet, casting, spell, slotLevel);
  const expended = casting.expended.map((n, i) => (i === slot - 1 ? n + 1 : n));
  const concentratingOn = spell.concentration ? spell.id : casting.concentratingOn;
  const cast: Cast = {
    spellId, slotLevel: slot, damageDice: spellDamageDice(spell, slot, sheet.level, data), beams: strikesAt(spell, slot, sheet.level, data),
    healingDice: spellHealingDice(spell, slot), endedConcentration: spell.concentration ? casting.concentratingOn : null,
  };
  return { sheet: { ...sheet, spellcasting: { ...casting, expended, concentratingOn } }, cast };
}

export function endConcentration(sheet: CharacterSheet): CharacterSheet {
  return sheet.spellcasting ? { ...sheet, spellcasting: { ...sheet.spellcasting, concentratingOn: null } } : sheet;
}

/** The Constitution save to keep concentrating after damage: half the damage, from 10 to 30 (SRD 5.2). */
export const concentrationDc = (damage: number): number =>
  Math.min(CONCENTRATION_DC.max, Math.max(CONCENTRATION_DC.min, Math.floor(damage / 2)));
