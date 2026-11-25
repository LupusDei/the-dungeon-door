/**
 * AI Gateway model ids (`provider/model`, see https://ai-gateway.vercel.sh/v1/models). Read at call time so
 * the owner can swap models with env vars alone:
 *   DD_TEXT_MODEL   — the DM and the portrait describer (any structured-output language model).
 *   DD_IMAGE_MODEL  — portraits and scene art. Gemini image models ("Nano Banana") take the party's
 *                     portraits as reference images through generateText; any image-only model
 *                     (e.g. openai/gpt-image-2, bfl/flux-kontext-pro) goes through generateImage.
 *   DD_IMAGE_API    — force "text" (generateText with image output) or "image" (generateImage).
 *   DD_FAKE_AI=1    — no network at all: deterministic fake text and placeholder PNGs.
 */
export const DEFAULT_TEXT_MODEL = 'anthropic/claude-sonnet-5.5';
export const DEFAULT_IMAGE_MODEL = 'google/gemini-3.1-flash-image';

export const textModel = () => process.env.DD_TEXT_MODEL || DEFAULT_TEXT_MODEL;
export const imageModel = () => process.env.DD_IMAGE_MODEL || DEFAULT_IMAGE_MODEL;

/** Whether the image model is a multimodal language model (image output via generateText). */
export function imageViaText(model = imageModel()): boolean {
  const forced = process.env.DD_IMAGE_API;
  if (forced === 'text') return true;
  if (forced === 'image') return false;
  return /^google\/gemini-.*image/.test(model);
}

export const fakeAI = () => process.env.DD_FAKE_AI === '1' || process.env.DD_FAKE_AI === 'true';

/** Optional artificial latency for fake AI, so the app's "preparing"/"painting" states can be seen locally. */
export async function fakeDelay(): Promise<void> {
  const ms = Number(process.env.DD_FAKE_DELAY_MS ?? 0);
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
}
