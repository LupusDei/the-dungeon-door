/**
 * Every item a hero can carry, buy or sell: SRD 5.2 weapons, armor, adventuring gear, tools, packs and
 * magic items (CC-BY-4.0), with a price in GP and a weight in pounds. Magic items are valued by rarity
 * (5.2 Magic Item Rarities and Values; consumables at half). The SRD has no gem or art tables, so the
 * dungeon's gemstones and jewellery use original values (CC0, this file).
 */
import { z } from 'zod';
import armorJson from '../../data/srd/5.2/armor.json' with { type: 'json' };
import gearJson from '../../data/srd/5.2/adventuringGear.json' with { type: 'json' };
import magicItemsJson from '../../data/srd/5.2/magicItems.json' with { type: 'json' };
import packsJson from '../../data/srd/5.2/equipmentPacks.json' with { type: 'json' };
import toolsJson from '../../data/srd/5.2/tools.json' with { type: 'json' };
import weaponsJson from '../../data/srd/5.2/weapons.json' with { type: 'json' };
import { ABILITIES, type Ability } from './abilities.ts';
import { once, parseTable } from './srd.ts';
import { require } from './violation.ts';

export type ItemKind = 'weapon' | 'armor' | 'gear' | 'tool' | 'pack' | 'magic' | 'treasure';
export interface ItemInfo {
  id: string; name: string; kind: ItemKind;
  /** Price in GP (0: not for sale). */
  cost: number;
  /** Pounds. */
  weight: number;
  /** Used up when used (potions). */
  consumable: boolean;
  /** Tools: the ability their checks use. */
  ability?: Ability;
  /** Magic items. */
  rarity?: string;
  /** Packs: what is inside, opened when a hero gets one (inventory.ts). */
  contents?: { id: string; count: number }[];
}

/** HP regained, by potion (5.2 Potions of Healing). */
export const HEALING_POTIONS: Readonly<Record<string, string>> = {
  'potion-of-healing': '2d4+2',
  'potion-of-greater-healing': '4d4+4',
  'potion-of-superior-healing': '8d4+8',
  'potion-of-supreme-healing': '10d4+20',
};

const GP_PER: Readonly<Record<string, number>> = { cp: 0.01, sp: 0.1, ep: 0.5, gp: 1, pp: 10 };
const RARITY_VALUE: Readonly<Record<string, number>> = { Common: 100, Uncommon: 400, Rare: 4000, 'Very Rare': 40000, Legendary: 200000 };

const cost = z.object({ quantity: z.number(), unit: z.enum(['cp', 'sp', 'ep', 'gp', 'pp']) }).transform((c) => Math.round(c.quantity * GP_PER[c.unit] * 100) / 100);
const priced = { index: z.string(), name: z.string(), cost, weight: z.number().default(0) };
const plain = (kind: ItemKind) => z.object(priced).transform((i): ItemInfo => ({ id: i.index, name: i.name, kind, cost: i.cost, weight: i.weight, consumable: false }));
const tool = z.object({ ...priced, ability: z.object({ index: z.enum(ABILITIES) }) })
  .transform((i): ItemInfo => ({ id: i.index, name: i.name, kind: 'tool', cost: i.cost, weight: i.weight, consumable: false, ability: i.ability.index }));
const pack = z.object({ index: z.string(), name: z.string(), cost, contents: z.array(z.object({ item: z.object({ index: z.string() }), quantity: z.number() })) });
/** Pack weights from the SRD 5.2 Adventuring Gear table (the JSON's are missing or wrong for some packs). */
const PACK_WEIGHTS: Readonly<Record<string, number>> = {
  'burglars-pack': 42, 'diplomat-pack': 39, 'dungeoneer-pack': 55, 'entertainers-pack': 58.5,
  'explorers-pack': 55, 'priests-pack': 29, 'scholars-pack': 22,
};

/** "Uncommon (+1), Rare (+2)…" → Uncommon; "Rarity Varies" → undefined. */
const rarityOf = (text: string) => Object.keys(RARITY_VALUE).find((r) => text.startsWith(r));

const magic = z.object({ index: z.string(), name: z.string(), rarity: z.string(), equipmentCategory: z.object({ index: z.string() }) })
  .transform((m): ItemInfo => {
    const rarity = rarityOf(m.rarity);
    const potion = m.equipmentCategory.index === 'potions';
    const value = rarity ? RARITY_VALUE[rarity] / (potion ? 2 : 1) : 0;
    return { id: m.index, name: m.name, kind: 'magic', cost: value, weight: 0, consumable: potion, ...(rarity ? { rarity } : {}) };
  });

const POTIONS: ItemInfo[] = [
  ['potion-of-greater-healing', 'Potion of Greater Healing', 'Uncommon'],
  ['potion-of-superior-healing', 'Potion of Superior Healing', 'Rare'],
  ['potion-of-supreme-healing', 'Potion of Supreme Healing', 'Very Rare'],
].map(([id, name, rarity]) => ({ id, name, kind: 'magic', cost: RARITY_VALUE[rarity] / 2, weight: 0.5, consumable: true, rarity }));

/** Original values (CC0): the SRD 5.2 has no gem or art object tables. */
const TREASURE: ItemInfo[] = [
  { id: 'gemstone', name: 'Gemstone', kind: 'treasure', cost: 50, weight: 0, consumable: false },
  { id: 'jewellery', name: 'Piece of Jewellery', kind: 'treasure', cost: 100, weight: 1, consumable: false },
];

const loaded = once((): Map<string, ItemInfo> => {
  const all = new Map<string, ItemInfo>();
  const add = (list: ItemInfo[]) => list.forEach((i) => { if (!all.has(i.id)) all.set(i.id, i); });
  add(parseTable('weapons', plain('weapon'), weaponsJson));
  add(parseTable('armor', plain('armor'), armorJson));
  add(parseTable('adventuringGear', plain('gear'), gearJson).map((i) => (i.id in HEALING_POTIONS ? { ...i, consumable: true } : i)));
  add(parseTable('tools', tool, toolsJson));
  add(parseTable('equipmentPacks', pack, packsJson).map((p) => ({
    id: p.index, name: p.name, kind: 'pack' as const, cost: p.cost, consumable: false,
    weight: PACK_WEIGHTS[p.index], contents: p.contents.map((c) => ({ id: c.item.index, count: c.quantity })),
  })));
  add(POTIONS);
  add(parseTable('magicItems', magic, magicItemsJson));
  add(TREASURE);
  return all;
});

export const items = (): ReadonlyMap<string, ItemInfo> => loaded();

export function item(id: string): ItemInfo {
  const found = loaded().get(id);
  require(found !== undefined, `unknown item: ${id}`);
  return found;
}
