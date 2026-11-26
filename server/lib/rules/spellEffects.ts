/**
 * Resolving a cast against combatants, with PR B's resolver: spell attacks are attack rolls, save spells
 * are saving throws, healing heals. Targets are passed in; `targetsInRadius` picks them for the simple
 * radius shapes on a 5-foot grid. Concentration checks after damage. See docs/rules-design.md.
 */
import type { Combatant } from './combatant.ts';
import { parseDice, rollDice } from './dice.ts';
import { type AttackResult, type D20, type RollOptions, attackRoll, damageAfterDefenses, heal, savingThrow, takeDamage } from './resolve.ts';
import type { Rng } from './rng.ts';
import type { CharacterSheet } from './sheet.ts';
import { type Cast, concentrationDc } from './spells.ts';
import { type AreaShape, type Srd, type SrdSpell, srd as bundledSrd } from './srd.ts';
import { require } from './violation.ts';

export interface Caster { combatant: Combatant; saveDc: number; attackBonus: number; modifier: number }
export interface SpellOutcome { target: string; attack: AttackResult | null; save: { roll: D20 | null; success: boolean } | null; damage: number; healed: number }
export interface SpellRolls {
  /** For the spell attack: a voter's natural d20, advantage, cover. */
  attack?: RollOptions;
  /** For every target's saving throw. */
  save?: RollOptions;
  /** Foes not aimed at, that a dart or beam goes on to once its own target has fallen in the cast. */
  spare?: readonly Combatant[];
}
interface Resolved { outcomes: SpellOutcome[]; targets: Combatant[] }

const FEET_PER_SQUARE = 5;
const RADIAL: readonly AreaShape[] = ['Sphere', 'Cylinder', 'Emanation'];

export function casterOf(sheet: CharacterSheet, combatant: Combatant): Caster {
  require(sheet.spellcasting !== null, `${sheet.name} casts no spells`);
  const { saveDc, attackBonus } = sheet.spellcasting;
  return { combatant, saveDc, attackBonus, modifier: attackBonus - sheet.proficiencyBonus };
}

const nothing = (target: string): SpellOutcome => ({ target, attack: null, save: null, damage: 0, healed: 0 });

/** The targets after the spell, each once, in the order first given. */
function settle(targets: readonly Combatant[], byId: ReadonlyMap<string, Combatant>): Combatant[] {
  return [...new Set(targets.map((t) => t.id))].map((id) => byId.get(id)!);
}

/**
 * Where a dart or beam goes in its turn: at its own target, or, once that has fallen in this cast, at the most
 * wounded still up of those aimed at and the spare foes (the caster chooses each one's target); none: nowhere.
 */
function aimedAt(byId: ReadonlyMap<string, Combatant>, id: string): Combatant | undefined {
  const own = byId.get(id)!;
  if (own.status !== 'dead') return own;
  const up = [...byId.values()].filter((c) => c.status === 'up');
  return up.length ? up.reduce((low, c) => (c.hp < low.hp ? c : low)) : undefined;
}

/** Each dart or beam in turn, struck where it is aimed (aimedAt); one with nowhere to go is not struck or listed. */
function oneByOne(targets: readonly Combatant[], spare: readonly Combatant[], strike: (target: Combatant) => { outcome: SpellOutcome; target: Combatant }): Resolved {
  const all = [...targets, ...spare];
  const byId = new Map(all.map((t) => [t.id, t]));
  const outcomes = targets.flatMap((t) => {
    const aimed = aimedAt(byId, t.id);
    if (!aimed) return [];
    const { outcome, target } = strike(aimed);
    byId.set(target.id, target);
    return [outcome];
  });
  return { outcomes, targets: settle(all, byId) };
}

function spellAttacks(rng: Rng, caster: Caster, spell: SrdSpell, cast: Cast, targets: readonly Combatant[], spare: readonly Combatant[], options: RollOptions): Resolved {
  const s = cast.beams === 1 ? '' : 's';
  require(targets.length === cast.beams, `${spell.name} makes ${cast.beams} attack${s}: give ${cast.beams} target${s}`);
  const attack = { name: spell.name, bonus: caster.attackBonus, ranged: spell.attack === 'ranged', damage: [{ dice: cast.damageDice!, type: spell.damage!.type }] };
  const attacker = { ...caster.combatant, attacks: [attack] };
  return oneByOne(targets, spare, (aimed) => {
    const { result, target } = attackRoll(rng, attacker, spell.name, aimed, options);
    return { outcome: { ...nothing(aimed.id), attack: result, damage: result.damage }, target };
  });
}

function spellSaves(rng: Rng, caster: Caster, spell: SrdSpell, cast: Cast, targets: readonly Combatant[], options: RollOptions): Resolved {
  const rolled = cast.damageDice ? rollDice(rng, parseDice(cast.damageDice)).total : 0;
  const results = targets.map((t) => {
    const save = savingThrow(rng, t, spell.save!, caster.saveDc, options);
    const taken = save.success ? (spell.halfOnSave ? Math.floor(rolled / 2) : 0) : rolled;
    const damage = spell.damage ? damageAfterDefenses(t, taken, spell.damage.type) : 0;
    return { outcome: { ...nothing(t.id), save, damage }, target: takeDamage(t, damage, false) };
  });
  return { outcomes: results.map((r) => r.outcome), targets: results.map((r) => r.target) };
}

/** Darts that never miss: each rolls its own damage against its target (several may share one, in turn). */
function spellDarts(rng: Rng, spell: SrdSpell, cast: Cast, targets: readonly Combatant[], spare: readonly Combatant[]): Resolved {
  require(targets.length === cast.beams, `${spell.name} makes ${cast.beams} darts: give ${cast.beams} targets`);
  return oneByOne(targets, spare, (aimed) => {
    const damage = damageAfterDefenses(aimed, rollDice(rng, parseDice(cast.damageDice!)).total, spell.damage!.type);
    return { outcome: { ...nothing(aimed.id), damage }, target: takeDamage(aimed, damage, false) };
  });
}

function spellHealing(rng: Rng, caster: Caster, cast: Cast, targets: readonly Combatant[]): Resolved {
  const amount = rollDice(rng, parseDice(cast.healingDice!)).total + caster.modifier;
  const healed = targets.map((t) => heal(t, amount));
  return { outcomes: targets.map((t, i) => ({ ...nothing(t.id), healed: healed[i].hp - t.hp })), targets: healed };
}

/**
 * Resolves a cast (from castSpell) against its targets: a spell attack per beam, a sure hit per dart, a
 * saving throw per target against damage rolled once, or healing rolled once. A spell with none of these is the DM's.
 */
export function resolveSpell(rng: Rng, caster: Caster, cast: Cast, targets: readonly Combatant[], { attack = {}, save = {}, spare = [] }: SpellRolls = {}, data: Srd = bundledSrd()): Resolved {
  const spell = data.spells.get(cast.spellId)!;
  if (spell.attack && cast.damageDice) return spellAttacks(rng, caster, spell, cast, targets, spare, attack);
  if (spell.darts) return spellDarts(rng, spell, cast, targets, spare);
  if (spell.save) return spellSaves(rng, caster, spell, cast, targets, save);
  if (cast.healingDice) return spellHealing(rng, caster, cast, targets);
  return { outcomes: targets.map((t) => nothing(t.id)), targets: [...targets] };
}

/** The Constitution save to keep concentrating after taking damage; a caster who is down loses it. */
export function concentrationCheck(rng: Rng, target: Combatant, damage: number, options: RollOptions = {}): { dc: number; roll: D20 | null; success: boolean } {
  const dc = concentrationDc(damage);
  if (target.status !== 'up') return { dc, roll: null, success: false };
  return { dc, ...savingThrow(rng, target, 'con', dc, options) };
}

/** Feet of area per foe caught, by shape. */
const FEET_PER_FOE: Readonly<Record<AreaShape, number>> = { Sphere: 5, Cylinder: 5, Emanation: 5, Cone: 10, Cube: 10, Line: 30 };

/**
 * How many foes an area catches when nobody places it on a grid (theatre of the mind): an original rule of
 * thumb (CC0) — 1 + radius/5 for a sphere, cylinder or emanation, 1 + size/10 for a cone or cube, 1 + length/30
 * for a line, rounded down. See docs/rules-design.md.
 */
export const areaCatch = (area: { shape: AreaShape; feet: number }): number => 1 + Math.floor(area.feet / FEET_PER_FOE[area.shape]);

export interface Position { id: string; x: number; y: number }

/**
 * Who a sphere, cylinder or emanation of `feet` radius takes, from its center, on a 5-foot grid where a
 * diagonal counts as 5 feet. Cones, cubes and lines are left to whoever places them.
 */
export function targetsInRadius(area: { shape: AreaShape; feet: number }, center: { x: number; y: number }, positions: readonly Position[]): string[] {
  require(RADIAL.includes(area.shape), `give the targets of a ${area.shape} yourself`);
  return positions
    .filter((p) => Math.max(Math.abs(p.x - center.x), Math.abs(p.y - center.y)) * FEET_PER_SQUARE <= area.feet)
    .map((p) => p.id);
}
