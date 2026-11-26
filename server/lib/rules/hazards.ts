/**
 * SRD 5.2 hazards (Rules Glossary and Environmental Effects; 5.2/hazards.json): falling, burning,
 * suffocation, extreme cold and heat, dehydration and malnutrition. Each befalls one hero; Exhaustion 6 is
 * death. Not modelled: Resistance to Cold or Fire (heroes' resistances are not on the sheet yet).
 */
import { abilityModifier } from './abilities.ts';
import { parseDice, rollDice } from './dice.ts';
import { exhaustionEffects, gainExhaustion } from './rests.ts';
import { rollD20 } from './resolve.ts';
import type { Rng } from './rng.ts';
import { type CharacterSheet, MAX_EXHAUSTION } from './sheet.ts';
import { srd } from './srd.ts';

export type HazardSpec =
  | { kind: 'falling'; feet: number }
  | { kind: 'burning' }
  | { kind: 'suffocation'; minutes: number }
  | { kind: 'extreme-cold'; hours: number }
  | { kind: 'extreme-heat'; hours: number }
  | { kind: 'dehydration' }
  | { kind: 'malnutrition'; days: number };
export type HazardKind = HazardSpec['kind'];
export interface Suffered { sheet: CharacterSheet; line: string }

const MAX_FALL_DICE = 20;
const ROUNDS_PER_MINUTE = 10;
const conMod = (s: CharacterSheet) => abilityModifier(s.abilityScores.con);
const has = (s: CharacterSheet, id: string) => s.equipment.some((e) => e.id === id);
const hurt = (s: CharacterSheet, damage: number) => ({ ...s, hp: Math.max(0, s.hp - damage) });

/** Exhaustion gained, and death at 6. */
function exhausted(sheet: CharacterSheet, levels: number, what: string): Suffered {
  const after = gainExhaustion(sheet, levels);
  const dead = after.exhaustion === MAX_EXHAUSTION;
  return { sheet: dead ? { ...after, dead: true } : after, line: `${what}: Exhaustion ${after.exhaustion}${dead ? ', and dies' : ''}` };
}

/** How long the hero can hold their breath (5.2): 1 + CON modifier minutes, at least 30 seconds. */
export const breathMinutes = (sheet: CharacterSheet) => Math.max(0.5, 1 + conMod(sheet));

function fall(rng: Rng, s: CharacterSheet, feet: number): Suffered {
  const dice = Math.min(MAX_FALL_DICE, Math.floor(feet / 10));
  if (dice === 0) return { sheet: s, line: `${s.name} drops ${feet} feet, unhurt` };
  const damage = rollDice(rng, parseDice(`${dice}d6`)).total;
  return { sheet: hurt(s, damage), line: `${s.name} falls ${feet} feet: ${damage} Bludgeoning damage, and lands Prone` };
}

function burn(rng: Rng, s: CharacterSheet): Suffered {
  const damage = rng.die(4);
  return { sheet: hurt(s, damage), line: `${s.name} catches fire: ${damage} Fire damage, then drops Prone and rolls to put it out` };
}

/** Exhaustion from suffocating goes once the hero breathes again, unless it reached 6. */
function suffocate(s: CharacterSheet, minutes: number): Suffered {
  const rounds = Math.ceil(Math.round((minutes - breathMinutes(s)) * ROUNDS_PER_MINUTE * 1000) / 1000);
  if (rounds <= 0) return { sheet: s, line: `${s.name} holds their breath long enough` };
  const what = `${s.name} runs out of breath and suffocates for ${rounds} ${rounds === 1 ? 'round' : 'rounds'}`;
  if (s.exhaustion + rounds < MAX_EXHAUSTION) return { sheet: s, line: `${what}, then recovers on breathing again` };
  return exhausted(s, rounds, what);
}

function heavyArmored(s: CharacterSheet): boolean {
  return s.equipment.some((e) => {
    const armor = srd().armor.get(e.id);
    return armor !== undefined && (armor.category === 'medium' || armor.category === 'heavy');
  });
}

/** A Constitution save at the end of each hour (5.2): cold DC 10; heat DC 5 + 1 an hour, Disadvantage in Medium or Heavy armor. */
function exposure(rng: Rng, s: CharacterSheet, kind: 'extreme-cold' | 'extreme-heat', hours: number): Suffered {
  const heat = kind === 'extreme-heat';
  if (heat && has(s, 'waterskin')) return { sheet: s, line: `${s.name} has drinkable water: the heat is bearable` };
  const mode = heat && heavyArmored(s) ? 'disadvantage' : 'normal';
  let sheet = s;
  let failed = 0;
  for (let hour = 0; hour < hours; hour++) {
    const dc = heat ? 5 + hour : 10;
    if (rollD20(rng, sheet.saveBonuses.con + exhaustionEffects(sheet).d20, mode).total < dc) { failed++; sheet = gainExhaustion(sheet); }
  }
  const what = `${s.name} endures ${hours} ${hours === 1 ? 'hour' : 'hours'} of ${kind.replace('-', ' ')}`;
  if (failed === 0) return { sheet, line: `${what} and fails no Constitution save` };
  return exhausted(s, failed, `${what} and fails ${failed} Constitution ${failed === 1 ? 'save' : 'saves'}`);
}

function dehydrate(s: CharacterSheet): Suffered {
  return has(s, 'waterskin') ? { sheet: s, line: `${s.name} has water enough` } : exhausted(s, 1, `${s.name} has too little water`);
}

/** 5.2: after 3 + CON modifier days without food (at least 1), 1 Exhaustion at each day's end. */
function starve(s: CharacterSheet, days: number): Suffered {
  if (has(s, 'rations')) return { sheet: s, line: `${s.name} has food enough` };
  const levels = days - Math.max(1, 3 + conMod(s)) + 1;
  return levels > 0 ? exhausted(s, levels, `${s.name} goes ${days} days without food`) : { sheet: s, line: `${s.name} goes hungry but holds up` };
}

const HAZARDS: { [K in HazardKind]: (rng: Rng, s: CharacterSheet, spec: Extract<HazardSpec, { kind: K }>) => Suffered } = {
  falling: (rng, s, h) => fall(rng, s, h.feet),
  burning: (rng, s) => burn(rng, s),
  suffocation: (_rng, s, h) => suffocate(s, h.minutes),
  'extreme-cold': (rng, s, h) => exposure(rng, s, h.kind, h.hours),
  'extreme-heat': (rng, s, h) => exposure(rng, s, h.kind, h.hours),
  dehydration: (_rng, s) => dehydrate(s),
  malnutrition: (_rng, s, h) => starve(s, h.days),
};

export const sufferHazard = (rng: Rng, sheet: CharacterSheet, spec: HazardSpec): Suffered =>
  (HAZARDS[spec.kind] as (rng: Rng, s: CharacterSheet, h: HazardSpec) => Suffered)(rng, sheet, spec);
