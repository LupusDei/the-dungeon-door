import { z } from 'zod';
import { isValid } from './catalog.ts';
import { badRequest, forbidden, isUUID, notFound } from './http.ts';
import { getStore } from './store/index.ts';
import type { Character } from './types.ts';

const catalogId = (kind: Parameters<typeof isValid>[0]) =>
  z.string().refine((v) => isValid(kind, v), { message: `unknown ${kind}` });

/** The parts of a character that describe it (what POST /api/portrait needs). */
export const CharacterLookInput = z.object({
  name: z.string().trim().min(1).max(40),
  race: catalogId('race'),
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
  const existing = await store.getCharacter(parsed.data.id);
  if (existing && existing.ownerId !== playerId) throw forbidden('that character belongs to another player');
  const now = new Date().toISOString();
  const c = parsed.data;
  return store.saveCharacter({
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
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
}

export async function listCharacters(playerId: string): Promise<Character[]> {
  return getStore().listCharacters(playerId);
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
  return character;
}
