import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RulesContext, RulesResults } from './types.ts';
import { RULES_INSTRUCTIONS, rulesBlock, resultsBlock } from './rulesPrompt.ts';

const ctx: RulesContext = {
  party: [{ name: 'Bryn', level: 2, hp: 7, maxHp: 20, armorClass: 16, exhaustion: 1, slotsLeft: [0, 0, 0, 0, 0, 0, 0, 0, 0] },
    { name: 'Cleo', level: 2, hp: 0, maxHp: 12, armorClass: 12, exhaustion: 0, slotsLeft: [2, 1, 0, 0, 0, 0, 0, 0, 0] }],
  combat: { round: 3, combatants: [{ name: 'Bryn', side: 'party', hp: 7, maxHp: 20, status: 'up' }, { name: 'Ogre', side: 'foes', hp: 0, maxHp: 68, status: 'dead' }] },
  dungeon: { kind: 'Lair', area: 'Grand chamber', purpose: 'Throne room', exits: [{ id: 'r2', connection: 'locked-door', leadsTo: 'Vault' }, { id: 'x1', connection: 'open-passage', leadsTo: null }] },
  monsters: ['ogre', 'goblin-warrior'],
};

const heroOnly = (slotsLeft: number[]) => rulesBlock({ ...ctx, party: [{ ...ctx.party[0], slotsLeft }], combat: null, dungeon: null }).split('\n')[1];

test('the rules block tells the DM the party’s numbers, the fight, the area and its exits, and the monsters to use', () => {
  assert.equal(rulesBlock(ctx), [
    'THE RULES ENGINE (SRD 5.2)',
    '- Bryn: level 2, 7/20 HP, AC 16, exhaustion 1',
    '- Cleo: level 2, DOWN (0/12 HP), AC 12, spell slots left 2/1',
    'COMBAT, round 3: Bryn 7/20 HP; Ogre dead',
    'DUNGEON (Lair): the party is in Grand chamber (Throne room). Exits: r2 locked-door to Vault; x1 open-passage to unexplored',
    'Monsters for fights: ogre, goblin-warrior',
  ].join('\n'));
  assert.equal(rulesBlock({ ...ctx, combat: null, dungeon: { ...ctx.dungeon!, purpose: null, exits: [] } }).split('\n')[3],
    'DUNGEON (Lair): the party is in Grand chamber. Exits: none');
  assert.equal(heroOnly([3, 0, 0, 0, 0, 0, 0, 0, 0]), '- Bryn: level 2, 7/20 HP, AC 16, exhaustion 1, spell slots left 3');
  assert.equal(rulesBlock(null), '');
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
