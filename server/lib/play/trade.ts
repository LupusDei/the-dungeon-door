/**
 * The party's goods: treasure stowed with whoever has room, buying and selling at SRD 5.2 prices, and
 * Potions of Healing given to whoever needs one most. Dead heroes neither carry, trade nor drink.
 */
import { addItem, buy, drink, load, removeItem, sell } from '../rules/inventory.ts';
import { HEALING_POTIONS, item, items } from '../rules/items.ts';
import { seededRng } from '../rules/rng.ts';
import type { CharacterSheet } from '../rules/sheet.ts';
import { RuleViolation } from '../rules/violation.ts';
import type { PartyState } from './state.ts';

export interface Traded { party: PartyState; lines: string[] }

const living = (party: PartyState) => Object.keys(party.sheets).filter((id) => !party.sheets[id].dead);
const withSheet = (party: PartyState, id: string, sheet: CharacterSheet): PartyState => ({ ...party, sheets: { ...party.sheets, [id]: sheet } });
const room = (sheet: CharacterSheet) => { const l = load(sheet); return l.dragLimit - l.carried; };

/** A treasure's magic item, by its SRD name (as the dungeon tables give it) or id. */
export function itemIdOf(nameOrId: string): string | null {
  if (items().has(nameOrId)) return nameOrId;
  const found = [...items().values()].find((i) => i.name === nameOrId);
  return found ? found.id : null;
}

function attempt<T>(act: () => T): T | null {
  try {
    return act();
  } catch (e) {
    if (e instanceof RuleViolation) return null;
    throw e;
  }
}

/** Each item goes to the living hero with the most room left (the first on a tie); with nobody alive, it stays where it lies. */
export function stow(party: PartyState, ids: readonly string[]): Traded {
  if (living(party).length === 0) return { party, lines: [] };
  const taken: Record<string, string[]> = {};
  const left: string[] = [];
  const after = ids.reduce((p, id) => {
    const who = living(p).reduce((best, h) => (room(p.sheets[h]) > room(p.sheets[best]) ? h : best));
    const sheet = attempt(() => addItem(p.sheets[who], id));
    if (!sheet) { left.push(item(id).name); return p; }
    (taken[who] ??= []).push(id);
    return withSheet(p, who, sheet);
  }, party);
  const lines = Object.entries(taken).map(([who, got]) => `${after.sheets[who].name} takes ${summary(got)}.`);
  return { party: after, lines: [...lines, ...(left.length ? [`Left behind (too heavy): ${left.join(', ')}.`] : [])] };
}

/** "2 Gemstone, Bag of Holding". */
function summary(ids: readonly string[]): string {
  return [...new Set(ids)].map((id) => { const n = ids.filter((x) => x === id).length; return n > 1 ? `${n} ${item(id).name}` : item(id).name; }).join(', ');
}

function buyOne(p: PartyState, id: string): Traded {
  const { name, cost } = item(id);
  if (cost === 0) return { party: p, lines: [`${name} is not for sale.`] };
  const alive = living(p);
  if (alive.length === 0) return { party: p, lines: [`Nobody is left to buy ${name}.`] };
  const richest = alive.reduce((best, h) => (p.sheets[h].gp > p.sheets[best].gp ? h : best));
  const sheet = attempt(() => buy(p.sheets[richest], id));
  if (!sheet) return { party: p, lines: [`Nobody can afford ${name} (${cost} GP).`] };
  return { party: withSheet(p, richest, sheet), lines: [`${sheet.name} buys ${name} for ${cost} GP.`] };
}

const chain = (party: PartyState, ids: readonly string[], one: (p: PartyState, id: string) => Traded): Traded =>
  ids.reduce<Traded>((acc, id) => { const r = one(acc.party, id); return { party: r.party, lines: [...acc.lines, ...r.lines] }; }, { party, lines: [] });

export const buyItems = (party: PartyState, ids: readonly string[]): Traded => chain(party, ids, buyOne);

const countOf = (sheet: CharacterSheet, id: string) => sheet.equipment.filter((e) => e.id === id).reduce((n, e) => n + e.count, 0);

function sellOne(p: PartyState, id: string): Traded {
  const sellers = living(p).filter((h) => countOf(p.sheets[h], id) > 0);
  if (sellers.length === 0) return { party: p, lines: [`Nobody has ${item(id).name} to sell.`] };
  return sellers.reduce<Traded>((acc, h) => {
    const before = acc.party.sheets[h];
    const n = countOf(before, id);
    const sheet = sell(before, id, n);
    return { party: withSheet(acc.party, h, sheet), lines: [...acc.lines, `${before.name} sells ${n} ${item(id).name} for ${Math.round((sheet.gp - before.gp) * 100) / 100} GP.`] };
  }, { party: p, lines: [] });
}

export const sellItems = (party: PartyState, ids: readonly string[]): Traded => chain(party, ids, sellOne);

/** The most hurt living hero (lowest share of their HP) drinks, from their own pack or a friend's. */
export function usePotion(party: PartyState, id: string): Traded {
  const { name } = item(id);
  if (!Object.hasOwn(HEALING_POTIONS, id)) return { party, lines: [`${name} cannot be drunk.`] };
  const holders = living(party).filter((h) => countOf(party.sheets[h], id) > 0);
  if (holders.length === 0) return { party, lines: [`Nobody has a ${name}.`] };
  const hurt = living(party).filter((h) => party.sheets[h].hp < party.sheets[h].maxHp);
  if (hurt.length === 0) return { party, lines: ['Nobody needs healing.'] };
  const share = (h: string) => party.sheets[h].hp / party.sheets[h].maxHp;
  const target = hurt.reduce((worst, h) => (share(h) < share(worst) ? h : worst));
  const giver = holders.includes(target) ? target : holders[0];
  const rng = seededRng(party.rng);
  const given = withSheet(party, giver, removeItem(party.sheets[giver], id));
  const drunk = drink(rng, given.sheets[target], id);
  const p = { ...withSheet(given, target, drunk.sheet), rng: rng.state() };
  const who = giver === target ? `${drunk.sheet.name} drinks` : `${party.sheets[giver].name} gives ${drunk.sheet.name}`;
  return { party: p, lines: [`${who} a ${name}: ${drunk.healed} HP back.`] };
}
