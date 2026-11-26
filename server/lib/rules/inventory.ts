/**
 * A hero's inventory (SRD 5.2): items stacked by id, coins in GP, carrying capacity by size and Strength
 * (coins weigh 1 lb per 50), buying at SRD prices, selling at half (treasure at full value), and Potions of
 * Healing. Over capacity a hero is dragging (Speed 5 ft); past the drag limit they cannot take more.
 */
import { parseDice, rollDice } from './dice.ts';
import { HEALING_POTIONS, item, items } from './items.ts';
import type { Rng } from './rng.ts';
import type { CharacterSheet } from './sheet.ts';
import { require } from './violation.ts';

export interface Load { carried: number; capacity: number; dragLimit: number; dragging: boolean }

const CARRY_PER_STR: Readonly<Record<CharacterSheet['size'], number>> = { Tiny: 7.5, Small: 15, Medium: 15, Large: 30, Huge: 60, Gargantuan: 120 };
const COINS_PER_LB = 50;
const cents = (gp: number) => Math.round(gp * 100) / 100;

function weightOf(id: string): number {
  const found = items().get(id);
  return found ? found.weight : 0;
}

export function load(sheet: CharacterSheet): Load {
  const carried = cents(sheet.equipment.reduce((sum, e) => sum + weightOf(e.id) * e.count, 0) + sheet.gp / COINS_PER_LB);
  const capacity = sheet.abilityScores.str * CARRY_PER_STR[sheet.size];
  return { carried, capacity, dragLimit: capacity * 2, dragging: carried > capacity };
}

function held(sheet: CharacterSheet, id: string): number {
  const found = sheet.equipment.find((e) => e.id === id);
  return found ? found.count : 0;
}

export function addItem(sheet: CharacterSheet, id: string, count = 1): CharacterSheet {
  const { name } = item(id);
  const has = held(sheet, id);
  const equipment = has
    ? sheet.equipment.map((e) => (e.id === id ? { ...e, count: e.count + count } : e))
    : [...sheet.equipment, { id, name, count }];
  const next = { ...sheet, equipment };
  require(load(next).carried <= load(next).dragLimit, `${name} is too heavy for ${sheet.name} to carry`);
  return next;
}

export function removeItem(sheet: CharacterSheet, id: string, count = 1): CharacterSheet {
  const has = held(sheet, id);
  require(has >= count, `${sheet.name} does not have ${count} ${item(id).name}`);
  const equipment = has === count
    ? sheet.equipment.filter((e) => e.id !== id)
    : sheet.equipment.map((e) => (e.id === id ? { ...e, count: e.count - count } : e));
  return { ...sheet, equipment };
}

export function buy(sheet: CharacterSheet, id: string, count = 1): CharacterSheet {
  const { name, cost } = item(id);
  require(cost > 0, `${name} is not for sale`);
  require(cost * count <= sheet.gp, `${sheet.name} cannot afford ${name} (${cost * count} GP)`);
  return addItem({ ...sheet, gp: cents(sheet.gp - cost * count) }, id, count);
}

/** Equipment sells for half its cost (5.2); gems, jewellery and other treasure for their full value. */
export function sell(sheet: CharacterSheet, id: string, count = 1): CharacterSheet {
  const { cost, kind } = item(id);
  const price = kind === 'treasure' ? cost : cost / 2;
  const without = removeItem(sheet, id, count);
  return { ...without, gp: cents(sheet.gp + price * count) };
}

/** Drinks a Potion of Healing (5.2): the HP it restores, never above the maximum. */
export function useItem(rng: Rng, sheet: CharacterSheet, id: string): { sheet: CharacterSheet; healed: number } {
  require(!sheet.dead, `${sheet.name} is dead`);
  const { name } = item(id);
  require(Object.hasOwn(HEALING_POTIONS, id), `${name} cannot be used that way`);
  const without = removeItem(sheet, id);
  const hp = Math.min(sheet.maxHp, sheet.hp + rollDice(rng, parseDice(HEALING_POTIONS[id])).total);
  return { sheet: { ...without, hp }, healed: hp - sheet.hp };
}
