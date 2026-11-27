import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heroSheet } from '../characters.ts';
import type { Resolution } from '../dm/types.ts';
import type { CharacterSheet } from '../rules/sheet.ts';
import { CHOICE_IDS, type ChoiceId, type GamePlayer, type StoredChoice, type StoredScene, type Vote } from '../types.ts';
import { isPersonalCheck, type CheckRuling } from './actions.ts';
import { type CombatVotes, fightRound, startFight } from './fight.ts';
import { ATTACK_LINE, attackOf, type TurnFacts, turnResult } from './result.ts';
import type { PartyState } from './state.ts';
import { engineStep, storedChoice } from './table.ts';

const fighter = heroSheet({ id: 'f', name: 'Bryn', race: 'human', characterClass: 'fighter' });
/** Bryn talks badly, Mira well and Dax not at all, so who rolled is told by the bonus. */
const bryn: CharacterSheet = { ...fighter, skills: ['athletics'], skillBonuses: { ...fighter.skillBonuses, athletics: 5, persuasion: 1, perception: 0 } };
const mira: CharacterSheet = { ...bryn, name: 'Mira', skills: ['athletics', 'persuasion'], skillBonuses: { ...bryn.skillBonuses, persuasion: 6 } };
const dax: CharacterSheet = { ...bryn, name: 'Dax', skills: [], skillBonuses: { ...bryn.skillBonuses, persuasion: -1 } };

const player = (playerId: string, name: string): GamePlayer => ({
  playerId, joinedAt: '', character: { id: `c-${playerId}`, ownerId: playerId, name, race: 'human', characterClass: 'fighter', gender: '', temperament: '', alignment: '', backstory: '', description: '', appearance: '', portraitUrl: null, createdAt: '', updatedAt: '' },
});
const TABLE = [player('p1', 'Bryn'), player('p2', 'Mira'), player('p3', 'Dax')];
const party = (sheets: Record<string, CharacterSheet> = { p1: bryn, p2: mira, p3: dax }): PartyState => ({ version: 1, rng: 5, sheets });

const TALK = storedChoice({ id: 'a', label: 'Talk them round', detail: '' }, { kind: 'check', ability: 'cha', skill: 'persuasion', dc: 10, mode: 'best' });
const CLIMB = storedChoice({ id: 'b', label: 'Climb the wall', detail: '' }, { kind: 'check', ability: 'str', skill: 'athletics', dc: 12 });
const WAIT = storedChoice({ id: 'c', label: 'Wait for dark', detail: '' }, null);
const CHOICES = [TALK, CLIMB, WAIT];

const LOOK: CheckRuling = { kind: 'check', ability: 'wis', skill: 'perception', tier: 'easy', effect: { category: 'none' } };
const pick = (playerId: string, choiceId: ChoiceId, roll: number, more: Partial<Vote> = {}): Vote => ({ playerId, choiceId, roll, ...more });
const writes = (playerId: string, text: string, roll: number, ruling: CheckRuling = LOOK): Vote => ({ playerId, choiceId: 'a', roll, freeform: { text, ruling } });

const sceneOf = (votes: Vote[], choices: StoredChoice[] = CHOICES): StoredScene =>
  ({ index: 3, title: '', narration: '', imagePrompt: '', imageUrl: null, voices: {}, choices, isFinale: false, votes, outcome: null, chosenChoiceId: null, createdAt: '' });

/** The resolution as lib/game.ts makes it: a written check is not a pick; the leaders are the most-picked. */
function resolutionOf(scene: StoredScene): Resolution {
  const picks = scene.votes.filter((v) => !isPersonalCheck(v));
  const tally = { a: 0, b: 0, c: 0 };
  for (const v of picks) tally[v.choiceId]++;
  const top = Math.max(tally.a, tally.b, tally.c);
  return {
    scene: {} as Resolution['scene'], tally, abstained: [], rules: null, leaders: CHOICE_IDS.filter((id) => tally[id] === top && top > 0),
    votes: picks.map((v) => ({ playerId: v.playerId, characterName: v.playerId, choiceId: v.choiceId, choiceLabel: '', roll: v.roll })),
  };
}

/** A turn played through the engine's own step, as lib/game.ts plays it. */
function played(votes: Vote[], sheets?: Record<string, CharacterSheet>, players: GamePlayer[] = TABLE) {
  const scene = sceneOf(votes);
  const step = engineStep({ party: party(sheets), combat: null, dungeon: null }, scene, resolutionOf(scene), players);
  assert.ok(step.result, 'the engine step carries the result');
  return { step, result: step.result, hero: (id: string) => step.result!.heroes.find((h) => h.playerId === id)! };
}

test('the choice the party went with: its label and rules text, who picked it, the tally, and whether its roll passed', () => {
  const { step, result, hero } = played([pick('p1', 'a', 17), pick('p2', 'a', 3), pick('p3', 'c', 9)]);
  assert.deepEqual([result.sceneIndex, result.combat], [3, false]);
  assert.deepEqual(result.choice, {
    id: 'a', label: 'Talk them round', rules: 'Persuasion check, DC 10, one hero with help', backers: ['p1', 'p2'],
    tally: { a: 2, b: 0, c: 1 }, tie: null, success: false,
  });
  assert.deepEqual(result.heroes.map((h) => [h.playerId, h.name, h.did, h.choiceId, h.label]), [
    ['p1', 'Bryn', 'choice', 'a', 'Talk them round'], ['p2', 'Mira', 'choice', 'a', 'Talk them round'], ['p3', 'Dax', 'choice', 'c', 'Wait for dark'],
  ], 'everyone at the table, in joining order');
  assert.deepEqual(hero('p2').rolls, [{
    for: 'choice', name: 'Persuasion', natural: 3, dice: [3], mode: 'normal', bonus: 6, total: 9, against: { kind: 'dc', value: 10 },
    success: false, fresh: false, helpers: [], detail: null,
  }], 'of the two who picked it the better talker rolled, with her own d20');
  assert.deepEqual([hero('p1').rolls, hero('p3').rolls], [[], []]);
  assert.deepEqual(hero('p2').lines, ['Mira: Persuasion 3 + 6 = 9 vs DC 10, failure']);
  assert.deepEqual(result.notes, [], 'the dice line is under its hero; the XP lines are not notes');
  assert.ok(step.state.party.results!.some((l) => l.startsWith('+')), 'though the scene has XP lines');
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result, 'it is stored as JSON and comes back the same');
});

test('a tie: the choice whose backer threw the highest d20 wins, and the result names that d20', () => {
  const { result, hero } = played([pick('p1', 'a', 17), pick('p2', 'c', 4)]);
  assert.deepEqual([result.choice!.id, result.choice!.tally, result.choice!.tie], ['a', { a: 1, b: 0, c: 1 }, { between: ['a', 'c'], playerId: 'p1', roll: 17 }]);
  assert.deepEqual([result.choice!.backers, hero('p1').rolls.map((r) => [r.natural, r.fresh])], [['p1'], [[17, false]]], 'Bryn picked it and rolls it: Mira, the better talker, picked the other');
  const lost = played([pick('p1', 'a', 2), pick('p2', 'c', 4), pick('p3', 'c', 1)]);
  assert.equal(lost.result.choice!.tie, null, 'no tie when one choice has more picks');
  const story = played([pick('p1', 'a', 2), pick('p2', 'c', 19)]);
  assert.deepEqual([story.result.choice!.id, story.result.choice!.rules, story.result.choice!.success, story.result.choice!.tie!.roll], ['c', null, null, 19], 'a choice with no roll neither passes nor fails');
});

test('a written action beside a pick: it is its hero\'s own, not a pick; the one who picked the choice rolls its check', () => {
  const { result, hero } = played([pick('p1', 'a', 17), writes('p2', 'I watch the door', 6)]);
  assert.deepEqual([result.choice!.backers, result.choice!.tally], [['p1'], { a: 1, b: 0, c: 0 }], 'a written action is not a pick');
  assert.deepEqual([hero('p2').did, hero('p2').choiceId, hero('p2').label, hero('p2').text], ['own', undefined, 'Perception', 'I watch the door']);
  assert.deepEqual(hero('p2').rolls.map((r) => [r.for, r.name, r.natural, r.against, r.fresh]), [['own', 'Perception', 6, { kind: 'dc', value: 10 }, false]], 'her d20 went to her own action and nowhere else');
  assert.deepEqual(hero('p1').rolls.map((r) => [r.for, r.name, r.natural, r.fresh, r.success]), [['choice', 'Persuasion', 17, false, true]], 'Bryn picked the talk and showed a 17: that is the die that decided it');
  assert.equal(result.choice!.success, true);
  assert.deepEqual(hero('p2').lines, ['Mira ("I watch the door"): Perception 6 + 0 = 6 vs DC 10, failure.']);
  assert.deepEqual(result.notes, []);
  const skill = played([pick('p1', 'c', 9), { playerId: 'p2', choiceId: 'c', roll: 12, actionId: 'skill:athletics', freeform: { text: 'Athletics', ruling: { ...LOOK, ability: 'str', skill: 'athletics', tier: 'medium' } } }]);
  assert.deepEqual([skill.hero('p2').did, skill.hero('p2').label, skill.hero('p2').text, skill.result.choice!.tally], ['own', 'Athletics', undefined, { a: 0, b: 0, c: 1 }], 'a skill from the sheet is the hero\'s own too; with no words written there is no text');
  const words = played([pick('p1', 'c', 9, { freeform: { text: 'We go quietly' } })]);
  assert.deepEqual([words.hero('p1').did, words.hero('p1').text], ['choice', 'We go quietly'], 'words beside a pick stay with the pick');
});

test('a group check: everyone rolls; a hero who wrote their own action, or did nothing, gets a die of the table\'s', () => {
  const { result, hero } = played([pick('p1', 'b', 15), writes('p2', 'I watch the door', 18)]);
  assert.deepEqual([result.choice!.id, result.choice!.backers, result.choice!.rules], ['b', ['p1'], 'Athletics check, DC 12']);
  assert.deepEqual(hero('p1').rolls.map((r) => [r.for, r.name, r.natural, r.fresh]), [['choice', 'Athletics', 15, false]]);
  const [own, shared] = hero('p2').rolls;
  assert.deepEqual([own.for, own.name, own.natural, own.fresh], ['own', 'Perception', 18, false], 'her own action first, with her d20');
  assert.deepEqual([shared.for, shared.name, shared.fresh, shared.dice.length], ['choice', 'Athletics', true, 1], 'then the party\'s check, with a fresh die');
  assert.deepEqual([hero('p3').did, hero('p3').choiceId, hero('p3').label, hero('p3').text, hero('p3').byClock], ['nothing', undefined, undefined, undefined, false]);
  assert.deepEqual(hero('p3').rolls.map((r) => [r.for, r.fresh]), [['choice', true]], 'a hero who did not act is still in the check');
  assert.equal(hero('p3').lines.length, 1);
  assert.deepEqual(result.notes, [], 'every line was a hero\'s dice');
  const quiet = played([pick('p1', 'c', 15)]);
  assert.deepEqual(quiet.result.heroes.map((h) => [h.did, h.rolls, h.lines]), [['choice', [], []], ['nothing', [], []], ['nothing', [], []]], 'a hero who did not act is in the result all the same');
});

test('a hero who was down is listed as down; a die left to the clock is marked', () => {
  const sheets = { p1: bryn, p2: { ...mira, hp: 0 }, p3: { ...dax, hp: 0, dead: true } };
  const { result, hero } = played([pick('p1', 'b', 15, { autoRolled: true }), pick('p3', 'b', 8)], sheets);
  assert.deepEqual(result.heroes.map((h) => [h.name, h.did, h.byClock]), [['Bryn', 'choice', true], ['Mira', 'down', false], ['Dax', 'down', false]]);
  assert.deepEqual([hero('p2').rolls, hero('p2').lines[0]], [[], 'Mira is down and fails']);
  assert.ok(hero('p2').lines.every((l) => l.startsWith('Mira ')), 'what became of her after is her line too');
  assert.deepEqual([hero('p3').choiceId, hero('p3').label, hero('p3').rolls], ['b', 'Climb the wall', []], 'outside a fight a fallen hero\'s player still has a say: the pick is kept');
  assert.deepEqual(result.choice!.backers, ['p1', 'p3']);
  assert.ok(result.notes.includes('Mira is down and fails'), 'no d20 was rolled for her: the line stays a note');
  const written = played([pick('p1', 'c', 15), writes('p2', 'I crawl to the door', 11)], sheets);
  assert.deepEqual([written.hero('p2').did, written.hero('p2').text, written.hero('p2').rolls, written.hero('p2').lines], ['down', 'I crawl to the door', [], ['Mira is down and does not act.']]);
});

test('everyone at the table is in the result, in joining order; with no table given, the heroes the engine holds', () => {
  const votes = [pick('p3', 'c', 9), pick('p1', 'c', 4)];
  assert.deepEqual(played(votes, undefined, [TABLE[2], TABLE[0], TABLE[1]]).result.heroes.map((h) => h.name), ['Dax', 'Bryn', 'Mira']);
  const scene = sceneOf(votes);
  const bare = engineStep({ party: party(), combat: null, dungeon: null }, scene, resolutionOf(scene));
  assert.deepEqual(bare.result!.heroes.map((h) => h.playerId), ['p1', 'p2', 'p3']);
  const gone = played([pick('p1', 'b', 15)], undefined, [TABLE[0]]);
  assert.deepEqual(gone.result.heroes.map((h) => h.name), ['Bryn']);
  assert.equal(gone.result.notes.filter((l) => /^(Mira|Dax): Athletics /.test(l)).length, 2, 'the dice of a hero whose player has left stay in the notes');
});

test('resolving the same scene twice gives the same result', () => {
  const votes = [pick('p1', 'b', 15), writes('p2', 'I watch the door', 18)];
  assert.deepEqual(played(votes).result, played(votes).result);
});

// ---- a combat round ----

const FACTS: Omit<TurnFacts, 'turn' | 'scene' | 'before'> = { players: [{ playerId: 'p1', name: 'Bryn' }, { playerId: 'p2', name: 'Mira' }, { playerId: 'p3', name: 'Dax' }], picks: [], tally: { a: 0, b: 0, c: 0 }, leaders: [], chosen: null, rules: null };

test('the attack line: one pattern reads back what play/fight.ts writes, hit, miss and critical', () => {
  assert.deepEqual(attackOf('Bryn attacks Goblin Warrior 2 with Light Crossbow: 14 (total 19) vs AC 15, hit.'), {
    attacker: 'Bryn', reaction: false,
    roll: { for: 'attack', name: 'Light Crossbow', natural: 14, dice: [14], mode: 'normal', bonus: 5, total: 19, against: { kind: 'ac', value: 15 }, success: true, fresh: false, helpers: [], detail: null },
  });
  const miss = attackOf('Bryn attacks Goblin Warrior with Longsword: 3 (total 8) vs AC 15, miss.')!;
  assert.deepEqual([miss.roll.success, miss.roll.natural, miss.roll.bonus, miss.roll.detail], [false, 3, 5, null]);
  const critical = attackOf('Bryn attacks Goblin Warrior with Longsword: 20 (total 25) vs AC 15, critical hit.')!;
  assert.deepEqual([critical.roll.success, critical.roll.detail], [true, 'critical hit']);
  const onHero = attackOf('Goblin Warrior attacks Bryn with Scimitar: 20 (total 24) vs AC 16, critical hit for 19.')!;
  assert.deepEqual([onHero.attacker, onHero.roll.name, onHero.roll.detail], ['Goblin Warrior', 'Scimitar', 'critical hit for 19']);
  const rider = attackOf('Ghoul attacks Bryn with Claw: 12 (total 16) vs AC 16, hit for 5. Bryn fails the DC 10 CON save: Paralyzed.')!;
  assert.equal(rider.roll.detail, 'hit for 5. Bryn fails the DC 10 CON save: Paralyzed');
  const reaction = attackOf('Opportunity Attack: Mira attacks Goblin Warrior with Dagger: 1 (total -1) vs AC 15, miss.')!;
  assert.deepEqual([reaction.attacker, reaction.reaction, reaction.roll.total, reaction.roll.bonus], ['Mira', true, -1, -2]);
  for (const other of ['Bryn dodges.', 'Bryn casts Fire Bolt: Goblin Warrior is hit.', 'Bryn: Athletics 14 + 5 = 19 vs DC 12, success', 'A fight begins: Goblin Warrior. Initiative: Bryn 12.']) {
    assert.equal(attackOf(other), null, other);
  }
});

test('the attack line holds against the rounds the engine really writes', () => {
  const seen = new Set<string>();
  for (let rng = 1; rng <= 12; rng++) {
    let { party: p, combat } = startFight({ ...party({ p1: bryn, p2: mira }), rng }, ['goblin-warrior', 'goblin-warrior']);
    for (let round = 0; round < 4 && combat.outcome === 'ongoing'; round++) {
      const votes: CombatVotes = { p1: { choiceId: 'a', roll: [20, 1, 12][(rng + round) % 3] }, p2: { choiceId: 'a', roll: 10 + round } };
      const next = fightRound(p, combat, votes);
      for (const line of next.lines.filter((l) => l.includes(' attacks '))) {
        const attack = attackOf(line);
        assert.ok(attack, `not read back: ${line}`);
        assert.equal(line.replace(/^Opportunity Attack: /, '').startsWith(`${attack.attacker} attacks `), true);
        seen.add(ATTACK_LINE.exec(line)![7]);
      }
      if (next.ended) break;
      [p, combat] = [next.party, next.combat];
    }
  }
  assert.deepEqual([...seen].sort(), ['critical hit', 'hit', 'miss'], 'the rounds played showed all three');
});

test('a combat round: no choice; each hero\'s action, their attacks read back from the lines, the rest in notes', () => {
  const lines = [
    'Bryn attacks Goblin Warrior with Longsword: 20 (total 25) vs AC 15, critical hit.',
    'Bryn attacks Goblin Warrior with Longsword: 3 (total 8) vs AC 15, miss.',
    'Goblin Warrior attacks Bryn with Scimitar: 15 (total 19) vs AC 16, hit for 6.',
    'Opportunity Attack: Bryn attacks Goblin Warrior with Longsword: 11 (total 16) vs AC 15, hit.',
    'Mira casts Fire Bolt: Goblin Warrior is missed.',
    'Goblin Warrior is bloodied.',
  ];
  const fight = startFight(party(), ['goblin-warrior']);
  const down = { ...fight.combat, combatants: { ...fight.combat.combatants, p3: { ...fight.combat.combatants.p3, hp: 0, status: 'dying' as const } } };
  const votes = [pick('p1', 'a', 20, { actionId: 'attack:longsword' }), pick('p2', 'b', 7, { autoRolled: true, freeform: { text: 'Burn it' } })];
  const result = turnResult({
    ...FACTS, scene: sceneOf(votes, []), before: { party: fight.party, combat: down }, picks: votes, tally: { a: 1, b: 1, c: 0 }, leaders: ['a', 'b'], chosen: 'a',
    turn: { lines, success: null, checks: [] }, actions: { p1: 'Attack with Longsword', p2: 'Cast Fire Bolt' },
  });
  assert.deepEqual([result.combat, result.choice], [true, null], 'in a round each hero takes their own action');
  const [b, m, d] = result.heroes;
  assert.deepEqual([b.did, b.label, b.choiceId, b.byClock], ['action', 'Attack with Longsword', undefined, false]);
  assert.deepEqual(b.rolls.map((r) => [r.for, r.name, r.natural, r.total, r.against, r.success, r.fresh, r.detail]), [
    ['attack', 'Longsword', 20, 25, { kind: 'ac', value: 15 }, true, false, 'critical hit'],
    ['attack', 'Longsword', 3, 8, { kind: 'ac', value: 15 }, false, true, null],
    ['attack', 'Longsword', 11, 16, { kind: 'ac', value: 15 }, true, true, null],
  ], 'the first attack is thrown with the hero\'s own d20; an extra attack and a reaction are the table\'s');
  assert.deepEqual(b.lines, [lines[0], lines[1], lines[3]], 'a foe\'s attack on Bryn is not Bryn\'s line');
  assert.deepEqual([m.did, m.label, m.text, m.byClock, m.rolls, m.lines], ['action', 'Cast Fire Bolt', 'Burn it', true, [], [lines[4]]], 'a spell is told by its line, not as a roll');
  assert.deepEqual([d.did, d.label, d.rolls, d.lines], ['down', undefined, [], []]);
  assert.deepEqual(result.notes, [lines[2], lines[4], lines[5]], 'the foe\'s attack, the spell and the wounds; the heroes\' attack lines are theirs');
});

test('a combat round through the engine: the action is named as the hero\'s own list names it; a hero with no vote did nothing', () => {
  const fight = startFight(party({ p1: bryn, p2: mira }), ['goblin-warrior']);
  const scene = sceneOf([pick('p1', 'a', 12)], []);
  const step = engineStep({ party: fight.party, combat: fight.combat, dungeon: null }, scene, resolutionOf(scene), [TABLE[0], TABLE[1]]);
  const [b, m] = step.result!.heroes;
  assert.deepEqual([step.result!.combat, step.result!.choice], [true, null]);
  assert.equal(b.did, 'action');
  assert.match(b.label!, /^(Attack with |Move closer)/);
  assert.deepEqual([m.did, m.label, m.rolls], ['nothing', undefined, []], 'she dodges, by the engine\'s rule, and that is her line');
  assert.ok(m.lines.includes('Mira dodges.'), step.result!.notes.join(' | '));
  for (const roll of b.rolls) assert.deepEqual([roll.for, roll.against.kind], ['attack', 'ac']);
  assert.equal(step.result!.notes.some((l) => /^Bryn attacks /.test(l)), false);
});

test('lines go to the hero they begin with: the longest name that fits, not a name that is only its start', () => {
  const sheets = { p1: bryn, p2: { ...mira, name: 'Brynhild' }, p3: { ...dax, name: 'Bryn the Bold' } };
  const lines = ['Bryn: Athletics 14 + 5 = 19 vs DC 12, success', 'Brynhild: Athletics 2 + 5 = 7 vs DC 12, failure', 'Bryn the Bold is down and fails', 'Bryn\'s death save: 12 (success).', 'The party enters the Vault.'];
  const result = turnResult({ ...FACTS, scene: sceneOf([], CHOICES), before: { party: party(sheets), combat: null }, turn: { lines, success: null, checks: [] } });
  assert.deepEqual(result.heroes.map((h) => [h.name, h.lines]), [['Bryn', [lines[0], lines[3]]], ['Brynhild', [lines[1]]], ['Bryn the Bold', [lines[2]]]]);
  assert.deepEqual(result.notes, lines, 'with no d20 recorded, every line is a note too');
  assert.equal(result.choice, null, 'nobody picked: there is no choice');
});

test('a helped roll: the Help line is a dice line, lifted out of the notes with the roll it helped', () => {
  const helper = { ...dax, skills: ['persuasion'] };
  const { result, hero } = played([pick('p1', 'a', 4), pick('p3', 'a', 9), pick('p2', 'c', 2)], { p1: bryn, p2: mira, p3: helper });
  const [roll] = hero('p1').rolls;
  assert.deepEqual([roll.helpers, roll.mode, roll.dice.length, roll.dice[0]], [['Dax'], 'advantage', 2, 4], 'Dax picked it too and knows how to talk: he helps, and Mira, who picked another, does not');
  assert.deepEqual([hero('p3').rolls, hero('p3').lines], [[], ['Dax helps: Advantage']]);
  assert.deepEqual(result.notes, []);
});
