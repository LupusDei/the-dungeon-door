import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.DD_FAKE_AI = '1';
delete process.env.DD_FAKE_DELAY_MS;

import { DEFAULT_NARRATOR, defaultNarrator, joinAudio, MAX_SPOKEN_CHARACTERS, mp3Frames, narrate, narratorOf, NARRATORS, passages, publicNarrators, silentWav, spokenText } from './voice.ts';

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

/** An MPEG 1 Layer III frame at 128 kbps, 44.1 kHz (417 bytes), filled with `fill`, optionally declaring a length. */
function mp3Frame(fill: number, note = ''): number[] {
  const frame = new Array<number>(417).fill(fill);
  frame.splice(0, 4, 0xff, 0xfb, 0x90, 0x00);
  [...note].forEach((ch, k) => { frame[36 + k] = ch.charCodeAt(0); });
  return frame;
}
const id3 = (...frames: number[][]) => new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 3, 9, 9, 9, ...frames.flat()]);

test('mp3Frames: the tag and the frame that declares the length go; the sound frames stay', () => {
  assert.deepEqual([...mp3Frames(id3(mp3Frame(0, 'Info'), mp3Frame(1)))], mp3Frame(1));
  assert.deepEqual([...mp3Frames(id3(mp3Frame(0, 'Xing'), mp3Frame(1), mp3Frame(2)))], [...mp3Frame(1), ...mp3Frame(2)]);
  assert.deepEqual([...mp3Frames(new Uint8Array(mp3Frame(5)))], mp3Frame(5), 'a file with neither is left alone');
  assert.deepEqual([...mp3Frames(new Uint8Array([1, 2, 3]))], [1, 2, 3], 'not an MP3: untouched');
});

test('joinAudio: one passage is itself; MP3 passages follow one another as sound frames only; mixed formats are refused', () => {
  const only = { bytes: silentWav(), mediaType: 'audio/wav' };
  assert.equal(joinAudio([only]), only);
  const joined = joinAudio([{ bytes: id3(mp3Frame(0, 'Info'), mp3Frame(1)), mediaType: 'audio/mpeg' }, { bytes: id3(mp3Frame(0, 'Info'), mp3Frame(2)), mediaType: 'audio/mpeg' }]);
  assert.deepEqual([...joined.bytes], [...mp3Frame(1), ...mp3Frame(2)], 'a player that trusted the first length frame would stop after the first passage');
  assert.throws(() => joinAudio([only, { bytes: new Uint8Array([0xff, 0xfb]), mediaType: 'audio/mpeg' }]), /different audio formats/);
});

test('narrate: with the fake narrator a reading is a WAV, one passage after another', async () => {
  const one = await narrate('A short tale.');
  assert.equal(one.mediaType, 'audio/wav');
  const three = await narrate(['First.', 'Second.', 'Third.'].map((s) => s + ' ' + 'word '.repeat(90)).join('\n\n'));
  assert.ok(dataOf(three.bytes).length > 2 * dataOf(one.bytes).length, 'three passages, joined');
  await assert.rejects(narrate(''), /nothing to read/);
});

test('the narrators: four to choose from, the storyteller by default, and DD_VOICE picks another', () => {
  assert.deepEqual(NARRATORS.map((n) => n.id), ['george-storyteller', 'george', 'charon', 'algenib']);
  assert.equal(new Set(NARRATORS.map((n) => n.id)).size, NARRATORS.length);
  assert.equal(defaultNarrator({}).id, DEFAULT_NARRATOR);
  assert.equal(defaultNarrator({ DD_VOICE: 'charon' }).id, 'charon');
  assert.equal(defaultNarrator({ DD_VOICE: 'nobody' }).id, DEFAULT_NARRATOR, 'an unknown id falls back');
  assert.equal(narratorOf('nobody'), null);
  for (const n of NARRATORS) {
    assert.match(n.model, /^[a-z-]+\/[a-z0-9.-]+$/, n.id);
    assert.ok(n.name && n.description && n.voice, n.id);
    assert.ok(!(n.style && n.tags), `${n.id}: direction is given one way, by instructions or by tags`);
    if (n.tags) assert.match(n.tags, /^(\[[^\]]+\] ?)+$/, 'tags are bracketed directions');
  }
  assert.deepEqual(publicNarrators()[0], { id: 'george-storyteller', name: 'George, the old storyteller', description: 'Low and grave: a tale told slowly by the fire.' });
  assert.deepEqual(Object.keys(publicNarrators()[2]).sort(), ['description', 'id', 'name'], 'the model and the voice id stay on the server');
});
