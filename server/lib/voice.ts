/**
 * The narrator: one voice that reads a scene aloud. Speech goes through the AI Gateway like the game's
 * other models (lib/models.ts), so the owner can change the voice with env vars alone:
 *   DD_VOICE_MODEL  — a gateway speech model (https://ai-gateway.vercel.sh/v1/models, type "speech").
 *   DD_VOICE_NAME   — the voice, as that model names it (a prebuilt voice name, or a provider voice id).
 *   DD_VOICE_STYLE  — how to deliver it, for models that take directions; others ignore it.
 *   DD_VOICE_SPEED  — playback speed for models that take one (1 is normal).
 * The voice is an original design: an old storyteller, never an imitation of a real person.
 *
 * A reading is split into passages that are spoken at the same time and joined, so a long scene takes about
 * as long to make as its longest paragraph.
 */
import { generateSpeech } from 'ai';
import { fakeAI, fakeDelay } from './models.ts';

export const DEFAULT_VOICE_MODEL = 'google/gemini-3.8-flash-tts';
export const DEFAULT_VOICE_NAME = 'Charon';
export const DEFAULT_VOICE_STYLE =
  'An old storyteller with a deep, low, gravelly voice, aged and warm. He tells the tale at a flowing pace, ' +
  'as brisk as a radio newsreader, with short pauses only between sentences. Grave when the tale darkens, ' +
  'a dry twinkle when it lightens. Read every word as written and add none.';

export interface NarratorVoice {
  model: string;
  voice: string;
  style: string;
  speed: number | null;
}

export function narratorVoice(env: NodeJS.ProcessEnv = process.env): NarratorVoice {
  const speed = Number(env.DD_VOICE_SPEED);
  return {
    model: env.DD_VOICE_MODEL || DEFAULT_VOICE_MODEL,
    voice: env.DD_VOICE_NAME || DEFAULT_VOICE_NAME,
    style: env.DD_VOICE_STYLE || DEFAULT_VOICE_STYLE,
    speed: Number.isFinite(speed) && speed > 0 ? speed : null,
  };
}

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

/** Reads `text` aloud in the narrator's voice. One paid call (see docs/dungeon-master.md, "The narrator"). */
export async function speak(text: string, voice: NarratorVoice = narratorVoice()): Promise<SpokenAudio> {
  if (fakeAI()) {
    await fakeDelay();
    // As long as the words would take, so the app's "playing" state can be seen locally.
    return { bytes: silentWav(Math.max(1, Math.min(20, text.length / 15))), mediaType: 'audio/wav' };
  }
  const result = await generateSpeech({
    model: voice.model,
    text,
    voice: voice.voice,
    instructions: voice.style,
    ...(voice.speed !== null && { speed: voice.speed }),
    ...(formatFor(voice.model) && { outputFormat: formatFor(voice.model) }),
  });
  for (const warning of result.warnings ?? []) console.warn(`narrator (${voice.model}):`, JSON.stringify(warning));
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

/** An MP3 without its ID3v2 tag: frames only, so files can follow one another. */
function mp3Frames(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return bytes;
  const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
  return bytes.subarray(10 + size);
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
  return { bytes: new Uint8Array(Buffer.concat(parts.map((p, i) => (i === 0 ? p.bytes : mp3Frames(p.bytes))))), mediaType: parts[0].mediaType };
}

/** How many passages are spoken at once. */
const AT_ONCE = 4;

/** Reads a whole scene aloud: its passages spoken at the same time, joined in order. One paid call per passage. */
export async function narrate(text: string, voice: NarratorVoice = narratorVoice()): Promise<SpokenAudio> {
  const parts = passages(text);
  if (parts.length === 0) throw new Error('nothing to read');
  const spoken = new Array<SpokenAudio>(parts.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < parts.length; i = next++) spoken[i] = await speak(parts[i], voice);
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, parts.length) }, worker));
  return joinAudio(spoken);
}
