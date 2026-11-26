import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TrekView } from '../play/view.ts';
import type { RulesContext, RulesResults } from './types.ts';
import { openingNote, RULES_INSTRUCTIONS, rulesBlock, resultsBlock } from './rulesPrompt.ts';

const ctx: RulesContext = {
  party: [{ name: 'Bryn', level: 2, hp: 7, maxHp: 20, armorClass: 16, exhaustion: 1, slotsLeft: [0, 0, 0, 0, 0, 0, 0, 0, 0], passivePerception: 13, passiveInsight: 10, gp: 4, items: 'Chain Mail, Potion of Healing ×2', dragging: false, dead: false, sees: 'clear', conditions: '' },
    { name: 'Cleo', level: 2, hp: 0, maxHp: 12, armorClass: 12, exhaustion: 0, slotsLeft: [2, 1, 0, 0, 0, 0, 0, 0, 0], passivePerception: 11, passiveInsight: 12, gp: 0.5, items: '', dragging: true, dead: false, sees: 'clear', conditions: '' }],
  combat: { round: 3, band: 'deadly', combatants: [{ name: 'Bryn', side: 'party', hp: 7, maxHp: 20, status: 'up', toughness: null }, { name: 'Ogre', side: 'foes', hp: 0, maxHp: 68, status: 'dead', toughness: 'deadly' }] },
  trek: null,
  dungeon: { kind: 'Lair', level: 1, area: 'Grand chamber', purpose: 'Throne room', exits: [{ id: 'r2', connection: 'locked-door', leadsTo: 'Vault' }, { id: 'x1', connection: 'open-passage', leadsTo: null }], waiting: null },
  monsters: ['ogre', 'goblin-warrior'],
  time: 'Day 1, 09:10',
  light: "dark; the party's light: Bryn's Torch (40 minutes left)",
};

const heroOnly = (slotsLeft: number[]) => rulesBlock({ ...ctx, party: [{ ...ctx.party[0], slotsLeft }], combat: null, dungeon: null }).split('\n')[1];

test('the rules block tells the DM the party’s numbers, the fight, the area and its exits, and the monsters to use', () => {
  assert.equal(rulesBlock(ctx), [
    'THE RULES ENGINE (SRD 5.2)',
    '- Bryn: level 2, 7/20 HP, AC 16, exhaustion 1, passive Perception 13, passive Insight 10, 4 gp; carries Chain Mail, Potion of Healing ×2',
    '- Cleo: level 2, DOWN (0/12 HP), AC 12, spell slots left 2/1, passive Perception 11, passive Insight 12, 0.5 gp, overloaded (Speed 5 ft); carries nothing',
    "NOW: Day 1, 09:10. Light: dark; the party's light: Bryn's Torch (40 minutes left)",
    'COMBAT, round 3 (deadly): Bryn 7/20 HP; Ogre dead (deadly)',
    'DUNGEON (Lair, level 1): the party is in Grand chamber (Throne room). Exits: r2 locked-door to Vault; x1 open-passage to unexplored',
    'Monsters for fights: ogre, goblin-warrior',
  ].join('\n'));
  assert.equal(rulesBlock({ ...ctx, combat: null, dungeon: { ...ctx.dungeon!, purpose: null, exits: [] } }).split('\n')[4],
    'DUNGEON (Lair, level 1): the party is in Grand chamber. Exits: none');
  assert.equal(rulesBlock({ ...ctx, combat: null, dungeon: { ...ctx.dungeon!, exits: [], waiting: { foes: 'Boar ×3', attitude: 'indifferent', band: 'low', monsters: [{ name: 'Boar', count: 3, toughness: 'weak' }] } } }).split('\n')[4],
    'DUNGEON (Lair, level 1): the party is in Grand chamber (Throne room). Exits: none. Waiting here, not attacking: Boar ×3 (indifferent). Each Boar is weak. The fight is low.');
  assert.equal(heroOnly([3, 0, 0, 0, 0, 0, 0, 0, 0]), '- Bryn: level 2, 7/20 HP, AC 16, exhaustion 1, spell slots left 3, passive Perception 13, passive Insight 10, 4 gp; carries Chain Mail, Potion of Healing ×2');
  assert.equal(rulesBlock(null), '');
});

test('a slain hero is told to the DM as dead', () => {
  const line = rulesBlock({ ...ctx, party: [{ ...ctx.party[1], dead: true }], combat: null, dungeon: null }).split('\n')[1];
  assert.match(line, /^- Cleo: level 2, DEAD \(only Revivify, Raise Dead or the like brings them back\), AC 12/);
});

test('the results block gives the DM the dice to narrate', () => {
  const r: RulesResults = { chosen: 'b', lines: ['Bryn: Athletics 3 + 5 = 8 vs DC 12, failure'], success: false, fight: null };
  assert.equal(resultsBlock(r), 'THE ENGINE’S RESULTS (narrate these; never change them)\nThe party goes with (b). The check or save failed.\nBryn: Athletics 3 + 5 = 8 vs DC 12, failure');
  assert.equal(resultsBlock({ ...r, success: true, lines: [] }).split('\n')[1], 'The party goes with (b). The check or save succeeded.');
  assert.equal(resultsBlock({ ...r, success: null, fight: 'started' }).split('\n')[1], 'The party goes with (b). A fight has begun.');
  assert.equal(resultsBlock({ ...r, success: null, fight: 'victory' }).split('\n')[1], 'The party goes with (b). The party won the fight.');
  assert.equal(resultsBlock({ ...r, success: null, fight: 'defeat' }).split('\n')[1], 'The party goes with (b). Every hero has fallen: the adventure ends here.');
  assert.equal(resultsBlock({ ...r, success: null, fight: 'fled' }).split('\n')[1], 'The party goes with (b). The foes fled.');
  assert.equal(resultsBlock({ ...r, chosen: null, success: null }).split('\n')[1], 'A combat round.');
  assert.equal(resultsBlock(null), '');
});

test('the instructions explain hooks, 5.2 DCs and combat rounds', () => {
  for (const words of ['"check"', '"save"', '"fight"', '"rest"', '"move"', '5 very easy', 'Attack, Cast and Dodge', 'no numbers']) {
    assert.ok(RULES_INSTRUCTIONS.includes(words), words);
  }
});

test('a hero who sees dimly or not at all is marked, so the story shows only what they see', () => {
  const sees = (x: 'dim' | 'none') => rulesBlock({ ...ctx, party: [{ ...ctx.party[0], sees: x }], combat: null, dungeon: null }).split('\n')[1];
  assert.match(sees('dim'), /; sees only dimly$/);
  assert.match(sees('none'), /; CANNOT SEE \(darkness\)$/);
  assert.match(RULES_INSTRUCTIONS, /Describe\s+only what the heroes can see/);
  assert.match(RULES_INSTRUCTIONS, /wandering monsters every half\s+hour/);
  assert.match(RULES_INSTRUCTIONS, /do not attack at once/);
  assert.match(RULES_INSTRUCTIONS, /Never invent or change a rating/);
  assert.match(RULES_INSTRUCTIONS, /"condition":"poisoned"/);
  assert.match(RULES_INSTRUCTIONS, /easy 10, medium 15, hard 20/);
});

test('conditions a hero carries are told with how they end', () => {
  const line = rulesBlock({ ...ctx, party: [{ ...ctx.party[0], conditions: 'poisoned (40 minutes)' }], combat: null, dungeon: null }).split('\n')[1];
  assert.match(line, /; poisoned \(40 minutes\)$/);
});

test('on the road the DM is told the stretch, its terrain, what is on it, and what comes after it; the instructions say how the road is told', () => {
  const road = (stretch: number, event: TrekView['event'], over: Partial<TrekView> = {}) =>
    rulesBlock({ ...ctx, combat: null, dungeon: null, trek: { stretch, of: 2, terrain: 'a forest road', event, wares: [], waiting: null, ...over } }).split('\n')[4];
  const bandits = { foes: 'Bandit ×2', attitude: 'hostile' as const, band: 'low' as const, monsters: [{ name: 'Bandit', count: 2, toughness: 'weak' as const }] };
  assert.equal(road(1, 'bandits', { waiting: bandits }),
    'THE ROAD (stretch 1 of 2, a forest road): bandits. Waiting here, barring the way: Bandit ×2 (hostile). Each Bandit is weak. The fight is low. After it: more road.');
  assert.equal(road(2, 'vendor', { wares: [{ id: 'potion-of-healing', name: 'Potion of Healing', cost: 50 }, { id: 'rope', name: 'Rope', cost: 1 }] }),
    'THE ROAD (stretch 2 of 2, a forest road): a wandering vendor, selling Potion of Healing (potion-of-healing, 50 gp), Rope (rope, 1 gp). After it: the dungeon door.');
  assert.equal(road(1, 'quiet'), 'THE ROAD (stretch 1 of 2, a forest road): a quiet stretch. After it: more road.');
  for (const words of ['THE ROAD', 'overland', 'no corridors', 'travels on by itself', 'only the wares listed']) assert.ok(RULES_INSTRUCTIONS.includes(words), words);
});

test('the LLM DM opens a road game on the road from the tavern, not at the door', () => {
  assert.match(openingNote({ ...ctx, trek: { stretch: 1, of: 2, terrain: 'a forest road', event: 'quiet', wares: [], waiting: null } }), /on the road from the tavern/);
  assert.equal(openingNote({ ...ctx, trek: null }), '');
  assert.equal(openingNote(null), '');
});
