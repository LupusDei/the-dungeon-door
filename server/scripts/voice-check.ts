/**
 * Hears a narrator: real speech calls through the AI Gateway, saved to a file to listen to. Costs a few cents
 * (billed by the character or by the second of audio, by model). Run from server/:
 *
 *   npm run voice:check                                   # the default narrator, to ./narrator.<ext>
 *   npm run voice:check -- --narrator charon --out /tmp/a # one of the presets in lib/voice.ts
 *   npm run voice:check -- --model elevenlabs/eleven-v4 --voice <voice id> --tags "[low, gravelly voice]"
 *   npm run voice:check -- --model openai/tts-1-hd --voice onyx --speed 0.9
 *   npm run voice:check -- --text "Read this instead."
 *
 * --model, --voice, --style, --tags and --speed change the chosen narrator for this run, to try a candidate.
 */
import { writeFileSync } from 'node:fs';
import { defaultNarrator, narrate, type Narrator, narratorOf, NARRATORS, passages, spokenText } from '../lib/voice.ts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const SAMPLE =
  'The door groans open on a hall of drowned statues. Water drips from the vaulted dark, and somewhere below, ' +
  'a bell tolls once, though no hand rings it.\n\nBryn lifts her lantern. The light finds wet stone, a broken ' +
  'crown, and a stair going down. Whatever waits beneath has heard you come.';

const named = arg('narrator');
const base = named ? narratorOf(named) : defaultNarrator();
if (!base) {
  console.error(`No narrator "${named}". There are: ${NARRATORS.map((n) => n.id).join(', ')}.`);
  process.exit(1);
}
// A candidate that names its own model or voice starts clean: another model's direction would not apply.
const fresh = arg('model') !== undefined || arg('voice') !== undefined;
const narrator: Narrator = {
  ...base,
  ...(fresh && { id: 'candidate', style: undefined, tags: undefined, speed: undefined }),
  ...(arg('model') && { model: arg('model') }),
  ...(arg('voice') && { voice: arg('voice') }),
  ...(arg('style') && { style: arg('style') }),
  ...(arg('tags') && { tags: arg('tags') }),
  ...(arg('speed') && { speed: Number(arg('speed')) }),
};
const text = spokenText(arg('text') ?? SAMPLE);
const started = Date.now();
const audio = await narrate(text, narrator);
const ext = audio.mediaType.includes('wav') ? 'wav' : audio.mediaType.includes('mpeg') || audio.mediaType.includes('mp3') ? 'mp3' : audio.mediaType.split('/')[1] ?? 'bin';
const out = `${arg('out') ?? 'narrator'}.${ext}`;
writeFileSync(out, audio.bytes);
console.log(JSON.stringify({ narrator: narrator.id, model: narrator.model, voice: narrator.voice, characters: text.length, passages: passages(text).length, mediaType: audio.mediaType, bytes: audio.bytes.length, seconds: (Date.now() - started) / 1000, out }));
