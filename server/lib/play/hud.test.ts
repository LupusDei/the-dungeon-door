import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heroSheet } from '../characters.ts';
import { hold } from '../rules/holds.ts';
import type { CombatState } from '../rules/scene.ts';
import type { CharacterSheet } from '../rules/sheet.ts';
import { type CombatVotes, fightRound, startFight } from './fight.ts';
import { combatHud, tierOf, TIER_LABELS } from './hud.ts';
import type { PartyState } from './state.ts';
import { legalActions } from './legal.ts';
import { rulesView } from './view.ts';

const fighter = heroSheet({ id: 'f', name: 'Bryn', race: 'human', characterClass: 'fighter' });
const wizard = heroSheet({ id: 'w', name: 'Cleo', race: 'elf', characterClass: 'wizard' });
const sleeper: CharacterSheet = { ...wizard, spellcasting: { ...wizard.spellcasting!, prepared: [...wizard.spellcasting!.prepared, 'sleep'] } };

test('a foe’s tier by its share of hit points: unhurt at full, hurt below, bloodied at half, near death at a quarter, down at 0', () => {
  const at20 = [20, 19, 11, 10, 6, 5, 1, 0].map((hp) => tierOf(hp, 20));
  assert.deepEqual(at20, ['unhurt', 'hurt', 'hurt', 'bloodied', 'bloodied', 'near-death', 'near-death', 'down']);
  assert.deepEqual([7, 4, 3, 2, 1].map((hp) => tierOf(hp, 7)), ['unhurt', 'hurt', 'bloodied', 'bloodied', 'near-death']);
  assert.deepEqual(Object.values(TIER_LABELS), ['Unhurt', 'Hurt', 'Bloodied', 'Near death', 'Down']);
});

const party: PartyState = { version: 1, rng: 7, sheets: { p1: fighter, p2: sleeper } };

function hurt(combat: CombatState, id: string, hp: number): CombatState {
  return { ...combat, combatants: { ...combat.combatants, [id]: { ...combat.combatants[id], hp } } };
}

test('the HUD: heroes with their hit points, foes with a tier and never a hit point, both in initiative order', () => {
  const { combat } = startFight(party, ['goblin-warrior', 'goblin-warrior']);
  const max = combat.combatants['foe-1'].maxHp;
  const hud = combatHud(hurt(hurt(combat, 'foe-1', Math.floor(max / 2)), 'p1', 3), party.sheets);
  assert.deepEqual(hud.party.map((h) => h.id), combat.order.filter((id) => !id.startsWith('foe')));
  assert.deepEqual(hud.foes.map((f) => f.id), combat.order.filter((id) => id.startsWith('foe')));
  const bryn = hud.party.find((h) => h.id === 'p1')!;
  assert.deepEqual([bryn.hp, bryn.maxHp], [3, fighter.maxHp]);
  const first = hud.foes.find((f) => f.id === 'foe-1')!;
  assert.deepEqual(first, { id: 'foe-1', name: 'Goblin Warrior 1', tier: 'bloodied', label: 'Bloodied', status: 'up', conditions: [] });
  for (const foe of hud.foes) assert.deepEqual(Object.keys(foe).sort(), ['conditions', 'id', 'label', 'name', 'status', 'tier']);
});

test('no foe’s hit points leave the server in the rules view, at any hit points', () => {
  const { combat } = startFight(party, ['ogre', 'goblin-warrior']);
  for (const hp of [0, 1, 3, 7, 20, 59]) {
    const view = rulesView({ party, combat: hurt(combat, 'foe-1', hp), dungeon: null }, []);
    const json = JSON.stringify(view.combat);
    const foes = [...view.combat!.combatants.filter((c) => c.side === 'foes'), ...view.combat!.hud.foes];
    for (const foe of foes) {
      assert.equal('hp' in foe, false);
      assert.equal('maxHp' in foe, false);
    }
    assert.doesNotMatch(json, /"(hp|maxHp)":\d+,"?[^}]*"side":"foes"/);
  }
  const dead = rulesView({ party, combat: { ...combat, combatants: { ...combat.combatants, 'foe-2': { ...combat.combatants['foe-2'], hp: 0, status: 'dead' } } }, dungeon: null }, []);
  assert.deepEqual(dead.combat!.hud.foes.find((f) => f.id === 'foe-2'), { id: 'foe-2', name: 'Goblin Warrior', tier: 'down', label: 'Dead', status: 'dead', conditions: [] });
});

test('a hero’s conditions on the HUD: what it carries (with how it ends), its concentration, its Dodge', () => {
  const poisoned: CharacterSheet = { ...fighter, conditions: [{ condition: 'poisoned', until: { kind: 'time', left: 600 } }] };
  const focused: CharacterSheet = { ...sleeper, spellcasting: { ...sleeper.spellcasting!, concentratingOn: 'sleep' } };
  const sheets = { p1: poisoned, p2: focused };
  const { combat } = startFight({ ...party, sheets }, ['goblin-warrior']);
  const hud = combatHud({ ...combat, dodging: ['p1'] }, sheets);
  assert.deepEqual(hud.party.find((h) => h.id === 'p1')!.conditions, [
    { id: 'poisoned', label: 'Poisoned', source: null, ends: '10 minutes' },
    { id: 'dodging', label: 'Dodging', source: null, ends: 'Until its next turn' },
  ]);
  assert.deepEqual(hud.party.find((h) => h.id === 'p2')!.conditions, [{ id: 'concentrating', label: 'Concentrating', source: 'Sleep', ends: null }]);
});

/** A fight where Cleo casts Sleep on a goblin that cannot resist and cannot hurt anyone (it has no attack: it Dodges). */
function sleepFight() {
  const start = startFight(party, ['goblin-warrior']);
  const goblin = start.combat.combatants['foe-1'];
  const combat: CombatState = {
    ...start.combat,
    combatants: { ...start.combat.combatants, 'foe-1': { ...goblin, hp: 200, maxHp: 200, attacks: [], saveBonuses: { ...goblin.saveBonuses, wis: -30 } } },
  };
  return { party: start.party, combat };
}
const dodge: CombatVotes = { p1: { choiceId: 'c', roll: 10 } };
const castSleep: CombatVotes = { ...dodge, p2: { choiceId: 'b', roll: 10, actionId: 'spell:sleep', targets: ['foe-1'] } };

test('Sleep in a fight: the foe is Incapacitated, then Asleep after its failed save, on the HUD with the spell that did it', () => {
  const fight = sleepFight();
  const one = fightRound(fight.party, fight.combat, castSleep);
  assert.ok(one.lines.some((l) => l === 'Cleo casts Sleep: Goblin Warrior fails the save: Incapacitated.'), one.lines.join('\n'));
  const two = fightRound(one.party, one.combat, dodge);
  const lines = [...one.lines, ...two.lines];
  assert.ok(lines.some((l) => /^Goblin Warrior is still held by Sleep: Unconscious \(WIS save -?\d+ vs DC 13\)\.$/.test(l)), lines.join('\n'));
  const foe = combatHud(two.combat, two.party.sheets).foes[0];
  assert.deepEqual(foe.conditions, [{ id: 'asleep', label: 'Asleep', source: 'Sleep', ends: 'Ends with any damage or the caster losing concentration' }]);
  assert.deepEqual(foe.tier, 'unhurt');

});

test('Sleep ends when the sleeper is hurt, and when its caster stops concentrating; the HUD clears and the round says so', () => {
  const fight = sleepFight();
  const one = fightRound(fight.party, fight.combat, castSleep);
  const asleep = fightRound(one.party, one.combat, dodge);
  assert.deepEqual(asleep.combat.combatants['foe-1'].conditions, ['unconscious']);

  const hit = fightRound(asleep.party, asleep.combat, { p1: { choiceId: 'a', roll: 20 }, p2: { choiceId: 'c', roll: 10 } });
  assert.ok(hit.lines.includes('Goblin Warrior wakes from Sleep.'), hit.lines.join('\n'));
  assert.deepEqual(combatHud(hit.combat, hit.party.sheets).foes[0].conditions, []);
  assert.equal(combatHud(hit.combat, hit.party.sheets).foes[0].tier, 'hurt');

  const distracted = { ...asleep.party, sheets: { ...asleep.party.sheets, p2: { ...asleep.party.sheets.p2, spellcasting: { ...asleep.party.sheets.p2.spellcasting!, concentratingOn: null } } } };
  const lost = fightRound(distracted, asleep.combat, { p1: { choiceId: 'c', roll: 10 }, p2: { choiceId: 'c', roll: 10 } });
  assert.ok(lost.lines.includes('Goblin Warrior wakes from Sleep.'), lost.lines.join('\n'));
  assert.deepEqual(lost.combat.combatants['foe-1'].conditions, []);
});

test('a foe that makes its repeat save at the end of its turn shakes the spell off', () => {
  const fight = sleepFight();
  const goblin = fight.combat.combatants['foe-1'];
  const drowsy = hold({ ...goblin, saveBonuses: { ...goblin.saveBonuses, wis: 30 } }, 'sleep', 'p2', 13, 'wis');
  const focused = { ...fight.party, sheets: { ...fight.party.sheets, p2: { ...sleeper, spellcasting: { ...sleeper.spellcasting!, concentratingOn: 'sleep' } } } };
  const two = fightRound(focused, { ...fight.combat, combatants: { ...fight.combat.combatants, 'foe-1': drowsy } }, dodge);
  assert.ok(two.lines.includes('Goblin Warrior cannot act.'), two.lines.join('\n'));
  assert.ok(two.lines.some((l) => /^Goblin Warrior shakes off Sleep \(WIS save \d+ vs DC 13\)\.$/.test(l)), two.lines.join('\n'));
  assert.deepEqual([two.combat.combatants['foe-1'].conditions, two.combat.combatants['foe-1'].holds], [[], undefined]);
});

test('Sleep is offered as an action at the foes it can reach, and needs a target', () => {
  const fight = sleepFight();
  const actions = legalActions({ combat: fight.combat, sheet: fight.party.sheets.p2, playerId: 'p2', choices: [], canAct: true });
  const sleep = actions.find((a) => a.id === 'spell:sleep')!;
  assert.deepEqual([sleep.reason, sleep.targets.map((t) => t.id), sleep.detail], [null, ['foe-1'], 'Wisdom save DC 13 or Incapacitated. Uses a level 1 slot (2 left).']);
});

test('the HUD’s turn order: everyone in initiative order, who acts now, and who is next past anyone who cannot act', () => {
  const { combat } = startFight(party, ['goblin-warrior']);
  const order = ['p2', 'foe-1', 'p1'];
  const at = (turn: number, c: CombatState = combat) => combatHud({ ...c, order, turn }, party.sheets);
  assert.deepEqual(at(0).order, order);
  assert.deepEqual([at(1).now, at(1).next], ['foe-1', 'p1']);
  assert.deepEqual([at(2).now, at(2).next], ['p1', 'p2']);
  const asleep = { ...combat, combatants: { ...combat.combatants, 'foe-1': hold(combat.combatants['foe-1'], 'sleep', 'p2', 13, 'wis') } };
  assert.deepEqual([at(0, asleep).now, at(0, asleep).next], ['p2', 'p1']);
  const fallen = { ...combat, combatants: { ...combat.combatants, p1: { ...combat.combatants.p1, hp: 0, status: 'dying' as const } } };
  assert.deepEqual([at(1, fallen).now, at(1, fallen).next], ['foe-1', 'p2'], 'a dying hero makes death saves, not a turn');
  assert.deepEqual([at(0, { ...combat, outcome: 'victory' }).now, at(0, { ...combat, outcome: 'victory' }).next], [null, null]);
});

test('a lone combatant who can act is next after itself', () => {
  const { combat } = startFight({ ...party, sheets: { p1: fighter } }, ['goblin-warrior']);
  const dead = { ...combat, order: ['p1', 'foe-1'], turn: 0, combatants: { ...combat.combatants, 'foe-1': { ...combat.combatants['foe-1'], hp: 0, status: 'dead' as const } } };
  const hud = combatHud(dead, { p1: fighter });
  assert.deepEqual([hud.now, hud.next], ['p1', 'p1']);
});
