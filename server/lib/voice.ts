/**
 * The narrators: the voices that read a scene aloud. Speech goes through the AI Gateway like the game's other
 * models (lib/models.ts). Each narrator is a preset below: a speech model, one of its voices, and how to
 * deliver it. A player picks one in the app (the catalog lists them); `DD_VOICE` sets which one is the
 * default (a narrator id).
 *
 * Every voice here is a stock synthetic voice with our own direction: never an imitation of a real person or
 * of a known performance.
 *
 * A reading is split into passages that are spoken at the same time and joined, so a long scene takes about
 * as long to make as its longest paragraph.
 */
import { generateSpeech } from 'ai';
import { fakeAI, fakeDelay } from './models.ts';

export interface Narrator {
  /** Kept with every reading made in this voice, so never reuse an id for a different voice. */
  id: string;
  name: string;
  /** One line for the app's picker. */
  description: string;
  /** A gateway speech model (https://ai-gateway.vercel.sh/v1/models, type "speech"). */
  model: string;
  /** The voice as that model names it: a prebuilt voice name, or a provider's voice id. */
  voice: string;
  /** Delivery, for models that take directions beside the text (Google). */
  style?: string;
  /** Delivery written into the text, at the head of every passage: ElevenLabs v3 and v4 audio tags. Billed as characters. */
  tags?: string;
  /** Playback speed, for models that take one (1 is normal). */
  speed?: number;
}

const BRISK =
  'An old storyteller with a deep, low, gravelly voice, aged and warm. He tells the tale at a flowing pace, ' +
  'as brisk as a radio newsreader, with short pauses only between sentences. Grave when the tale darkens, ' +
  'a dry twinkle when it lightens. Read every word as written and add none.';
const STEADY =
  'An old storyteller reading by a fire. A deep, low, gravelly male voice, aged and warm, at a steady, ' +
  'measured pace: unhurried, never slow. Grave when the tale darkens, a dry twinkle when it lightens. ' +
  'Clear diction and weight on the words that matter. Read every word as written and add none.';

/** ElevenLabs' stock voice "George". ElevenLabs withdraws its stock ("default") voices on 31 December 2026. */
const GEORGE = 'JBFqnCBsd6RMkjVDRZzb';

/** In the order the app lists them. design/narrator/README.md has each one's sample and measurements. */
export const NARRATORS: readonly Narrator[] = [
  {
    id: 'george-storyteller', name: 'George, the old storyteller', description: 'Low and grave: a tale told slowly by the fire.',
    model: 'elevenlabs/eleven-v4', voice: GEORGE, tags: '[low, gravelly voice] [an old storyteller, slow and grave]',
  },
  { id: 'george', name: 'George', description: 'A warm British storyteller, as he comes.', model: 'elevenlabs/eleven-v4', voice: GEORGE },
  { id: 'charon', name: 'Charon', description: 'Deep and steady, at a newsreader\u2019s pace.', model: 'google/gemini-3.8-flash-tts', voice: 'Charon', style: BRISK },
  { id: 'algenib', name: 'Algenib', description: 'Gravelly and unhurried.', model: 'google/gemini-3.8-flash-tts', voice: 'Algenib', style: STEADY },
];

export const DEFAULT_NARRATOR = 'george-storyteller';

export const narratorOf = (id: string): Narrator | null => NARRATORS.find((n) => n.id === id) ?? null;

/** The narrator a request gets when it names none: `DD_VOICE` if it names one of ours, else the house default. */
export function defaultNarrator(env: NodeJS.ProcessEnv = process.env): Narrator {
  return narratorOf(env.DD_VOICE ?? '') ?? narratorOf(DEFAULT_NARRATOR)!;
}

/** The narrators as the app's picker shows them. */
export const publicNarrators = () => NARRATORS.map(({ id, name, description }) => ({ id, name, description }));

export interface SpokenAudio {
  bytes: Uint8Array;
  mediaType: string;
}

/** The longest text one reading takes: a long scene is about 1,500 characters. */
export const MAX_SPOKEN_CHARACTERS = 4000;

/** Text as the narrator reads it: paragraphs joined by a pause, no markup, capped. */
export function spokenText(...parts: (string | null | undefined)[]): string {
  const text = parts
    .flatMap((part) => (part ?? '').split(/\n+/))
    .map((line) => line.replace(/[*_#`>]+/g, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
  if (text.length <= MAX_SPOKEN_CHARACTERS) return text;
  const cut = text.slice(0, MAX_SPOKEN_CHARACTERS);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return end > MAX_SPOKEN_CHARACTERS / 2 ? cut.slice(0, end + 1) : cut;
}

/** Quiet, as a WAV: what the fake narrator "says" (16-bit mono, 8 kHz). */
export function silentWav(seconds = 1): Uint8Array {
  const rate = 8000;
  const samples = Math.round(rate * seconds);
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + samples * 2, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  return new Uint8Array(wav);
}

/** Google's speech models return WAV; the others are asked for MP3, which is a tenth the size. */
const formatFor = (model: string) => (model.startsWith('google/') ? undefined : 'mp3');

/** Reads `text` aloud in a narrator's voice. One paid call (see docs/dungeon-master.md, "The narrator"). */
export async function speak(text: string, narrator: Narrator = defaultNarrator()): Promise<SpokenAudio> {
  if (fakeAI()) {
    await fakeDelay();
    // As long as the words would take, so the app's "playing" state can be seen locally.
    return { bytes: silentWav(Math.max(1, Math.min(20, text.length / 15))), mediaType: 'audio/wav' };
  }
  const format = formatFor(narrator.model);
  const result = await generateSpeech({
    model: narrator.model,
    text: narrator.tags ? `${narrator.tags} ${text}` : text,
    voice: narrator.voice,
    ...(narrator.style && { instructions: narrator.style }),
    ...(narrator.speed && { speed: narrator.speed }),
    ...(format && { outputFormat: format }),
  });
  for (const warning of result.warnings ?? []) console.warn(`narrator ${narrator.id} (${narrator.model}):`, JSON.stringify(warning));
  return { bytes: result.audio.uint8Array, mediaType: result.audio.mediaType || 'audio/mpeg' };
}

/** About how long one passage is: a paragraph. Shorter passages are ready sooner; longer ones flow better. */
const PASSAGE_CHARACTERS = 420;

/** Splits a reading into passages spoken separately: paragraphs, a long one cut at sentence ends, short ones joined. */
export function passages(text: string, target = PASSAGE_CHARACTERS): string[] {
  const pieces = text.split(/\n+/).map((p) => p.trim()).filter(Boolean).flatMap((paragraph) => {
    if (paragraph.length <= target * 1.5) return [paragraph];
    const sentences = paragraph.split(/(?<=[.!?\u2026]["'\u201d\u2019)]?)\s+/);
    return sentences.reduce<string[]>((out, sentence) => {
      const last = out[out.length - 1];
      if (last !== undefined && last.length + sentence.length + 1 <= target) out[out.length - 1] = `${last} ${sentence}`;
      else out.push(sentence);
      return out;
    }, []);
  });
  return pieces.reduce<string[]>((out, piece) => {
    const last = out[out.length - 1];
    if (last !== undefined && last.length + piece.length + 2 <= target) out[out.length - 1] = `${last}\n\n${piece}`;
    else out.push(piece);
    return out;
  }, []);
}

interface Wav { format: Buffer; data: Buffer; byteRate: number; blockAlign: number }

/** The format and samples of a RIFF/WAVE file, or null for anything else. */
function readWav(bytes: Uint8Array): Wav | null {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.length < 12 || b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WAVE') return null;
  let format: Buffer | null = null;
  for (let at = 12; at + 8 <= b.length; ) {
    const id = b.toString('latin1', at, at + 4);
    const declared = b.readUInt32LE(at + 4);
    const size = Math.min(declared, b.length - at - 8); // a streamed file may declare more than it holds
    if (id === 'fmt ') format = b.subarray(at + 8, at + 8 + size);
    if (id === 'data' && format) return { format, data: b.subarray(at + 8, at + 8 + size), byteRate: format.readUInt32LE(8), blockAlign: format.readUInt16LE(12) };
    at += 8 + size + (size % 2);
  }
  return null;
}

/** The pause between two passages. */
const GAP_SECONDS = 0.4;

function joinWavs(wavs: Wav[]): Uint8Array {
  const [{ format, byteRate, blockAlign }] = wavs;
  const gap = Buffer.alloc(Math.round((byteRate * GAP_SECONDS) / blockAlign) * blockAlign);
  const data = Buffer.concat(wavs.flatMap((w, i) => (i === 0 ? [w.data] : [gap, w.data])));
  const header = Buffer.alloc(12);
  header.write('RIFF', 0);
  header.writeUInt32LE(4 + 8 + format.length + 8 + data.length, 4);
  header.write('WAVE', 8);
  const chunk = (id: string, size: number) => { const h = Buffer.alloc(8); h.write(id, 0); h.writeUInt32LE(size, 4); return h; };
  return new Uint8Array(Buffer.concat([header, chunk('fmt ', format.length), format, chunk('data', data.length), data]));
}

const MP3_KBPS = { 1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] } as const;
const MP3_HZ = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] } as const;

/** The length in bytes of the MPEG Layer III frame that starts at `at`, or 0 if none does. */
function mp3FrameLength(b: Uint8Array, at: number): number {
  if (at + 4 > b.length || b[at] !== 0xff || (b[at + 1] & 0xe0) !== 0xe0 || ((b[at + 1] >> 1) & 3) !== 1) return 0;
  const version = (b[at + 1] >> 3) & 3; // 3: MPEG 1, 2: MPEG 2, 0: MPEG 2.5
  const kbps = MP3_KBPS[version === 3 ? 1 : 2][b[at + 2] >> 4];
  const hz = (MP3_HZ as Record<number, readonly number[]>)[version]?.[(b[at + 2] >> 2) & 3];
  if (!kbps || !hz) return 0;
  return Math.floor(((version === 3 ? 144 : 72) * kbps * 1000) / hz) + ((b[at + 2] >> 1) & 1);
}

/**
 * An MP3 as sound frames only, so files can follow one another: without its ID3v2 tag, and without the
 * silent first frame that says how long the file is ("Xing" or "Info"). A player that trusts that frame
 * would stop where the first passage ends; with none, it works the length out from the file itself.
 */
export function mp3Frames(bytes: Uint8Array): Uint8Array {
  let at = 0;
  if (bytes.length >= 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    at = 10 + (((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f));
  }
  const first = mp3FrameLength(bytes, at);
  if (first > 0) {
    const frame = Buffer.from(bytes.buffer, bytes.byteOffset + at, Math.min(first, bytes.length - at)).toString('latin1');
    if (frame.includes('Xing') || frame.includes('Info')) at += first;
  }
  return bytes.subarray(at);
}

/** Passages as one file, in order: WAVs with the same format are joined with a short pause, MP3s frame after frame. */
export function joinAudio(parts: SpokenAudio[]): SpokenAudio {
  if (parts.length === 1) return parts[0];
  const wavs = parts.map((p) => readWav(p.bytes));
  if (wavs.every((w): w is Wav => w !== null)) {
    if (!wavs.every((w) => w.format.equals(wavs[0].format))) throw new Error('the passages came back in different audio formats');
    return { bytes: joinWavs(wavs), mediaType: 'audio/wav' };
  }
  if (wavs.some((w) => w !== null) || !parts.every((p) => p.mediaType === parts[0].mediaType)) throw new Error('the passages came back in different audio formats');
  return { bytes: new Uint8Array(Buffer.concat(parts.map((p) => mp3Frames(p.bytes)))), mediaType: parts[0].mediaType };
}

/** How many passages are spoken at once. */
const AT_ONCE = 4;

/** Reads a whole scene aloud: its passages spoken at the same time, joined in order. One paid call per passage. */
export async function narrate(text: string, narrator: Narrator = defaultNarrator()): Promise<SpokenAudio> {
  const parts = passages(text);
  if (parts.length === 0) throw new Error('nothing to read');
  const spoken = new Array<SpokenAudio>(parts.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < parts.length; i = next++) spoken[i] = await speak(parts[i], narrator);
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, parts.length) }, worker));
  return joinAudio(spoken);
}
