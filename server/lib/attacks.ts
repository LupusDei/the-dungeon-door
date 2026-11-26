/**
 * What a hero can attack with, worked out from its sheet for the app (docs/api.md, Attack): its weapons
 * with the engine's own to-hit and damage, then every cantrip and prepared spell that deals damage in a
 * way a fight can resolve (an attack roll or a saving throw). Derived on every read; never stored.
 */
import { heroCombatant } from './rules/combatant.ts';
import type { CharacterSheet } from './rules/sheet.ts';
import { beamsAt, spellDamageDice } from './rules/spells.ts';
import { type SrdSpell, srd } from './rules/srd.ts';

export interface AttackView {
  name: string;
  /** Added to the d20 to hit; 0 for a spell the target saves against. */
  bonus: number;
  /** "2d6+3 slashing", "2 × 1d10 force". */
  damage: string;
  ranged: boolean;
  kind: 'weapon' | 'spell';
  /** Spells only: the save the target makes instead of the hero rolling to hit. */
  save: string | null;
}

/** A spell a fight can resolve: it deals damage, by a spell attack or a save. */
export const fightsWith = (spell: SrdSpell): boolean => spell.damage !== null && (spell.attack !== null || spell.save !== null);

/** The damage of a cast at the spell's own level: "1d10 fire", or "2 × 1d10 force" for separate beams. */
export function spellDamage(spell: SrdSpell, characterLevel: number): string {
  const dice = spellDamageDice(spell, spell.level, characterLevel)!;
  const beams = beamsAt(spell, characterLevel);
  return `${beams > 1 ? `${beams} × ` : ''}${dice} ${spell.damage!.type}`;
}

function spellAttacks(sheet: CharacterSheet): AttackView[] {
  const casting = sheet.spellcasting;
  if (!casting) return [];
  return [...casting.cantrips, ...casting.prepared]
    .map((id) => srd().spells.get(id))
    .filter((spell): spell is SrdSpell => spell !== undefined && fightsWith(spell))
    .map((spell) => ({
      name: spell.name,
      bonus: spell.attack ? casting.attackBonus : 0,
      damage: spellDamage(spell, sheet.level),
      ranged: spell.attack !== 'melee',
      kind: 'spell' as const,
      save: spell.attack ? null : spell.save,
    }));
}

export function heroAttacks(sheet: CharacterSheet): AttackView[] {
  const weapons = heroCombatant('hero', sheet).attacks.map((a): AttackView => ({
    name: a.name, bonus: a.bonus, damage: a.damage.map((d) => `${d.dice} ${d.type}`).join(' + '), ranged: a.ranged, kind: 'weapon', save: null,
  }));
  return [...weapons, ...spellAttacks(sheet)];
}
