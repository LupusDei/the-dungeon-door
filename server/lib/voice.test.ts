import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.DD_FAKE_AI = '1';
delete process.env.DD_FAKE_DELAY_MS;

import { joinAudio, MAX_SPOKEN_CHARACTERS, narrate, narratorVoice, passages, silentWav, spokenText } from './voice.ts';

test('spokenText: the parts in order as paragraphs, without markup or empty lines', () => {
  assert.equal(spokenText('The door  opens.', null, 'A *bell* tolls.\n\n\n# Below\nSomething stirs.'), 'The door opens.\n\nA bell tolls.\n\nBelow\n\nSomething stirs.');
  assert.equal(spokenText(null, '  ', undefined), '');
});

test('spokenText: a reading too long is cut at the end of a sentence', () => {
  const long = spokenText('A short sentence here. '.repeat(400));
  assert.ok(long.length <= MAX_SPOKEN_CHARACTERS && long.length > MAX_SPOKEN_CHARACTERS - 40, String(long.length));
  assert.ok(long.endsWith('here.'));
});

test('passages: short paragraphs are joined, a long one is cut at sentence ends, and no word is lost', () => {
  const sentence = (n: number) => `Sentence number ${n} walks slowly down the long stair and stops.`;
  const longParagraph = Array.from({ length: 16 }, (_, i) => sentence(i)).join(' ');
  const text = ['One.', 'Two.', longParagraph, 'Last words.'].join('\n\n');
  const parts = passages(text, 200);
  assert.ok(parts[0].startsWith('One.\n\nTwo.\n\nSentence number 0'), 'short neighbours share a passage');
  assert.ok(parts.length > 5 && parts.every((p) => p.length <= 200), parts.map((p) => p.length).join(','));
  assert.ok(parts.slice(1, -1).every((p) => /stops\.$/.test(p) || p.endsWith('Last words.')), 'cut only where a sentence ends');
  assert.equal(parts.join(' ').replace(/\s+/g, ' '), text.replace(/\s+/g, ' '));
  assert.deepEqual(passages('Only this.'), ['Only this.']);
  assert.deepEqual(passages(''), []);
});

const dataOf = (wav: Uint8Array) => Buffer.from(wav).subarray(44);

test('joinAudio: WAV passages become one WAV, in order, with a short pause between', () => {
  const tone = (value: number, seconds: number) => { const w = Buffer.from(silentWav(seconds)); w.fill(value, 44); return new Uint8Array(w); };
  const joined = joinAudio([{ bytes: tone(1, 1), mediaType: 'audio/wav' }, { bytes: tone(2, 0.5), mediaType: 'audio/wav' }]);
  const b = Buffer.from(joined.bytes);
  assert.equal(joined.mediaType, 'audio/wav');
  assert.equal(b.toString('latin1', 0, 4) + b.toString('latin1', 8, 16) + b.toString('latin1', 36, 40), 'RIFFWAVEfmt data');
  assert.equal(b.readUInt32LE(4), b.length - 8, 'the RIFF size covers the file');
  const data = dataOf(joined.bytes);
  assert.equal(b.readUInt32LE(40), data.length);
  const gap = 0.4 * 8000 * 2;
  assert.equal(data.length, 16000 + gap + 8000);
  assert.ok(data.subarray(0, 16000).every((v) => v === 1) && data.subarray(16000, 16000 + gap).every((v) => v === 0) && data.subarray(16000 + gap).every((v) => v === 2));
});

test('joinAudio: one passage is itself; MP3 passages follow one another without their tags; mixed formats are refused', () => {
  const only = { bytes: silentWav(), mediaType: 'audio/wav' };
  assert.equal(joinAudio([only]), only);
  const id3 = (frames: number[]) => new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 3, 9, 9, 9, ...frames]);
  const joined = joinAudio([{ bytes: id3([0xff, 0xfb, 1]), mediaType: 'audio/mpeg' }, { bytes: id3([0xff, 0xfb, 2]), mediaType: 'audio/mpeg' }]);
  assert.deepEqual([...joined.bytes.subarray(13)], [0xff, 0xfb, 1, 0xff, 0xfb, 2], 'the first keeps its tag, the second gives only frames');
  assert.throws(() => joinAudio([only, { bytes: new Uint8Array([0xff, 0xfb]), mediaType: 'audio/mpeg' }]), /different audio formats/);
});

test('narrate: with the fake narrator a reading is a WAV, one passage after another', async () => {
  const one = await narrate('A short tale.');
  assert.equal(one.mediaType, 'audio/wav');
  const three = await narrate(['First.', 'Second.', 'Third.'].map((s) => s + ' ' + 'word '.repeat(90)).join('\n\n'));
  assert.ok(dataOf(three.bytes).length > 2 * dataOf(one.bytes).length, 'three passages, joined');
  await assert.rejects(narrate(''), /nothing to read/);
});

test('narratorVoice: the env picks the model, the voice, the direction and the speed', () => {
  const base = narratorVoice({});
  assert.match(base.model, /^[a-z-]+\//);
  assert.equal(base.speed, null);
  assert.deepEqual(narratorVoice({ DD_VOICE_MODEL: 'openai/tts-1-hd', DD_VOICE_NAME: 'onyx', DD_VOICE_STYLE: 'Slowly.', DD_VOICE_SPEED: '0.9' }),
    { model: 'openai/tts-1-hd', voice: 'onyx', style: 'Slowly.', speed: 0.9 });
  assert.equal(narratorVoice({ DD_VOICE_SPEED: 'fast' }).speed, null);
});
