import { z } from 'zod';
import { heroAttacks } from './attacks.ts';
import { isValid } from './catalog.ts';
import { badRequest, conflict, forbidden, isUUID, notFound } from './http.ts';
import { buildCharacter, quickChoices } from './rules/character.ts';
import { revive, TEMPLE_RAISE_DEAD } from './rules/revive.ts';
import { derivedRng } from './rules/rng.ts';
import type { CharacterSheet } from './rules/sheet.ts';
import { srd } from './rules/srd.ts';
import { getStore } from './store/index.ts';
import type { Character, StoredCharacter } from './types.ts';

/** SRD 5.2 has no Half-Elf or Half-Orc; heroes made before the switch become an Elf or an Orc (the player can change it). */
export const LEGACY_RACES: Readonly<Record<string, string>> = { 'half-orc': 'orc', 'half-elf': 'elf' };
const currentRace = (race: unknown) => (typeof race === 'string' && Object.hasOwn(LEGACY_RACES, race) ? LEGACY_RACES[race] : race);

interface Build { id: string; name: string; race: string; characterClass: string; backgroundId?: string }

/**
 * A level-1 sheet from the engine, seeded by the character's id, so the same hero always comes out the same.
 * Keep the seed: a hero saved before the engine is rebuilt from it on every read until it is saved.
 */
export function heroSheet({ id, name, race, characterClass, backgroundId }: Build): CharacterSheet {
  const rng = derivedRng(0, `hero/${id}`);
  return buildCharacter(quickChoices(rng, { name, classId: characterClass, speciesId: race, backgroundId }), rng);
}

/** A stored hero as the API shows it: on its SRD 5.2 species, with a sheet. Not saved until the hero is next saved. */
export function upgradeCharacter(stored: StoredCharacter): Character {
  const race = currentRace(stored.race) as string;
  const { sheet = heroSheet({ ...stored, race }) } = stored;
  return { ...stored, race, sheet, attacks: heroAttacks(sheet) };
}

/** What the store keeps of a character: everything but what is worked out on read. */
export function storable({ attacks: _, ...stored }: Character | (StoredCharacter & { attacks?: unknown })): StoredCharacter {
  return stored;
}

const sameBuild = (sheet: CharacterSheet, b: Build) =>
  sheet.speciesId === b.race && sheet.classId === b.characterClass && (b.backgroundId === undefined || b.backgroundId === sheet.backgroundId);

/** Keeps the sheet (renamed) when the build is unchanged; rebuilds it at level 1; refuses to rebuild a levelled hero. */
function sheetFor(existing: Character | null, build: Build): CharacterSheet {
  if (!existing) return heroSheet(build);
  if (sameBuild(existing.sheet, build)) return { ...existing.sheet, name: build.name };
  if (existing.sheet.level > 1) throw badRequest('a hero above level 1 cannot change race, class or background');
  return heroSheet(build);
}

const catalogId = (kind: Parameters<typeof isValid>[0]) =>
  z.string().refine((v) => isValid(kind, v), { message: `unknown ${kind}` });

/** The parts of a character that describe it (what POST /api/portrait needs). */
export const CharacterLookInput = z.object({
  name: z.string().trim().min(1).max(40),
  race: z.preprocess(currentRace, catalogId('race')),
  characterClass: catalogId('characterClass'),
  gender: catalogId('gender'),
  temperament: catalogId('temperament'),
  alignment: catalogId('alignment'),
  backstory: z.string().max(600).default(''),
  description: z.string().max(600).default(''),
});

const heroId = z.string().refine(isUUID, { message: 'id must be a UUID' });
const backgroundId = z.string().refine((id) => srd().backgrounds.has(id), { message: 'unknown background' }).optional();

const CharacterInput = CharacterLookInput.extend({
  id: heroId,
  appearance: z.string().max(2000).nullable().default(null),
  portraitUrl: z.url({ protocol: /^https?$/ }).max(2000).nullable().default(null),
  backgroundId,
});

/** What a sheet is built from (POST /api/sheet): the same checks as a save. */
const BuildInput = CharacterLookInput.pick({ name: true, race: true, characterClass: true }).extend({ id: heroId, backgroundId });

/** Formats the first zod issue as a short 400 message, e.g. "race: unknown race". */
export function zodMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'invalid body';
}

/** PUT /api/characters — upsert by id; only the owner may update. ownerId comes from the caller. */
export async function saveCharacter(playerId: string, body: unknown): Promise<Character> {
  const parsed = CharacterInput.safeParse(body);
  if (!parsed.success) throw badRequest(zodMessage(parsed.error));
  const store = getStore();
  const stored = await store.getCharacter(parsed.data.id);
  if (stored && stored.ownerId !== playerId) throw forbidden('that character belongs to another player');
  const existing = stored && upgradeCharacter(stored);
  const now = new Date().toISOString();
  const c = parsed.data;
  const sheet = sheetFor(existing, c);
  return upgradeCharacter(await store.saveCharacter({
    id: c.id,
    ownerId: playerId,
    name: c.name,
    race: c.race,
    characterClass: c.characterClass,
    gender: c.gender,
    temperament: c.temperament,
    alignment: c.alignment,
    backstory: c.backstory,
    description: c.description,
    appearance: c.appearance,
    portraitUrl: c.portraitUrl,
    sheet,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }));
}

/** POST /api/sheet — the level-1 sheet a save would build for this hero; nothing is stored. */
export function previewSheet(body: unknown): Pick<Character, 'sheet' | 'attacks'> {
  const parsed = BuildInput.safeParse(body);
  if (!parsed.success) throw badRequest(zodMessage(parsed.error));
  const sheet = heroSheet(parsed.data);
  return { sheet, attacks: heroAttacks(sheet) };
}

export async function listCharacters(playerId: string): Promise<Character[]> {
  return (await getStore().listCharacters(playerId)).map(upgradeCharacter);
}

export async function deleteCharacter(playerId: string, id: string | null): Promise<void> {
  if (!id) throw badRequest('id is required');
  const store = getStore();
  const existing = await store.getCharacter(id);
  if (!existing) throw notFound('no such character');
  if (existing.ownerId !== playerId) throw forbidden('that character belongs to another player');
  await store.deleteCharacter(id);
}

/** The caller's own character, or 404. */
export async function ownCharacter(playerId: string, id: unknown): Promise<Character> {
  if (typeof id !== 'string' || !id) throw badRequest('characterId is required');
  const character = await getStore().getCharacter(id);
  if (!character || character.ownerId !== playerId) throw notFound('no such character');
  return upgradeCharacter(character);
}

/**
 * POST /api/characters/revive — a temple's Raise Dead between adventures (SRD 5.2: a level-5 spellcasting
 * service, 2,000 GP, plus the 500 GP diamond). The dead hero's own purse pays, or another living hero of the
 * same player (payerId). The hero comes back with 1 HP and -4 on D20 Tests, easing with each Long Rest.
 */
export async function reviveCharacter(playerId: string, characterId: unknown, payerId: unknown): Promise<Character> {
  const hero = await ownCharacter(playerId, characterId);
  if (!hero.sheet.dead) throw conflict(`${hero.name} is not dead`);
  const payer = payerId === undefined || payerId === null || payerId === hero.id ? hero : await ownCharacter(playerId, payerId);
  if (payer.sheet.dead && payer !== hero) throw conflict(`${payer.name} is dead`);
  if (payer.sheet.gp < TEMPLE_RAISE_DEAD) throw conflict(`the temple asks ${TEMPLE_RAISE_DEAD} gp; ${payer.name} has ${payer.sheet.gp}`);
  const store = getStore();
  const now = new Date().toISOString();
  const paid = (c: Character) => ({ ...c.sheet, gp: c.sheet.gp - TEMPLE_RAISE_DEAD });
  if (payer !== hero) await store.saveCharacter(storable({ ...payer, sheet: paid(payer), updatedAt: now }));
  const sheet = revive(payer === hero ? paid(hero) : hero.sheet, 'raise-dead');
  await store.saveCharacter(storable({ ...hero, sheet, updatedAt: now }));
  return upgradeCharacter(storable({ ...hero, sheet, updatedAt: now }));
}
