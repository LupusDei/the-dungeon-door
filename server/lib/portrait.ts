import { z } from 'zod';
import { describeAppearance, portraitPrompt, renderImage } from './ai.ts';
import { CharacterLookInput, zodMessage } from './characters.ts';
import { badRequest } from './http.ts';
import { getImageStore } from './images/index.ts';

const PortraitInput = z.object({
  character: CharacterLookInput,
  previousAppearance: z.string().max(2000).optional(),
  note: z.string().max(300).optional(),
});

/** POST /api/portrait — embellish the look, paint the portrait, store it. */
export async function makePortrait(body: unknown, origin: string): Promise<{ appearance: string; portraitUrl: string }> {
  const parsed = PortraitInput.safeParse(body);
  if (!parsed.success) throw badRequest(zodMessage(parsed.error));
  const { character, previousAppearance, note } = parsed.data;
  const appearance = await describeAppearance(character, previousAppearance?.trim() || undefined, note?.trim() || undefined);
  const image = await renderImage({
    prompt: portraitPrompt(character, appearance),
    aspectRatio: '1:1',
    seed: `${character.name}:${appearance}`,
  });
  const portraitUrl = await getImageStore().save(image, 'portraits', origin);
  return { appearance, portraitUrl };
}
