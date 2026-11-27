/**
 * The d20 a player throws. The server rolls it when they declare and keeps the face hidden
 * until they throw, or until the choice window ends (play/turn-clock.ts). Damage dice stay
 * with the engine: a hit is not known until this d20 lands.
 */
import { ABILITIES, type Ability } from '../rules/abilities.ts';
import { heroCombatant, type Attack } from '../rules/combatant.ts';
import { checkBonus } from '../rules/checks.ts';
import type { CharacterSheet } from '../rules/sheet.ts';
import { type SrdSpell, srd } from '../rules/srd.ts';
import type { LegalAction } from '../types.ts';
import type { CheckRuling } from './actions.ts';

export interface PlayerDie {
  /** Always 20. The face is the vote's d20. */
  sides: 20;
  modifier: number;
  /** "d20+5", "d20-1", or "d20". */
  formula: string;
  /** What the throw is for: "Athletics", "Attack with Longsword". */
  purpose: string;
}

export const dieFormula = (modifier: number): string =>
  (modifier === 0 ? 'd20' : modifier > 0 ? `d20+${modifier}` : `d20${modifier}`);

export const dieSpec = (purpose: string, modifier: number): PlayerDie =>
  ({ sides: 20, modifier, formula: dieFormula(modifier), purpose });

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function attackIds(attacks: readonly Attack[]): string[] {
  const seen = new Map<string, number>();
  return attacks.map((a) => {
    const base = `attack:${slug(a.name)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  });
}

const titled = (skill: string) => skill.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

/** A check the player wrote or picked. The modifier is the one the engine adds to their d20. */
export function dieForCheck(sheet: CharacterSheet, ruling: CheckRuling, purpose?: string): PlayerDie {
  const bonus = checkBonus(sheet, { ability: ruling.ability, skill: ruling.skill }).bonus;
  const name = purpose ?? (ruling.skill ? titled(ruling.skill) : ruling.ability.toUpperCase());
  return dieSpec(name, bonus);
}

const spellOf = (id: string): SrdSpell | undefined => srd().spells.get(id.startsWith('spell:') ? id.slice('spell:'.length) : id);

/**
 * The throw this action asks for, or null when the engine does not need the player's d20
 * (Dodge, a Dash, a potion, a spell the target saves against).
 */
export function dieForAction(sheet: CharacterSheet, action: Pick<LegalAction, 'id' | 'kind' | 'label'>): PlayerDie | null {
  if (action.kind === 'skill') {
    const id = action.id.slice('skill:'.length);
    const ability = srd().skills.get(id);
    if (!ability) return null;
    return dieSpec(action.label, checkBonus(sheet, { ability, skill: id }).bonus);
  }
  if (action.kind === 'ability') {
    const id = action.id.slice('ability:'.length);
    if (!(ABILITIES as readonly string[]).includes(id)) return null;
    return dieSpec(action.label, checkBonus(sheet, { ability: id as Ability }).bonus);
  }
  if (action.kind === 'attack' || action.id === 'common:attack') {
    const attacks = heroCombatant('hero', sheet).attacks;
    const weapon = action.id === 'common:attack'
      ? attacks.reduce<Attack | undefined>((best, a) => (!best || a.bonus > best.bonus ? a : best), undefined)
      : attacks[attackIds(attacks).indexOf(action.id)];
    return dieSpec(action.label, weapon?.bonus ?? 0);
  }
  if (action.kind === 'spell') {
    const spell = spellOf(action.id);
    if (!spell?.attack || !sheet.spellcasting) return null;
    return dieSpec(action.label, sheet.spellcasting.attackBonus);
  }
  return null;
}

/** True while the player still has to throw. Absent `revealed` means the roll was never hidden. */
export const rollPending = (vote: { die?: PlayerDie; revealed?: boolean }): boolean =>
  vote.die != null && vote.revealed === false;
