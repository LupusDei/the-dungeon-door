import { z } from 'zod';
import { heroAttacks } from './attacks.ts';
import { isValid } from './catalog.ts';
import { badRequest, conflict, forbidden, isUUID, notFound } from './http.ts';
import {
  ABILITIES, type AbilityScores, type BackgroundBoost, STANDARD_ARRAY, applyBackgroundBoost, assignScores,
} from './rules/abilities.ts';
import { type BuildStyle, buildCharacter, quickChoices, rederive } from './rules/character.ts';
import { asItStands } from './rules/checks.ts';
import { item } from './rules/items.ts';
import { revive, TEMPLE_RAISE_DEAD } from './rules/revive.ts';
import { derivedRng } from './rules/rng.ts';
import { AbilityBoostSchema, parseCharacterSheet, type CharacterSheet } from './rules/sheet.ts';
import { srd } from './rules/srd.ts';
import { RuleViolation } from './rules/violation.ts';
import { getStore } from './store/index.ts';
import type { Character, StoredCharacter } from './types.ts';

/** SRD 5.2 has no Half-Elf or Half-Orc; heroes made before the switch become an Elf or an Orc (the player can change it). */
export const LEGACY_RACES: Readonly<Record<string, string>> = { 'half-orc': 'orc', 'half-elf': 'elf' };
const currentRace = (race: unknown) => (typeof race === 'string' && Object.hasOwn(LEGACY_RACES, race) ? LEGACY_RACES[race] : race);

interface Build { id: string; name: string; race: string; characterClass: string; backgroundId?: string; boost?: BackgroundBoost }

/**
 * A level-1 sheet from the engine, seeded by the character's id, so the same hero always comes out the same.
 * Keep the seed: a hero stored without a sheet is rebuilt from it, the classic way, on every read until it is saved.
 * `boost` is the player's placement of the background's increases. Left out, the server places +2 and +1.
 */
export function heroSheet({ id, name, race, characterClass, backgroundId, boost }: Build, style: BuildStyle = 'primary'): CharacterSheet {
  const rng = derivedRng(0, `hero/${id}`);
  const choices = quickChoices(rng, { name, classId: characterClass, speciesId: race, backgroundId }, undefined, style);
  const sheet = buildCharacter({ ...choices, boost: boost ?? choices.boost }, rng);
  return boost ? parseCharacterSheet({ ...sheet, abilityBoost: boost }) : sheet;
}

const equalScores = (a: AbilityScores, b: AbilityScores) => ABILITIES.every((ability) => a[ability] === b[ability]);

/** The standard-array scores the forge would have assigned, before and after its own +2/+1. */
function forgePlacement(id: string, sheet: CharacterSheet, style: BuildStyle): { base: AbilityScores; boosted: AbilityScores } | null {
  try {
    const rng = derivedRng(0, `hero/${id}`);
    const choices = quickChoices(rng, {
      name: sheet.name, classId: sheet.classId, speciesId: sheet.speciesId, backgroundId: sheet.backgroundId,
    }, undefined, style);
    if (choices.abilities.kind !== 'standardArray') return null;
    const allowed = srd().backgrounds.get(sheet.backgroundId)?.abilities;
    if (!allowed) return null;
    const base = assignScores(STANDARD_ARRAY, choices.abilities.order);
    return { base, boosted: applyBackgroundBoost(base, allowed, choices.boost) };
  } catch {
    return null;
  }
}

/** The base scores under the forge's automatic placement, when the stored scores are still exactly that. */
function forgeBase(id: string, sheet: CharacterSheet): AbilityScores | null {
  const found = (['primary', 'classic'] as const)
    .map((style) => forgePlacement(id, sheet, style))
    .filter((place): place is NonNullable<typeof place> => place !== null && equalScores(place.boosted, sheet.abilityScores));
  if (found.length === 0 || found.some((place) => !equalScores(place.base, found[0].base))) return null;
  return found[0].base;
}

/** The player has not placed the increases, and the scores are still the forge's, so they may place them once. */
export function bonusesAreOpen(id: string, sheet: CharacterSheet): boolean {
  return sheet.abilityBoost === undefined && forgeBase(id, sheet) !== null;
}

function withoutBoost(scores: AbilityScores, boost: BackgroundBoost, allowed: readonly (keyof AbilityScores)[]): AbilityScores {
  const base = { ...scores };
  if (boost.kind === 'oneOneOne') {
    for (const ability of allowed) base[ability] -= 1;
  } else {
    base[boost.plusTwo] -= 2;
    base[boost.plusOne] -= 1;
  }
  return base;
}

function sameBoost(a: BackgroundBoost | undefined, b: BackgroundBoost): boolean {
  if (!a || a.kind !== b.kind) return false;
  if (a.kind === 'oneOneOne' || b.kind === 'oneOneOne') return true;
  return a.plusTwo === b.plusTwo && a.plusOne === b.plusOne;
}

/**
 * Puts the player's background increases on a sheet. A level-1 hero who already chose can move them.
 * Anyone else can place them once, and only while the scores are still the forge's automatic ones.
 */
export function withChosenBoost(sheet: CharacterSheet, id: string, boost: BackgroundBoost): CharacterSheet {
  const allowed = srd().backgrounds.get(sheet.backgroundId)?.abilities;
  if (!allowed) throw badRequest('backgroundId: unknown background');
  let base: AbilityScores;
  if (sheet.abilityBoost) {
    if (sheet.level > 1) throw badRequest('a hero above level 1 keeps the ability bonuses they chose');
    base = withoutBoost(sheet.abilityScores, sheet.abilityBoost, allowed);
  } else {
    const found = forgeBase(id, sheet);
    if (!found) throw conflict('these scores are no longer the ones the forge assigned, so the bonuses cannot be placed');
    base = found;
  }
  const scores = applyBackgroundBoost(base, allowed, boost);
  return parseCharacterSheet(rederive({ ...sheet, abilityScores: scores, abilityBoost: boost }));
}

const FORGE_GIFT = 'potion-of-greater-healing';

/** A hero as the forge makes it: the engine's level-1 sheet, and one Potion of Greater Healing in its pack (Robert, 2026-11-26). */
export function forgedSheet(build: Build): CharacterSheet {
  const sheet = heroSheet(build);
  return { ...sheet, equipment: [...sheet.equipment, { id: FORGE_GIFT, name: item(FORGE_GIFT).name, count: 1 }] };
}

/** A stored hero as the API shows it: on its SRD 5.2 species, with a sheet. Not saved until the hero is next saved. */
export function upgradeCharacter(stored: StoredCharacter): Character {
  const race = currentRace(stored.race) as string;
  const { sheet: kept = heroSheet({ ...stored, race }, 'classic') } = stored;
  const sheet = asItStands(kept); // a stored passive Perception from before exhaustion counted
  return { ...stored, race, sheet, attacks: heroAttacks(sheet), bonusesOpen: bonusesAreOpen(stored.id, sheet) };
}

/** What the store keeps of a character: everything but what is worked out on read. */
export function storable({ attacks: _, bonusesOpen: __, ...stored }: Character | (StoredCharacter & { attacks?: unknown; bonusesOpen?: unknown })): StoredCharacter {
  return stored;
}

const sameBuild = (sheet: CharacterSheet, b: Build) =>
  sheet.speciesId === b.race && sheet.classId === b.characterClass && (b.backgroundId === undefined || b.backgroundId === sheet.backgroundId);

/** A rules refusal is the player's mistake, told back as a 400. */
function rulesOrBad<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof RuleViolation) throw badRequest(error.message);
    throw error;
  }
}

/** Keeps the sheet (renamed) when the build is unchanged; rebuilds it at level 1; refuses to rebuild a levelled hero. */
function sheetFor(existing: Character | null, build: Build): CharacterSheet {
  return rulesOrBad(() => {
    if (!existing) return forgedSheet(build);
    if (!sameBuild(existing.sheet, build)) {
      if (existing.sheet.level > 1) throw badRequest('a hero above level 1 cannot change race, class or background');
      return forgedSheet(build);
    }
    const renamed = { ...existing.sheet, name: build.name };
    if (!build.boost || sameBoost(renamed.abilityBoost, build.boost)) return renamed;
    return withChosenBoost(renamed, build.id, build.boost);
  });
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
const backgroundId = z.string().refine((id) => srd().backgrounds.has(id), { message: 'unknown background' }).nullish();
/** Null is the same as leaving it out: the app's encoder writes null for an optional it does not have. */
const boost = AbilityBoostSchema.nullish();

const CharacterInput = CharacterLookInput.extend({
  id: heroId,
  appearance: z.string().max(2000).nullable().default(null),
  portraitUrl: z.url({ protocol: /^https?$/ }).max(2000).nullable().default(null),
  backgroundId,
  boost,
});

/** What a sheet is built from (POST /api/sheet): the same checks as a save. */
const BuildInput = CharacterLookInput.pick({ name: true, race: true, characterClass: true }).extend({ id: heroId, backgroundId, boost });

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
  const sheet = sheetFor(existing, { ...c, backgroundId: c.backgroundId ?? undefined, boost: c.boost ?? undefined });
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
  const { backgroundId: picked, boost: chosen } = parsed.data;
  const sheet = rulesOrBad(() => forgedSheet({ ...parsed.data, backgroundId: picked ?? undefined, boost: chosen ?? undefined }));
  return { sheet, attacks: heroAttacks(sheet) };
}

/**
 * POST /api/characters/ability-boost — the player places the background's increases once, on a hero the
 * forge built and whose scores are still that placement. The forge's +2/+1 is replaced, not added again.
 */
export async function assignAbilityBoost(playerId: string, characterId: unknown, boostBody: unknown): Promise<Character> {
  const parsed = AbilityBoostSchema.safeParse(boostBody);
  if (!parsed.success) throw badRequest(`boost: ${zodMessage(parsed.error)}`);
  const hero = await ownCharacter(playerId, characterId);
  if (hero.sheet.abilityBoost) throw conflict('the ability bonuses are already chosen');
  const sheet = rulesOrBad(() => withChosenBoost(hero.sheet, hero.id, parsed.data));
  const now = new Date().toISOString();
  await getStore().saveCharacter(storable({ ...hero, sheet, updatedAt: now }));
  return upgradeCharacter({ ...storable({ ...hero, sheet, updatedAt: now }) });
}

/**
 * The sheet a table sends home, with the background increases the player placed at home while the hero was
 * seated: the table plays the copy it seated, so without this the end of the adventure would undo them.
 * Left as the table sent it when the placement no longer fits (its scores have since changed).
 */
export function homecoming(id: string, home: CharacterSheet | undefined, back: CharacterSheet): CharacterSheet {
  const placed = home?.abilityBoost;
  if (!placed || sameBoost(back.abilityBoost, placed)) return back;
  let sheet: CharacterSheet;
  try {
    sheet = withChosenBoost(back, id, placed);
  } catch {
    return back;
  }
  return back.hp === back.maxHp ? { ...sheet, hp: sheet.maxHp } : sheet;
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
