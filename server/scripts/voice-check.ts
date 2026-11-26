/**
 * Hears the narrator: one real speech call through the AI Gateway, saved to a file to listen to. Costs a
 * cent or two (it is billed by the character or by the second, by model). Run from server/:
 *
 *   npm run voice:check                                  # the configured narrator, to ./narrator.<ext>
 *   npm run voice:check -- --out /tmp/a --voice Algenib  # try another voice of the same model
 *   npm run voice:check -- --model openai/tts-1-hd --voice onyx --speed 0.9
 *   npm run voice:check -- --text "Read this instead."
 */
import { writeFileSync } from 'node:fs';
import { narrate, narratorVoice, passages, spokenText } from '../lib/voice.ts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const SAMPLE =
  'The door groans open on a hall of drowned statues. Water drips from the vaulted dark, and somewhere below, ' +
  'a bell tolls once, though no hand rings it.\n\nBryn lifts her lantern. The light finds wet stone, a broken ' +
  'crown, and a stair going down. Whatever waits beneath has heard you come.';

const base = narratorVoice();
const voice = {
  model: arg('model') ?? base.model,
  voice: arg('voice') ?? base.voice,
  style: arg('style') ?? base.style,
  speed: arg('speed') ? Number(arg('speed')) : base.speed,
};
const text = spokenText(arg('text') ?? SAMPLE);
const started = Date.now();
const audio = await narrate(text, voice);
const ext = audio.mediaType.includes('wav') ? 'wav' : audio.mediaType.includes('mpeg') || audio.mediaType.includes('mp3') ? 'mp3' : audio.mediaType.split('/')[1] ?? 'bin';
const out = `${arg('out') ?? 'narrator'}.${ext}`;
writeFileSync(out, audio.bytes);
console.log(JSON.stringify({ model: voice.model, voice: voice.voice, speed: voice.speed, characters: text.length, passages: passages(text).length, mediaType: audio.mediaType, bytes: audio.bytes.length, seconds: (Date.now() - started) / 1000, out }));
