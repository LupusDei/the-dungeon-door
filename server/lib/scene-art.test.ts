import assert from 'node:assert/strict';
import { test } from 'node:test';
import { castBrief, castOf, MOST_PAINTED } from './scene-art.ts';
import type { Game, GamePlayer } from './types.ts';

const seat = (name: string, extra: Record<string, unknown> = {}): GamePlayer => ({
  playerId: `p-${name}`,
  joinedAt: '2026-11-26T00:00:00.000Z',
  character: { id: `c-${name}`, name, race: 'human', characterClass: 'fighter', description: `${name} in a green cloak`, appearance: null, portraitUrl: null, ...extra } as GamePlayer['character'],
});
const six = ['Tiny', 'Rastigar', 'Ilsa', 'Bryn', 'Corin', 'Maud'].map((n) => seat(n));
const table = (players: GamePlayer[], dead: string[] = []): Pick<Game, 'players' | 'party'> => ({
  players,
  party: { version: 1, rng: 1, sheets: Object.fromEntries(players.map((p) => [p.playerId, { dead: dead.includes(p.character.name) }])) } as unknown as Game['party'],
});
const names = (cast: GamePlayer[]) => cast.map((p) => p.character.name);

test('every hero alive is painted, a party of six included; the ones the dungeon master names stand nearest', () => {
  assert.equal(MOST_PAINTED, 6);
  assert.deepEqual(names(castOf(table(six))), ['Tiny', 'Rastigar', 'Ilsa', 'Bryn', 'Corin', 'Maud'], 'nobody named: everyone, as they joined');
  assert.deepEqual(names(castOf(table(six), ['corin', ' Ilsa '])), ['Ilsa', 'Corin', 'Tiny', 'Rastigar', 'Bryn', 'Maud'], 'named ones first, the rest still there');
  assert.deepEqual(names(castOf(table(six), ['Nobody Here'])), names(six), 'a name that is no one changes nothing');
  assert.deepEqual(names(castOf(table(six, ['Bryn', 'Maud']), ['Bryn'])), ['Tiny', 'Rastigar', 'Ilsa', 'Corin'], 'the dead are not painted, named or not');
  assert.deepEqual(names(castOf(table(six, names(six)))), names(six), 'a party that all fell is still painted (the epilogue)');
  assert.deepEqual(names(castOf({ players: six, party: null })), names(six), 'a game from before the rules engine');
});

test('the painter is told to paint all of them, and which portrait is whose', () => {
  const cast = [seat('Tiny', { appearance: 'A huge goliath in a grey three-piece suit' }), seat('Rastigar'), seat('Ilsa', { description: '', appearance: null, race: 'elf', characterClass: 'wizard' })];
  const brief = castBrief(cast, [true, false, true]);
  assert.match(brief, /^All 3 of these heroes are in this picture\. Paint every one of them/);
  assert.match(brief, /none left out, hidden or merged/);
  assert.match(brief, /- Tiny \(reference portrait 1\): A huge goliath in a grey three-piece suit/);
  assert.match(brief, /- Rastigar: Rastigar in a green cloak/, 'no portrait, no number');
  assert.match(brief, /- Ilsa \(reference portrait 2\): a Elf Wizard|- Ilsa \(reference portrait 2\): an? \w+ \w+/, 'numbers count only the portraits attached');
  assert.match(castBrief([cast[0]], [false]), /^One hero is in this picture and must be clearly visible:\n- Tiny: /);
  for (const hero of six) assert.ok(castBrief(six, six.map(() => false)).includes(`- ${hero.character.name}: `));
});
