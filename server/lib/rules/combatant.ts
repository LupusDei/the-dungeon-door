/** Heroes and monsters in one shape for combat. A Combatant is plain JSON, stored inside the combat state. */
import { type Ability, abilityModifier } from './abilities.ts';
import type { DamageRoll, Monster } from './monsters.ts';
import { heroResistances } from './defenses.ts';
import { d20Modifier } from './rests.ts';
import type { CharacterSheet } from './sheet.ts';
import { type Srd, type SrdWeapon, srd as bundledSrd } from './srd.ts';

export const CONDITIONS = [
  'blinded', 'charmed', 'deafened', 'exhaustion', 'frightened', 'grappled', 'incapacitated', 'invisible',
  'paralyzed', 'petrified', 'poisoned', 'prone', 'restrained', 'stunned', 'unconscious',
] as const;
export type Condition = (typeof CONDITIONS)[number];

export interface Attack { name: string; bonus: number; ranged: boolean; damage: DamageRoll[] }

/** up: fighting. dying: a hero at 0 HP making death saves. stable: at 0 HP, not dying. dead. */
export type Status = 'up' | 'dying' | 'stable' | 'dead';

export interface Combatant {
  id: string;
  name: string;
  side: 'party' | 'foes';
  ac: number;
  hp: number;
  maxHp: number;
  /** Added to the initiative d20 (the DEX modifier). */
  initiative: number;
  saveBonuses: Record<Ability, number>;
  attacks: Attack[];
  resistances: string[];
  vulnerabilities: string[];
  immunities: string[];
  conditionImmunities: string[];
  conditions: Condition[];
  deathSaves: { successes: number; failures: number };
  status: Status;
  /** What defeating it is worth (monsters); 0 for heroes. */
  xp: number;
  /** Undead, constructs and oozes: they never break (no morale check). Monsters only. */
  fearless?: true;
}

const FEARLESS = /undead|construct|ooze/;

/** "1d8" with a modifier, written the way the SRD writes it: "1d8+3", "1d8", "1d8-1". */
function withModifier(dice: string, modifier: number): string {
  if (modifier < 0) return `${dice}${modifier}`;
  return modifier > 0 ? `${dice}+${modifier}` : dice;
}

function weaponAttack(weapon: SrdWeapon, sheet: CharacterSheet): Attack {
  const str = abilityModifier(sheet.abilityScores.str);
  const dex = abilityModifier(sheet.abilityScores.dex);
  const melee = weapon.properties.includes('finesse') ? Math.max(str, dex) : str;
  const modifier = weapon.range === 'ranged' ? dex : melee;
  const proficient = [`${weapon.category}-weapons`, `${weapon.id}s`].some((p) => sheet.otherProficiencies.includes(p));
  return {
    name: weapon.name,
    bonus: modifier + (proficient ? sheet.proficiencyBonus : 0),
    ranged: weapon.range === 'ranged',
    damage: [{ dice: withModifier(weapon.damage, modifier), type: weapon.damageType }],
  };
}

function unarmedStrike(sheet: CharacterSheet): Attack {
  const str = abilityModifier(sheet.abilityScores.str);
  return { name: 'Unarmed Strike', bonus: str + sheet.proficiencyBonus, ranged: false, damage: [{ dice: String(Math.max(0, 1 + str)), type: 'bludgeoning' }] };
}

/** The combat-only fields every combatant starts with. */
const fresh = (): Pick<Combatant, 'conditions' | 'deathSaves' | 'status'> => ({ conditions: [], deathSaves: { successes: 0, failures: 0 }, status: 'up' });

export function heroCombatant(id: string, sheet: CharacterSheet, data: Srd = bundledSrd()): Combatant {
  const weapons = sheet.equipment.map((i) => data.weapons.get(i.id)).filter((w) => w !== undefined);
  const attacks = weapons.map((w) => weaponAttack(w, sheet));
  const worn = d20Modifier(sheet); // exhaustion and a revival's penalty hit every D20 Test
  const saveBonuses = Object.fromEntries(Object.entries(sheet.saveBonuses).map(([a, n]) => [a, n + worn])) as Record<Ability, number>;
  return {
    id, name: sheet.name, side: 'party', ac: sheet.armorClass, hp: sheet.hp, maxHp: sheet.maxHp,
    initiative: abilityModifier(sheet.abilityScores.dex) + worn, saveBonuses,
    attacks: (attacks.length > 0 ? attacks : [unarmedStrike(sheet)]).map((a) => ({ ...a, bonus: a.bonus + worn })),
    resistances: heroResistances(sheet), vulnerabilities: [], immunities: [], conditionImmunities: [],
    ...fresh(), xp: 0,
  };
}

export function monsterCombatant(id: string, m: Monster): Combatant {
  return {
    id, name: m.name, side: 'foes', ac: m.ac, hp: m.hp, maxHp: m.hp,
    initiative: abilityModifier(m.abilities.dex), saveBonuses: { ...m.saveBonuses }, attacks: m.attacks,
    resistances: m.resistances, vulnerabilities: m.vulnerabilities, immunities: m.immunities, conditionImmunities: m.conditionImmunities,
    ...fresh(), xp: m.xp, ...(FEARLESS.test(m.type) ? { fearless: true as const } : {}),
  };
}
