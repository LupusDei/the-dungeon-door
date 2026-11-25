import { generateImage, generateText, type FilePart, type TextPart } from 'ai';
import { nameOf } from './catalog.ts';
import type { StoredImage } from './images/index.ts';
import { placeholderPng } from './images/placeholder.ts';
import { fakeAI, fakeDelay, imageModel, imageViaText, textModel } from './models.ts';

/** The fixed house style every portrait shares, so a party looks like it belongs in one book. */
export const PORTRAIT_STYLE =
  'Painterly dark-fantasy tabletop-RPG character portrait, in the style of classic fantasy rulebook ' +
  'illustration: rich oil-paint brushwork, bust to three-quarter view, the character facing slightly ' +
  'off-camera, dramatic chiaroscuro lighting with a warm rim light, moody softly blurred background ' +
  'that hints at their world, detailed costume and gear, expressive face. Square composition, no text, ' +
  'no border, no frame, a single character.';

/** House style for scene art; the DM archetype adds its own art direction on top. */
export const SCENE_STYLE =
  'Painterly fantasy tabletop-RPG scene illustration, rich oil-paint brushwork, cinematic wide ' +
  'composition, dramatic lighting, atmospheric depth. No text, no captions, no border, no UI.';

export interface CharacterLook {
  name: string;
  race: string;
  characterClass: string;
  gender: string;
  temperament: string;
  alignment: string;
  backstory: string;
  description: string;
}

const APPEARANCE_INSTRUCTIONS = `You are the art director for a fantasy tabletop RPG. Turn a player's character
sheet into ONE vivid visual description (about 80 words, a single paragraph) that a painter can use for a
portrait and that will be reused to draw the character consistently in later scenes.

- Describe only what can be seen: face, build, skin/hair/eyes, distinguishing marks, clothing, armour,
  weapons, colours, accessories, posture and expression.
- Honour everything the player wrote about their look exactly (e.g. a scar over the left eye, a red braid).
  Fill the gaps in a way that fits the race, class, temperament, alignment and backstory.
- Be specific and concrete (colours, materials) rather than poetic. No names of real people or artists.
- Plain prose, present tense, no preamble, no lists, no quotation marks.`;

function lookSheet(c: CharacterLook): string {
  return [
    `Name: ${c.name}`,
    `Race: ${nameOf('race', c.race)}`,
    `Class: ${nameOf('characterClass', c.characterClass)}`,
    `Gender: ${nameOf('gender', c.gender)}`,
    `Temperament: ${nameOf('temperament', c.temperament)}`,
    `Alignment: ${nameOf('alignment', c.alignment)}`,
    c.backstory && `Backstory: ${c.backstory}`,
    c.description && `The player describes their look as: ${c.description}`,
  ].filter(Boolean).join('\n');
}

/** The DM-embellished visual description of a character (re-rolls refine `previousAppearance` with `note`). */
export async function describeAppearance(c: CharacterLook, previousAppearance?: string, note?: string): Promise<string> {
  if (fakeAI()) {
    await fakeDelay();
    const base = previousAppearance ??
      `${c.name} is a ${nameOf('temperament', c.temperament).toLowerCase()} ${nameOf('race', c.race).toLowerCase()} ` +
      `${nameOf('characterClass', c.characterClass).toLowerCase()} with a weathered travelling cloak, keen eyes and ` +
      `well-worn gear that tells of many roads.${c.description ? ` ${c.description}.` : ''}`;
    return note ? `${base} (Adjusted: ${note}.)` : base;
  }
  const prompt = previousAppearance
    ? `${lookSheet(c)}\n\nCurrent description:\n${previousAppearance}\n\nRevise the current description with this ` +
      `change, keeping everything else the same: ${note || 'freshen the details'}`
    : lookSheet(c);
  const { text } = await generateText({ model: textModel(), instructions: APPEARANCE_INSTRUCTIONS, prompt });
  return text.trim();
}

export interface RenderRequest {
  prompt: string;
  /** Images the model should keep consistent with (e.g. the party's portraits). Best effort. */
  references?: StoredImage[];
  aspectRatio: '1:1' | '3:2';
  /** Seeds the fake placeholder. */
  seed?: string;
}

const PLACEHOLDER_SIZE = { '1:1': [512, 512], '3:2': [768, 512] } as const;

/**
 * Generates one image. With reference images it asks the model to keep those characters consistent; if
 * that fails it retries without references, then without provider options, before giving up.
 */
export async function renderImage(req: RenderRequest): Promise<StoredImage> {
  if (fakeAI()) {
    await fakeDelay();
    const [w, h] = PLACEHOLDER_SIZE[req.aspectRatio];
    return { bytes: placeholderPng(req.seed ?? req.prompt, w, h), mediaType: 'image/png' };
  }
  const references = (req.references ?? []).slice(0, 6);
  const attempts: { refs: StoredImage[]; options: boolean }[] = [];
  if (references.length) attempts.push({ refs: references, options: true });
  attempts.push({ refs: [], options: true }, { refs: [], options: false });

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      return imageViaText() ? await renderViaText(req, attempt.refs, attempt.options) : await renderViaImageModel(req, attempt.refs);
    } catch (error) {
      lastError = error;
      console.warn(`image attempt failed (refs: ${attempt.refs.length}, options: ${attempt.options}):`, error);
      if (!imageViaText() && !attempt.refs.length) break; // generateImage has no options to drop
    }
  }
  throw lastError;
}

async function renderViaText(req: RenderRequest, refs: StoredImage[], withOptions: boolean): Promise<StoredImage> {
  const text = refs.length
    ? `${req.prompt}\n\nThe attached images are reference portraits of the characters, numbered in the order ` +
      `attached (see "reference portrait N" above). Keep each character's face, hair, build, clothing and colours consistent with their ` +
      `portrait, but paint a new scene; do not copy the portraits' poses or backgrounds.`
    : req.prompt;
  const content: (TextPart | FilePart)[] = [
    ...refs.map((r): FilePart => ({ type: 'file', mediaType: r.mediaType, data: r.bytes })),
    { type: 'text', text: `${text}\n\nAspect ratio ${req.aspectRatio}. Respond with the image only.` },
  ];
  const result = await generateText({
    model: imageModel(),
    messages: [{ role: 'user', content }],
    ...(withOptions && { providerOptions: { google: { imageConfig: { aspectRatio: req.aspectRatio } } } }),
  });
  const file = result.files.find((f) => f.mediaType?.startsWith('image/'));
  if (!file) throw new Error(`image model returned no image${result.text ? `: ${result.text.slice(0, 200)}` : ''}`);
  return { bytes: file.uint8Array, mediaType: file.mediaType };
}

async function renderViaImageModel(req: RenderRequest, refs: StoredImage[]): Promise<StoredImage> {
  const { image } = await generateImage({
    model: imageModel(),
    prompt: refs.length ? { text: req.prompt, images: refs.map((r) => r.bytes) } : req.prompt,
    aspectRatio: req.aspectRatio,
  });
  return { bytes: image.uint8Array, mediaType: image.mediaType };
}

export function portraitPrompt(c: CharacterLook, appearance: string): string {
  return `${PORTRAIT_STYLE}\n\nThe character: ${c.name}, a ${nameOf('race', c.race)} ${nameOf('characterClass', c.characterClass)}. ${appearance}`;
}
