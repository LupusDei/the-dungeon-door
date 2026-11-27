import assert from 'node:assert/strict';
import { test } from 'node:test';
import { archetype } from '../catalog.ts';
import { dmInstructions, storyPrompt } from './llm.ts';
import { hasStolenHeroSpeech, keptWords, PLAYER_VOICE, roleplayBlock, stripHeroSpeech, type HeroLine } from './playerVoice.ts';
import type { DMContext, Resolution } from './types.ts';

const heroes = ['Bryn', 'Cleo'];
const peace: HeroLine[] = [{ name: 'Bryn', text: 'We come in peace.' }];

test('the narrator is told the heroes belong to the players', () => {
  const ctx: DMContext = {
    archetype: archetype('chronicler'), adventureTitle: null, party: [], history: [], sceneIndex: 0, sceneCount: 4, recentChat: [], rules: null,
  };
  const text = dmInstructions(ctx);
  assert.ok(text.includes(PLAYER_VOICE.trim()));
  assert.match(text, /Never put words in a hero's mouth/);
  assert.match(text, /feelings, attitudes, or choices/);
  assert.match(text, /The innkeeper eyes you warily\. What do you say\?/);
  assert.match(text, /a staff that hiccups/);
  assert.doesNotMatch(text, /dissenters still act/);
  assert.doesNotMatch(text, /lagging behind/);
  assert.doesNotMatch(text, /one hesitates/);
});

test('in-character lines are handed to the narrator to answer', () => {
  const ctx: DMContext = {
    archetype: archetype('chronicler'), adventureTitle: 'The Hiccuping Staff',
    party: [{ playerId: 'p', name: 'Bryn', race: 'Dwarf', characterClass: 'Fighter', gender: 'Female', temperament: 'Stoic', alignment: 'Neutral Good', backstory: '', description: '', appearance: 'a dwarf' }],
    history: [], sceneIndex: 1, sceneCount: 4,
    recentChat: [{ characterName: 'Bryn', kind: 'chat', text: 'ooc: I hope there is pie', voice: 'out' }],
    rules: null,
  };
  const resolution: Resolution = {
    scene: {
      index: 0, title: 'The Door', narration: 'An oak door waits.', choices: [], votes: [], outcome: null, chosenChoiceId: null,
      roleplay: [{ playerId: 'p', characterName: 'Bryn', text: 'We come in peace.' }],
    },
    votes: [], tally: { a: 1, b: 0, c: 0 }, leaders: ['a'], abstained: [], rules: null,
  };
  const prompt = storyPrompt(ctx, resolution);
  assert.match(prompt, /IN CHARACTER/);
  assert.match(prompt, /Bryn: We come in peace\./);
  assert.match(prompt, /RECENT TABLE TALK/);
  assert.match(prompt.split('RECENT TABLE TALK')[1] ?? '', /pie/);
  assert.equal(roleplayBlock([]), '');
});

test('in-character chat is player voice: the narrator must keep it, and out-of-character chat is not', () => {
  const ctx: DMContext = {
    archetype: archetype('chronicler'), adventureTitle: null, party: [], history: [], sceneIndex: 0, sceneCount: 4,
    recentChat: [
      { characterName: 'Bryn', kind: 'chat', text: 'We come in peace.', voice: 'in' },
      { characterName: 'Bryn', kind: 'chat', text: 'ooc: I hope there is pie', voice: 'out' },
      { characterName: 'Mara', kind: 'dm', text: 'The door hums.', voice: null },
    ],
    rules: null,
  };
  const prompt = storyPrompt(ctx);
  const [beforeTalk, table] = prompt.split('RECENT TABLE TALK');
  assert.match(beforeTalk, /IN CHARACTER/);
  assert.match(beforeTalk, /Bryn: We come in peace\./);
  assert.doesNotMatch(beforeTalk, /I hope there is pie/);
  assert.match(table, /I hope there is pie/);
  assert.match(table, /The door hums/);
  assert.doesNotMatch(table, /We come in peace/);
  assert.deepEqual(keptWords([], ctx.recentChat), [{ characterName: 'Bryn', text: 'We come in peace.' }]);
});

test('a whisper is never player voice, and an in-character emote is a deed', () => {
  const chat = [
    { characterName: 'Bryn', kind: 'chat', text: 'The door is trapped', voice: 'in' as const, whisperTo: [{ playerId: 'i' }] },
    { characterName: 'Bryn', kind: 'chat', text: 'draws her sword', voice: 'in' as const, emote: true },
    { characterName: 'Bryn', kind: 'chat', text: 'checks the time', voice: 'out' as const, emote: true },
  ];
  assert.deepEqual(keptWords([], chat), [{ characterName: 'Bryn', text: '*draws her sword*' }]);
});

test('quoted speech a hero did not write is dropped, and the world stays', () => {
  const stolen = 'Bryn says, "Draw your swords." The innkeeper eyes you warily. What do you say?';
  assert.equal(hasStolenHeroSpeech(stolen, heroes, []), true);
  assert.equal(stripHeroSpeech(stolen, heroes, []), 'The innkeeper eyes you warily. What do you say?');

  const tag = 'The door hums. "We should run," Bryn whispers. The torch gutters.';
  assert.equal(stripHeroSpeech(tag, heroes, []), 'The door hums. The torch gutters.');

  const colon = 'Cleo: "I feel brave." The staff hiccups.';
  assert.equal(stripHeroSpeech(colon, heroes, peace), 'The staff hiccups.');

  const single = "Bryn says, 'Let us burn it.' The coin lands on its edge.";
  assert.equal(stripHeroSpeech(single, heroes, []), 'The coin lands on its edge.');

  const you = 'You shout, "Charge!" The gate holds.';
  assert.equal(stripHeroSpeech(you, heroes, []), 'The gate holds.');
});

test('a line the player wrote may be repeated, and NPC speech is not theirs', () => {
  const repeated = 'Bryn says, "We come in peace." The innkeeper lowers the axe.';
  assert.equal(hasStolenHeroSpeech(repeated, heroes, peace), false);
  assert.equal(stripHeroSpeech(repeated, heroes, peace), repeated);

  const part = 'Bryn whispers, "come in peace" and the room goes quiet.';
  assert.equal(hasStolenHeroSpeech(part, heroes, peace), false);

  const npc = 'The staff hiccups. The innkeeper says, "Mind the door." What do you say?';
  assert.equal(stripHeroSpeech(npc, heroes, []), npc);

  const sign = 'The sign reads, "No heroes, no refunds." Bryn\'s torch gutters.';
  assert.equal(stripHeroSpeech(sign, heroes, []), sign);

  const longer = 'Bryn says, "We come in peace. Draw your swords."';
  assert.equal(hasStolenHeroSpeech(longer, heroes, peace), true);
  assert.equal(stripHeroSpeech(longer, ['Bryn Ashgrove', 'Bryn'], [{ name: 'Bryn Ashgrove', text: 'We come in peace.' }]), '');
});
