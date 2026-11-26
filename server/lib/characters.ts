import { z } from 'zod';
import { isValid } from './catalog.ts';
import { badRequest, forbidden, isUUID, notFound } from './http.ts';
import { buildCharacter, quickChoices } from './rules/character.ts';
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
  return { ...stored, race, sheet };
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

const CharacterInput = CharacterLookInput.extend({
  id: z.string().refine(isUUID, { message: 'id must be a UUID' }),
  appearance: z.string().max(2000).nullable().default(null),
  portraitUrl: z.url({ protocol: /^https?$/ }).max(2000).nullable().default(null),
  backgroundId: z.string().refine((id) => srd().backgrounds.has(id), { message: 'unknown background' }).optional(),
});

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
