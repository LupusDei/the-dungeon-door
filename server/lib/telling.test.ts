/** How a game is told (lib/telling.ts): the telling asked for, and the limits a streamlined game is held to. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { archetype, publicCatalog } from './catalog.ts';
import { fakeDungeonMaster } from './dm/fake.ts';
import { dmInstructions, STREAMLINED_INSTRUCTIONS } from './dm/llm.ts';
import type { DMContext, Resolution } from './dm/types.ts';
import { HttpError } from './http.ts';
import { gameRow, gameUpdate } from './store/postgres.ts';
import {
  briefChoice, briefDetail, briefly, cutAt, DEFAULT_TELLING, isStreamlined, sentencesOf, storedTelling, STREAMLINED, streamlinedDraft,
  TELLING_IDS, tellingOf, wordCount,
} from './telling.ts';

process.env.DD_FAKE_DELAY_MS = '0';

test('the telling of a start: the full story unless a streamlined game is asked for; anything else is refused', () => {
  assert.equal(tellingOf(undefined), 'full');
  assert.equal(tellingOf(null), 'full');
  assert.equal(tellingOf('full'), 'full');
  assert.equal(tellingOf('streamlined'), 'streamlined');
  for (const bad of ['terse', '', 1, true, {}]) {
    assert.throws(() => tellingOf(bad), (e: unknown) => e instanceof HttpError && e.status === 400 && /telling must be/.test(e.message));
  }
  assert.equal(DEFAULT_TELLING, 'full');
  assert.deepEqual([isStreamlined('streamlined'), isStreamlined('full'), isStreamlined(undefined), isStreamlined(null)], [true, false, false, false]);
});

test('the catalog lists the tellings the server takes, the default first', () => {
  const { tellings } = publicCatalog();
  assert.deepEqual(tellings.map((t) => t.id), [...TELLING_IDS]);
  assert.equal(tellings[0].id, DEFAULT_TELLING);
  assert.equal(tellings.find((t) => t.id === 'streamlined')!.name, 'Streamlined');
  assert.ok(tellings.every((t) => t.name && t.blurb && t.symbol));
});

test('a stored telling reads as the full story unless it is one the engine knows', () => {
  assert.equal(storedTelling('streamlined'), 'streamlined');
  for (const old of [undefined, null, '', 'brief', 3]) assert.equal(storedTelling(old), 'full');
});

test('postgres: a game row from before tellings is told in full, and the telling is a column of its own', () => {
  const row = { code: 'ABCDEF', host_id: 'p1', status: 'lobby', dungeon_master: 'bard', title: null, scene_count: 4, scene_index: -1, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' };
  assert.equal(gameRow(row, [], []).telling, 'full');
  assert.equal(gameRow({ ...row, telling: 'streamlined' }, [], []).telling, 'streamlined');
  const { text, params } = gameUpdate('ABCDEF', { status: 'lobby' }, { status: 'preparing', telling: 'streamlined' });
  assert.equal(text, 'UPDATE games SET updated_at = now(), status = $2, telling = $3 WHERE code = $1 AND status = $4 RETURNING code');
  assert.deepEqual(params, ['ABCDEF', 'preparing', 'streamlined', 'lobby']);
});

test('text as sentences: stops, questions, ellipses and new lines end one; a closing quote stays with its sentence', () => {
  assert.deepEqual(sentencesOf('The gate is shut. Who goes there?  A horn sounds!'), ['The gate is shut.', 'Who goes there?', 'A horn sounds!']);
  assert.deepEqual(sentencesOf('The wolf waits…\n\nIts eyes are amber.'), ['The wolf waits…', 'Its eyes are amber.']);
  assert.deepEqual(sentencesOf('A sign reads "Keep out." The door is ajar'), ['A sign reads "Keep out."', 'The door is ajar']);
  assert.deepEqual(sentencesOf('   '), []);
});

test('briefly: the first sentences that fit, never more than asked for, and a hand-back question is not one of them', () => {
  const long = 'A wolf blocks the ford. A giant rat gnaws a satchel beside it. Mist hangs over the water. The road beyond climbs to the door.';
  assert.equal(briefly(long, { sentences: 2, words: 40 }), 'A wolf blocks the ford. A giant rat gnaws a satchel beside it.');
  assert.equal(briefly(long, { sentences: 1, words: 40 }), 'A wolf blocks the ford.');
  assert.equal(briefly('What do you do? A wolf blocks the ford. What do you say?', { sentences: 2, words: 40 }), 'A wolf blocks the ford.');
  assert.equal(briefly('What do you do?', { sentences: 2, words: 40 }), '', 'nothing but the question: the caller keeps its own fallback');
  // The second sentence would run past the words allowed, so the first stands alone.
  assert.equal(briefly('A wolf blocks the ford. Behind it a giant rat as long as a hound gnaws at a dead courier\'s satchel.', { sentences: 2, words: 12 }), 'A wolf blocks the ford.');
});

test('a single sentence longer than the limit is cut at a word, with an ellipsis', () => {
  const run = 'The wolf, lean and grey and scarred along one flank, pads out of the mist toward the ford, the rat scuttling after it';
  const cut = briefly(run, { sentences: 2, words: 8 });
  assert.equal(cut, 'The wolf, lean and grey and scarred along…');
  assert.equal(cutAt('one two three', 5), 'one two three');
  assert.equal(cutAt('one, two, three, four', 2), 'one, two…', 'no comma left hanging before the ellipsis');
  assert.equal(wordCount(' a  b\nc '), 3);
});

test('a streamlined choice is a few words and a clause of risk at most', () => {
  assert.equal(briefDetail('Burst in before anything inside can prepare, though the hinges will scream.'), 'Burst in before anything inside can prepare.');
  assert.equal(briefDetail('Quiet; slow.'), 'Quiet.');
  assert.equal(briefDetail(''), '');
  assert.equal(briefDetail('Take the long way round the lake and through the reeds and past the sleeping heron and on'), 'Take the long way round the lake and through the…');
  const choice = briefChoice({ id: 'a', label: 'Storm the gatehouse before the watch can bar the doors', detail: 'Loud. Very loud.', hook: 7 });
  assert.deepEqual(choice, { id: 'a', label: 'Storm the gatehouse before the watch…', detail: 'Loud.', hook: 7 });
  assert.ok(wordCount(choice.label) <= STREAMLINED.label.words);
});

test('a streamlined draft: two sentences of what stands before the party, one of what happened, and no aside', () => {
  const draft = {
    title: 'The Ford', imagePrompt: 'a ford',
    narration: 'Mist coils over the ford.\n\nA wolf stands in the shallows. A rat watches from the reeds. What do you do?',
    outcome: 'The party slips past unseen. The wolf never lifts its head. Somewhere a bell tolls.',
    quip: 'Quiet as mice, the lot of you.',
  };
  const told = streamlinedDraft(draft, { narration: 'What do you do?', outcome: 'The action plays out.' });
  assert.equal(told.narration, 'Mist coils over the ford. A wolf stands in the shallows.');
  assert.equal(told.outcome, 'The party slips past unseen.');
  assert.equal('quip' in told, false);
  assert.deepEqual([told.title, told.imagePrompt], ['The Ford', 'a ford'], 'the rest of the draft is as it was');
  const opening = streamlinedDraft({ narration: 'What do you do?' }, { narration: 'What do you do?', outcome: 'The action plays out.' });
  assert.deepEqual(opening, { narration: 'What do you do?' }, 'an opening has no outcome, and an empty narration keeps the fallback');
  assert.equal(streamlinedDraft({ narration: 'A door.', outcome: '  ' }, { narration: 'x', outcome: 'The action plays out.' }).outcome, 'The action plays out.');
});

const ctx = (telling?: 'full' | 'streamlined'): DMContext => ({
  archetype: archetype('chronicler'), adventureTitle: null, party: [], history: [], sceneIndex: 0, sceneCount: 4, recentChat: [], rules: null,
  ...(telling ? { telling } : {}),
});

test('the dungeon master is told to write a streamlined game briefly, last of all, and a full game is told nothing new', () => {
  const brief = dmInstructions(ctx('streamlined'));
  assert.ok(brief.endsWith(STREAMLINED_INSTRUCTIONS), 'it stands over every length given before it');
  assert.match(STREAMLINED_INSTRUCTIONS, /outcome: ONE sentence/);
  assert.match(STREAMLINED_INSTRUCTIONS, /narration: at most TWO short sentences/);
  assert.match(STREAMLINED_INSTRUCTIONS, /quip: "" \(empty\)/);
  assert.match(STREAMLINED_INSTRUCTIONS, /The rules, the dice and the hooks are exactly the same/);
  for (const full of [dmInstructions(ctx()), dmInstructions(ctx('full'))]) {
    assert.equal(full.includes('STREAMLINED'), false);
    assert.equal(full + STREAMLINED_INSTRUCTIONS, brief, 'the rest of the instructions is word for word the same');
  }
});

test('the fake DM tells a streamlined game in one line, with no aside and no detail; a full game is as before', async () => {
  const resolution = { scene: { choices: [{ id: 'a', label: 'Charge straight in', detail: '' }] }, leaders: ['a'], votes: [], abstained: [], tally: { a: 1, b: 0, c: 0 }, rules: null } as unknown as Resolution;
  const opening = await fakeDungeonMaster.openingScene(ctx('streamlined'));
  assert.equal(opening.narration, 'A rune-carved door stands shut before a drowned chapel.');
  assert.equal(opening.quip, undefined);
  assert.deepEqual(opening.choices.map((c) => [c.label, c.detail]), [['Charge straight in', ''], ['Find a quieter way', ''], ['Parley first', '']]);
  const next = await fakeDungeonMaster.nextScene({ ...ctx('streamlined'), sceneIndex: 1 }, resolution);
  assert.deepEqual([next.narration, next.quip, sentencesOf(next.narration).length], ['A goblin market under the bridge lies before you.', undefined, 1]);
  const finale = await fakeDungeonMaster.finale({ ...ctx('streamlined'), sceneIndex: 3 }, resolution);
  assert.deepEqual([sentencesOf(finale.narration).length, finale.quip], [1, undefined]);

  const full = await fakeDungeonMaster.openingScene(ctx());
  assert.match(full.narration, /^An old oak door carved with runes waits, shut\.\n\nBeyond it lies a drowned chapel/);
  assert.match(full.quip!, /^Welcome, travellers/);
  assert.ok(full.choices.every((c) => c.detail.length > 0));
});
