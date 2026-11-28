import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heroSheet } from '../characters.ts';
import { levelForXp } from '../rules/leveling.ts';
import type { PartyState } from './state.ts';
import { CHAPTER_EVERY, type Deeds, questXp, ROUND_SCALE, roundXpFor, sceneXp, XP_SHARES, xpFor, xpTag, xpUnit, type XpReason } from './xp.ts';

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

test('the dead earn nothing; a round of a fight pays each hero who acted a little, with no line and nothing shared', () => {
  const dead = sceneXp(party({ p1: hero('Bryn'), p2: { ...hero('Cleo'), dead: true } }), deeds());
  assert.deepEqual(dead.lines, ['+5 XP: taking part (Bryn).']);
  const round = sceneXp(party(), deeds({ round: true, events: ['social'], tag: 'puzzle' }));
  const inFight = (playerId: string) => ({ playerId, idle: false, xp: 1, reasons: [{ reason: 'in-fight', xp: 1 }] });
  assert.deepEqual([round.lines, round.party.xpAwards, round.party.earned, round.party.sheets.p1.xp], [[], [inFight('p1'), inFight('p2')], { p1: 1, p2: 1 }, 1]);
});

test('a d20 is paid by the chance its result had: a sure thing little, a surprise more, the rarer the more', () => {
  const one = (success: boolean, chance: number) => sceneXp(party(), deeds({ actors: [{ playerId: 'p1', idle: false }], rolls: [{ playerId: 'p1', success, chance }] }));
  const told = (success: boolean, chance: number) => one(success, chance).lines.slice(1);
  // Succeeding: at 9 in 10 or better, plainly, at 1 in 4 or worse, at 1 in 10 or worse.
  assert.deepEqual(told(true, 1), ['+3 XP: a sure thing (Bryn).']);
  assert.deepEqual(told(true, 0.9), ['+3 XP: a sure thing (Bryn).']);
  assert.deepEqual(told(true, 0.85), ['+10 XP: a success (Bryn).']);
  assert.deepEqual(told(true, 0.3), ['+10 XP: a success (Bryn).']);
  assert.deepEqual(told(true, 0.25), ['+20 XP: against the odds (Bryn).']);
  assert.deepEqual(told(true, 0.15), ['+20 XP: against the odds (Bryn).']);
  assert.deepEqual(told(true, 0.1), ['+40 XP: a long shot that landed (Bryn).']);
  assert.deepEqual(told(true, 0.05), ['+40 XP: a long shot that landed (Bryn).']);
  // Failing: plainly, or when success had 3 chances in 4 or better, 9 in 10 or better. An unlikely failure earns three quarters of the success at the same odds.
  assert.deepEqual(told(false, 0.05), ['+5 XP: a brave failure (Bryn).'], 'a long shot that failed is what was expected');
  assert.deepEqual(told(false, 0.7), ['+5 XP: a brave failure (Bryn).']);
  assert.deepEqual(told(false, 0.75), ['+15 XP: a hard lesson (Bryn).']);
  assert.deepEqual(told(false, 0.85), ['+15 XP: a hard lesson (Bryn).']);
  assert.deepEqual(told(false, 0.9), ['+30 XP: a sure thing that slipped (Bryn).']);
  assert.deepEqual(told(false, 0.95), ['+30 XP: a sure thing that slipped (Bryn).']);
  // Taking part is paid as ever, and the award keeps the chance of what happened.
  const landed = one(true, 0.1);
  assert.deepEqual(landed.awards, [{ playerId: 'p1', idle: false, xp: 45, chance: 0.1, reasons: [{ reason: 'took-part', xp: 5 }, { reason: 'long-shot', xp: 40 }] }]);
  assert.equal(one(false, 0.95).awards[0].chance?.toFixed(2), '0.05', 'the chance of the failure, not of success');
  // A roll with no odds given is paid as it always was.
  const plain = sceneXp(party(), deeds({ rolls: [{ playerId: 'p1', success: true }, { playerId: 'p2', success: false }] }));
  assert.deepEqual(plain.lines.slice(1), ['+10 XP: a success (Bryn).', '+5 XP: a brave failure (Cleo).']);
  assert.equal(plain.awards[0].chance, undefined);
});

test('a hero with several d20s in a turn is paid once, for the most telling of them', () => {
  const rolls = [{ playerId: 'p1', success: true, chance: 0.6 }, { playerId: 'p1', success: false, chance: 0.95 }, { playerId: 'p1', success: true, chance: 0.95 }];
  const scene = sceneXp(party(), deeds({ actors: [{ playerId: 'p1', idle: false }], rolls }));
  assert.deepEqual(scene.lines, ['+5 XP: taking part (Bryn).', '+30 XP: a sure thing that slipped (Bryn).']);
  // A sure thing done beside a brave failure: the failure is the more telling.
  const mixed = sceneXp(party(), deeds({ actors: [{ playerId: 'p1', idle: false }], rolls: [{ playerId: 'p1', success: true, chance: 1 }, { playerId: 'p1', success: false, chance: 0.5 }] }));
  assert.deepEqual(mixed.lines.slice(1), ['+5 XP: a brave failure (Bryn).']);
});

test('the shares: an unlikely failure is three quarters of the success at its odds, and a round pays a quarter of a surprise', () => {
  assert.deepEqual(['sure-thing', 'success', 'against-odds', 'long-shot'].map((r) => XP_SHARES[r as XpReason]), [0.05, 0.2, 0.4, 0.8]);
  assert.deepEqual(['brave-failure', 'hard-lesson', 'sure-slip'].map((r) => XP_SHARES[r as XpReason]), [0.1, 0.3, 0.6]);
  const threeQuarters = (failure: XpReason, success: XpReason) => Math.abs(XP_SHARES[failure] / XP_SHARES[success] - 0.75) < 1e-9;
  assert.ok(threeQuarters('hard-lesson', 'against-odds') && threeQuarters('sure-slip', 'long-shot'));
  assert.equal(ROUND_SCALE, 0.25);
  assert.deepEqual([1, 2, 3, 5].map((level) => ['in-fight', 'against-odds', 'long-shot', 'hard-lesson', 'sure-slip'].map((r) => roundXpFor(r as XpReason, level))), [
    [1, 5, 10, 4, 8], [2, 10, 20, 8, 15], [3, 15, 30, 11, 23], [10, 50, 100, 38, 75],
  ]);
  assert.deepEqual(['success', 'brave-failure', 'sure-thing', 'took-part'].map((r) => roundXpFor(r as XpReason, 1)), [1, 1, 1, 1], 'what is no surprise is "in the fight"');
});

test('a round of a fight: a surprise earns a quarter of what it does outside one and is told; the clock halves it; the down earn nothing', () => {
  const acted = [{ playerId: 'p1', idle: false }, { playerId: 'p2', idle: false }];
  const rolls = [{ playerId: 'p1', success: true, chance: 0.05 }, { playerId: 'p2', success: false, chance: 0.8 }];
  const round = sceneXp(party(), deeds({ round: true, actors: acted, rolls }));
  assert.deepEqual(round.lines, ['+10 XP: a long shot that landed (Bryn).', '+4 XP: a hard lesson (Cleo).']);
  assert.deepEqual(round.awards, [
    { playerId: 'p1', idle: false, xp: 10, chance: 0.05, reasons: [{ reason: 'long-shot', xp: 10 }] },
    { playerId: 'p2', idle: false, xp: 4, chance: 1 - 0.8, reasons: [{ reason: 'hard-lesson', xp: 4 }] },
  ]);
  assert.deepEqual([round.party.sheets.p1.xp, round.party.sheets.p2.xp, round.party.earned], [10, 4, { p1: 10, p2: 4 }]);
  // A hit that was likely, a miss that was likely, a sure thing: all "in the fight", and not told.
  const plain = sceneXp(party(), deeds({ round: true, actors: acted, rolls: [{ playerId: 'p1', success: true, chance: 0.65 }, { playerId: 'p2', success: false, chance: 0.3 }] }));
  assert.deepEqual([plain.lines, plain.awards.map((a) => [a.xp, a.reasons[0].reason, a.chance])], [[], [[1, 'in-fight', undefined], [1, 'in-fight', undefined]]]);
  // A die the clock threw: half, rounded down. At level 1 "in the fight" halves to nothing.
  const idle = sceneXp(party(), deeds({ round: true, actors: [{ playerId: 'p1', idle: true }, { playerId: 'p2', idle: true }], rolls: [{ playerId: 'p1', success: true, chance: 0.05 }] }));
  assert.deepEqual(idle.lines, ['+5 XP: a long shot that landed, halved: their die was left to the clock (Bryn).']);
  assert.deepEqual(idle.awards.map((a) => [a.playerId, a.xp]), [['p1', 5]]);
  assert.deepEqual(idle.party.earned, { p1: 5, p2: 0 }, 'Cleo still counts as having taken part in the quest');
  // A reaction, or a foe's die, is nobody's action here: only the actors are paid.
  const other = sceneXp(party(), deeds({ round: true, actors: [{ playerId: 'p1', idle: false }], rolls: [{ playerId: 'p2', success: true, chance: 0.05 }] }));
  assert.deepEqual(other.awards.map((a) => [a.playerId, a.xp]), [['p1', 1]]);
});

test('a long shot that landed leaves room under the cap for little else; the clock halves an action’s award too', () => {
  const capped = sceneXp(party(), deeds({ actors: [{ playerId: 'p1', idle: false }], rolls: [{ playerId: 'p1', success: true, chance: 0.1 }], events: ['trap'] }));
  assert.deepEqual(capped.lines, ['+5 XP: taking part (Bryn).', '+40 XP: a long shot that landed (Bryn).', '+5 XP: a trap overcome (Bryn).']);
  assert.equal(capped.awards[0].xp, xpUnit(1));
  const idle = sceneXp(party(), deeds({ actors: [{ playerId: 'p1', idle: true }], rolls: [{ playerId: 'p1', success: false, chance: 0.9 }] }));
  assert.deepEqual(idle.lines, ['+2 XP: taking part, halved: their die was left to the clock (Bryn).', '+15 XP: a sure thing that slipped, halved: their die was left to the clock (Bryn).']);
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
