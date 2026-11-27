import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heroSheet } from '../characters.ts';
import { levelForXp } from '../rules/leveling.ts';
import type { PartyState } from './state.ts';
import { CHAPTER_EVERY, type Deeds, questXp, sceneXp, xpFor, xpTag, xpUnit } from './xp.ts';

const hero = (name: string, level = 1) => ({ ...heroSheet({ id: name, name, race: 'human', characterClass: 'fighter' }), level });
const party = (sheets: PartyState['sheets'] = { p1: hero('Bryn'), p2: hero('Cleo') }): PartyState => ({ version: 1, rng: 1, sheets });
const deeds = (over: Partial<Deeds> = {}): Deeds => ({
  sceneIndex: 2, actors: [{ playerId: 'p1', idle: false }, { playerId: 'p2', idle: false }], rolls: [], events: [], tag: null, ...over,
});

test('the unit is the SRD 5.2 Low encounter budget for the hero’s level; each reason is a share of it', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 20].map(xpUnit), [50, 100, 150, 250, 500, 6400]);
  const at = (level: number) => (['took-part', 'success', 'brave-failure', 'trap', 'social', 'discovery', 'new-ground', 'chapter', 'quest'] as const).map((r) => xpFor(r, level));
  assert.deepEqual(at(1), [5, 10, 5, 25, 25, 10, 5, 25, 50]);
  assert.deepEqual(at(3), [15, 30, 15, 75, 75, 30, 15, 75, 150]);
});

test('a hero who declared earns for taking part; one who did not earns nothing; the lines say who and why', () => {
  const got = sceneXp(party(), deeds({ actors: [{ playerId: 'p1', idle: false }] }));
  assert.deepEqual([got.party.sheets.p1.xp, got.party.sheets.p2.xp], [5, 0]);
  assert.deepEqual(got.lines, ['+5 XP: taking part (Bryn).']);
  assert.deepEqual(got.party.xpAwards, [{ playerId: 'p1', xp: 5, idle: false, reasons: [{ reason: 'took-part', xp: 5 }] }]);
  assert.deepEqual(got.party.earned, { p1: 5 });
});

test('a d20 that came good pays more than a brave failure; a hero gets one or the other a scene', () => {
  const got = sceneXp(party(), deeds({ rolls: [{ playerId: 'p1', success: true }, { playerId: 'p1', success: false }, { playerId: 'p2', success: false }] }));
  assert.deepEqual(got.lines, ['+5 XP: taking part (Bryn, Cleo).', '+10 XP: a success (Bryn).', '+5 XP: a brave failure (Cleo).']);
  assert.deepEqual([got.party.sheets.p1.xp, got.party.sheets.p2.xp], [15, 10]);
});

test('a die left to the clock halves everything that hero earns that scene', () => {
  const got = sceneXp(party(), deeds({ actors: [{ playerId: 'p1', idle: false }, { playerId: 'p2', idle: true }], rolls: [{ playerId: 'p2', success: true }], events: ['social'] }));
  assert.deepEqual(got.party.sheets.p2.xp, 2 + 5 + 12);
  assert.ok(got.lines.includes('+12 XP: a clever parley, halved: their die was left to the clock (Cleo).'), got.lines.join(' | '));
  assert.ok(got.lines.includes('+25 XP: a clever parley (Bryn).'));
});

test('events and the DM’s tag are shared by everyone who acted; the same reason twice pays once', () => {
  const got = sceneXp(party(), deeds({ events: ['social', 'new-ground'], tag: 'social' }));
  assert.deepEqual(got.lines, ['+5 XP: taking part (Bryn, Cleo).', '+25 XP: a clever parley (Bryn, Cleo).', '+5 XP: new ground (Bryn, Cleo).']);
});

test('everything but a milestone is capped at one unit a hero a scene', () => {
  const got = sceneXp(party({ p1: hero('Bryn') }), deeds({ actors: [{ playerId: 'p1', idle: false }], rolls: [{ playerId: 'p1', success: true }], events: ['trap', 'social', 'new-ground'], tag: 'puzzle' }));
  assert.equal(got.party.sheets.p1.xp, xpUnit(1));
  assert.deepEqual(got.party.xpAwards![0].reasons.map((r) => [r.reason, r.xp]), [['took-part', 5], ['success', 10], ['trap', 25], ['puzzle', 10]]);
});

test('a chapter milestone is paid on top of the cap, at most once every three scenes', () => {
  const first = sceneXp(party(), deeds({ sceneIndex: 3, tag: 'milestone' }));
  assert.ok(first.lines.includes('+25 XP: a chapter closed (Bryn, Cleo).'));
  assert.equal(first.party.chapterAt, 3);
  const soon = sceneXp(first.party, deeds({ sceneIndex: 3 + CHAPTER_EVERY - 1, events: ['deeper'] }));
  assert.ok(!soon.lines.some((l) => /chapter|deeper/.test(l)), soon.lines.join(' | '));
  assert.equal(soon.party.chapterAt, 3);
  const later = sceneXp(soon.party, deeds({ sceneIndex: 3 + CHAPTER_EVERY, events: ['deeper'], tag: 'milestone' }));
  assert.deepEqual(later.lines.filter((l) => /chapter|deeper/.test(l)), ['+25 XP: deeper into the dungeon (Bryn, Cleo).'], 'one milestone a scene');
});

test('the dead earn nothing; a round of a fight earns nothing but counts as having taken part', () => {
  const dead = sceneXp(party({ p1: hero('Bryn'), p2: { ...hero('Cleo'), dead: true } }), deeds());
  assert.deepEqual(dead.lines, ['+5 XP: taking part (Bryn).']);
  const round = sceneXp(party(), deeds({ round: true, events: ['social'] }));
  assert.deepEqual([round.lines, round.party.xpAwards, round.party.earned, round.party.sheets.p1.xp], [[], [], { p1: 0, p2: 0 }, 0]);
});

test('the adventure’s end: every living hero who took part gets the major milestone, by its own level', () => {
  const sheets = { p1: hero('Bryn'), p2: hero('Cleo', 3), p3: hero('Dag'), p4: { ...hero('Eda'), dead: true } };
  const ended = questXp({ ...party(sheets), earned: { p1: 20, p2: 0, p4: 10 }, xpAwards: [{ playerId: 'p1', xp: 5, idle: false, reasons: [{ reason: 'took-part', xp: 5 }] }] });
  assert.deepEqual(ended.lines, ['+50 XP: the adventure’s end (Bryn).', '+150 XP: the adventure’s end (Cleo).']);
  assert.deepEqual([ended.party.sheets.p1.xp, ended.party.sheets.p2.xp, ended.party.sheets.p3.xp, ended.party.sheets.p4.xp], [50, 150, 0, 0]);
  assert.deepEqual(ended.party.xpAwards![0], { playerId: 'p1', xp: 55, idle: false, reasons: [{ reason: 'took-part', xp: 5 }, { reason: 'quest', xp: 50 }] }, 'joined with the last scene’s');
  assert.deepEqual(ended.party.earned, { p1: 70, p2: 150, p4: 10 });
});

test('only the four tags are tags', () => {
  assert.deepEqual(['discovery', 'social', 'puzzle', 'milestone', 'none', 'loot', null, 3].map(xpTag), ['discovery', 'social', 'puzzle', 'milestone', null, null, null, null]);
});

test('the pace: a no-fight quest of the default length takes a level-1 hero to level 2 in two or three quests', () => {
  // A default game: two scenes of road and four of the tale, five of them played before the epilogue. Each scene the
  // hero acts and rolls (two of three come good); one scene in two holds a discovery, a parley won or new ground.
  const scene = (i: number): Partial<Deeds> => ({
    sceneIndex: i, actors: [{ playerId: 'p1', idle: false }],
    rolls: [{ playerId: 'p1', success: i % 3 !== 2 }], tag: i % 2 === 0 ? 'discovery' : null,
  });
  let p = party({ p1: hero('Bryn') });
  let quests = 0;
  while (levelForXp(p.sheets.p1.xp) < 2) {
    quests += 1;
    for (let i = 0; i < 5; i++) p = sceneXp(p, deeds(scene(i))).party;
    p = { ...questXp(p).party, chapterAt: undefined };
  }
  assert.ok(quests >= 2 && quests <= 3, `${quests} quests`);
});
