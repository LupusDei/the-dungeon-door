import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heroSheet } from '../characters.ts';
import type { Combatant } from '../rules/combatant.ts';
import type { CombatState } from '../rules/scene.ts';
import type { CharacterSheet } from '../rules/sheet.ts';
import { srd } from '../rules/srd.ts';
import { autoLevelUp, bestSpell, fightRound, heroAction, improvement, MAX_ROUNDS, spellScore, startFight } from './fight.ts';
import type { PartyState } from './state.ts';

const fighter = heroSheet({ id: 'f', name: 'Bryn', race: 'human', characterClass: 'fighter' });
const wizard = heroSheet({ id: 'w', name: 'Cleo', race: 'elf', characterClass: 'wizard' });
const party = (sheets: Record<string, CharacterSheet> = { p1: fighter, p2: wizard }): PartyState => ({ version: 1, rng: 42, sheets });
const deadly = [{ name: 'Doom', bonus: 30, ranged: false, damage: [{ dice: '100', type: 'force' }] }];
const harmless = [{ name: 'Poke', bonus: -100, ranged: false, damage: [{ dice: '0', type: 'force' }] }];
const patch = (combat: CombatState, changes: Record<string, Partial<Combatant>>): CombatState =>
  ({ ...combat, combatants: Object.fromEntries(Object.entries(combat.combatants).map(([id, c]) => [id, { ...c, ...changes[id] }])) });

test('a fight starts with the heroes (by player id) and numbered foes; the party dice move on', () => {
  const { combat, party: after, lines } = startFight(party(), ['goblin-warrior', 'goblin-warrior', 'bugbear-warrior']);
  assert.deepEqual(Object.keys(combat.combatants).sort(), ['foe-1', 'foe-2', 'foe-3', 'p1', 'p2']);
  assert.deepEqual(['foe-1', 'foe-2', 'foe-3'].map((id) => combat.combatants[id].name), ['Goblin Warrior 1', 'Goblin Warrior 2', 'Bugbear Warrior']);
  assert.equal(combat.combatants.p1.name, 'Bryn');
  assert.notEqual(after.rng, 42);
  assert.deepEqual(startFight(party(), ['goblin-warrior']).combat, startFight(party(), ['goblin-warrior']).combat, 'same dice, same fight');
  assert.match(lines[0], /^A fight begins: Goblin Warrior 1, Goblin Warrior 2, Bugbear Warrior\. Initiative: /);
});

test('a hero at 0 HP joins a fight stable, not up', () => {
  const { combat } = startFight(party({ p1: { ...fighter, hp: 0 } }), ['goblin-warrior']);
  assert.equal(combat.combatants.p1.status, 'stable');
});

test('Attack: the best weapon at the most wounded foe, with the vote’s d20; Dodge: dodge', () => {
  const { combat } = startFight(party(), ['goblin-warrior', 'goblin-warrior']);
  const hurt = patch(combat, { 'foe-2': { hp: 3 } });
  const { action } = heroAction(hurt, fighter, 'p1', 'a', 17);
  const best = [...hurt.combatants.p1.attacks].sort((x, y) => y.bonus - x.bonus)[0].name;
  assert.deepEqual(action, { kind: 'attack', attack: best, target: 'foe-2', natural: 17 });
  assert.deepEqual(heroAction(hurt, fighter, 'p1', 'c', 17).action, { kind: 'dodge' });
  const even = patch(combat, { 'foe-1': { hp: 4 }, 'foe-2': { hp: 4 } });
  assert.equal((heroAction(even, fighter, 'p1', 'a', 9).action as { target: string }).target, 'foe-1', 'ties: the first');
});

const caster = (cantrips: string[], prepared: string[], expended = [0, 0, 0, 0, 0, 0, 0, 0, 0]): CharacterSheet =>
  ({ ...wizard, level: 3, spellcasting: { ...wizard.spellcasting!, cantrips, prepared, slots: [4, 2, 0, 0, 0, 0, 0, 0, 0], expended } });

test('the best spell: damaging (attack or save), castable now (a higher slot will do), most damage, first on a tie', () => {
  assert.equal(bestSpell(caster(['fire-bolt'], ['guiding-bolt', 'bless']))!.id, 'guiding-bolt');
  assert.equal(bestSpell(caster(['fire-bolt'], ['guiding-bolt'], [4, 0, 0, 0, 0, 0, 0, 0, 0]))!.id, 'guiding-bolt', 'upcast with a 2nd-level slot');
  assert.equal(bestSpell(caster(['fire-bolt'], ['guiding-bolt'], [4, 2, 0, 0, 0, 0, 0, 0, 0]))!.id, 'fire-bolt', 'no slot left');
  assert.equal(bestSpell(caster(['fire-bolt'], ['guiding-bolt'], [3, 2, 0, 0, 0, 0, 0, 0, 0]))!.id, 'guiding-bolt', 'the last 1st-level slot');
  assert.equal(bestSpell(caster([], ['hex', 'bless'])), null, 'Hex and Bless deal no attack or save damage');
  assert.equal(bestSpell(caster(['fire-bolt', 'chill-touch'], []))!.id, 'fire-bolt');
  assert.equal(bestSpell(caster(['chill-touch', 'fire-bolt'], []))!.id, 'chill-touch');
});

test('a spell’s score is its average damage times its beams (Eldritch Blast at 5: two)', () => {
  const blast = srd().spells.get('eldritch-blast')!;
  assert.equal(spellScore(blast, { ...wizard, level: 5 }), 10);
  assert.equal(spellScore(blast, wizard), 5);
});

test('the Ability Score Improvement: +2 to the best score below 20, or +1 to the two best when it is at 19', () => {
  const scores = (o: Partial<CharacterSheet['abilityScores']>) => ({ ...fighter, abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, ...o } });
  assert.deepEqual(improvement(scores({ str: 16, dex: 14 })).increases, { str: 2 });
  assert.deepEqual(improvement(scores({ str: 18 })).increases, { str: 2 });
  assert.deepEqual(improvement(scores({ str: 12, con: 17 })).increases, { con: 2 });
  assert.deepEqual(improvement(scores({ str: 20, dex: 19, con: 15 })).increases, { dex: 1, con: 1 });
});

test('an area spell catches as many foes as it can (areaCatch), the most wounded first', () => {
  const { combat } = startFight(party(), ['goblin-warrior', 'goblin-warrior', 'goblin-warrior', 'goblin-warrior']);
  const pyro = { ...wizard, spellcasting: { ...wizard.spellcasting!, cantrips: [], prepared: ['burning-hands'] } };
  const hurt = patch(combat, { 'foe-3': { hp: 1 }, 'foe-4': { hp: 0, status: 'dead' } });
  const { action } = heroAction(hurt, pyro, 'p2', 'b', 12);
  assert.deepEqual(action.kind === 'spell' && [action.cast.spellId, action.targets], ['burning-hands', ['foe-3', 'foe-1']], 'a 15-foot cone: two foes, never the dead');
  const blast = { ...pyro, level: 5, spellcasting: { ...pyro.spellcasting!, prepared: ['fireball'], slots: [4, 3, 2, 0, 0, 0, 0, 0, 0], expended: [0, 0, 0, 0, 0, 0, 0, 0, 0] } };
  const { action: big } = heroAction(hurt, blast, 'p2', 'b', 12);
  assert.deepEqual(big.kind === 'spell' && big.targets, ['foe-3', 'foe-1', 'foe-2'], 'a 20-foot sphere would take five: there are three left');
});

test('Cast: the caster’s best attack spell it can cast now; a leveled one spends its slot; no spell means Attack', () => {
  const { combat } = startFight(party(), ['goblin-warrior']);
  const spell = bestSpell(wizard)!;
  assert.ok(spell, 'a wizard has an attack spell');
  const { action, sheet } = heroAction(combat, wizard, 'p2', 'b', 12);
  assert.equal(action.kind, 'spell');
  assert.deepEqual(action.kind === 'spell' && [action.cast.spellId, action.targets.length, action.natural], [spell.id, action.kind === 'spell' ? action.cast.beams : 0, 12]);
  assert.equal(sheet.spellcasting!.expended[0], spell.level > 0 ? 1 : 0);
  assert.equal(action.kind === 'spell' && action.caster.modifier, Math.floor((wizard.abilityScores.int - 10) / 2));
  assert.equal(bestSpell(fighter), null);
  assert.equal(heroAction(combat, fighter, 'p1', 'b', 12).action.kind, 'attack');
  const spent = { ...wizard, spellcasting: { ...wizard.spellcasting!, expended: [...wizard.spellcasting!.slots] } };
  assert.equal(bestSpell(spent)!.level, 0, 'no slots left: a cantrip');
});

test('a round where the heroes cannot miss: victory, the living heroes split the XP and level up', () => {
  const { combat, party: p } = startFight(party(), ['goblin-warrior', 'goblin-warrior']);
  const strong = patch(combat, { p1: { attacks: deadly }, p2: { attacks: deadly }, 'foe-1': { attacks: harmless }, 'foe-2': { attacks: harmless } });
  const votes = { p1: { choiceId: 'a' as const, roll: 10 }, p2: { choiceId: 'a' as const, roll: 10 } };
  let result = fightRound(p, strong, votes);
  const lines = [...result.lines];
  for (let i = 0; result.ended === null && i < 3; i++) {
    result = fightRound(result.party, result.combat, votes);
    lines.push(...result.lines);
  }
  assert.equal(result.ended, 'victory');
  assert.deepEqual([result.party.sheets.p1.xp, result.party.sheets.p2.xp], [50, 50]);
  assert.ok(lines.includes('Victory! 100 XP, 50 each.'));
  assert.deepEqual(lines.filter((l) => / falls\.$/.test(l)).sort(), ['Goblin Warrior 1 falls.', 'Goblin Warrior 2 falls.'], 'each foe falls once; no hero');
});

test('XP that reaches a new level levels the hero up on the spot (average hit points)', () => {
  const ready = { ...fighter, xp: 300 };
  const up = autoLevelUp(ready);
  assert.deepEqual([up.sheet.level, up.sheet.maxHp - fighter.maxHp], [2, 6 + Math.floor((fighter.abilityScores.con - 10) / 2)]);
  assert.deepEqual(up.lines, [`Bryn reaches level 2 (+${up.sheet.maxHp - fighter.maxHp} max HP).`]);
  assert.equal(autoLevelUp(fighter).lines.length, 0);
  const three = autoLevelUp({ ...fighter, xp: 900 });
  assert.equal(three.sheet.level, 3, 'two levels at once');
  assert.notEqual(three.sheet.subclassId, null, 'the subclass at its level');
  const four = autoLevelUp({ ...fighter, xp: 2700 });
  const total = (s: CharacterSheet) => Object.values(s.abilityScores).reduce((a, b) => a + b, 0);
  assert.equal(total(four.sheet) - total(fighter), 2, 'the Ability Score Improvement at 4');
});

test('heroes who all fall lose the fight; their sheets keep the damage', () => {
  const { combat, party: p } = startFight(party(), ['ogre']);
  const doomed = patch(combat, { p1: { attacks: harmless }, p2: { attacks: harmless }, 'foe-1': { attacks: deadly } });
  let result = fightRound(p, doomed, {});
  for (let i = 0; result.ended === null && i < 6; i++) result = fightRound(result.party, result.combat, {});
  assert.equal(result.ended, 'defeat');
  assert.deepEqual([result.party.sheets.p1.hp, result.party.sheets.p2.hp], [0, 0]);
  assert.deepEqual([result.party.sheets.p1.dead, result.party.sheets.p2.dead], [true, true], '100 damage is massive damage: the slain stay dead');
  assert.ok(result.lines.includes('Bryn is dead.'));
});

test('a fight still going after the last round ends with the foes fleeing', () => {
  const { combat, party: p } = startFight(party(), ['goblin-warrior']);
  const stalemate = { ...patch(combat, { p1: { attacks: harmless }, p2: { attacks: harmless }, 'foe-1': { attacks: harmless } }), round: MAX_ROUNDS };
  const result = fightRound(p, stalemate, {});
  assert.equal(result.ended, 'fled');
  assert.equal(fightRound(p, { ...stalemate, round: MAX_ROUNDS - 1 }, {}).ended, null, 'the last round is still fought');
  assert.ok(result.lines.includes('The foes flee.'), 'none slain, no XP');
});

test('the round is told in lines: attacks, dodges', () => {
  const { combat, party: p } = startFight(party(), ['goblin-warrior']);
  const calm = patch(combat, { 'foe-1': { attacks: harmless } });
  const result = fightRound(p, calm, { p1: { choiceId: 'c', roll: 5 }, p2: { choiceId: 'a', roll: 1 } });
  assert.ok(result.lines.includes('Bryn dodges.'));
  assert.ok(result.lines.some((l) => /^Cleo attacks Goblin Warrior with .+: 1 \(total -?\d+\) vs AC \d+, miss\.$/.test(l)), result.lines.join(' | '));
  assert.ok(result.lines.some((l) => /^Goblin Warrior attacks (Bryn|Cleo) with Poke/.test(l)));
});

const winRound = (combat: CombatState, p: PartyState, changes: Record<string, Partial<Combatant>>) => {
  const rigged = patch(combat, { p1: { attacks: deadly }, 'foe-1': { attacks: harmless }, ...changes });
  let result = fightRound(p, rigged, { p1: { choiceId: 'a', roll: 10 } });
  const lines = [...result.lines];
  for (let i = 0; result.ended === null && i < 4; i++) { result = fightRound(result.party, result.combat, { p1: { choiceId: 'a', roll: 10 } }); lines.push(...result.lines); }
  return { result, lines };
};

test('after a won fight a dying hero is settled: stabilized and awake with 1 HP, or dead', () => {
  const { combat, party: p } = startFight(party(), ['goblin-warrior']);
  const { result, lines } = winRound(combat, p, { p2: { hp: 0, status: 'dying', conditions: ['unconscious'] } });
  assert.equal(result.ended, 'victory');
  const cleo = result.party.sheets.p2;
  assert.ok(cleo.dead ? lines.includes('Cleo dies.') : cleo.hp === 1, lines.join(' | '));
});

test('a hero slain in a won fight stays dead and gets no XP', () => {
  const { combat, party: p } = startFight(party(), ['goblin-warrior']);
  const { result, lines } = winRound(combat, p, { p2: { hp: 0, status: 'dead' } });
  assert.deepEqual([result.party.sheets.p2.dead, result.party.sheets.p2.xp, result.party.sheets.p1.xp], [true, 0, 50]);
  assert.ok(lines.includes('Cleo is dead.'));
});

test('the dead do not join a fight, and their sheets are left alone', () => {
  const ghost = { ...wizard, hp: 0, dead: true };
  const { combat, party: p } = startFight(party({ p1: fighter, p2: ghost }), ['ogre']);
  assert.deepEqual(Object.keys(combat.combatants).sort(), ['foe-1', 'p1']);
  const doomed = patch(combat, { p1: { attacks: harmless }, 'foe-1': { attacks: deadly } });
  let result = fightRound(p, doomed, {});
  for (let i = 0; result.ended === null && i < 6; i++) result = fightRound(result.party, result.combat, {});
  assert.equal(result.ended, 'defeat');
  assert.deepEqual(result.party.sheets.p2, ghost);
});

/** Round 1 against two goblins: Bryn's bow drops one; Cleo can only poke. Then the survivor's morale. */
function shakenRound(rng: number) {
  const { combat, party: p } = startFight({ ...party(), rng }, ['goblin-warrior', 'goblin-warrior']);
  const bow = deadly.map((a) => ({ ...a, ranged: true }));
  const rigged = patch(combat, { p1: { attacks: bow }, p2: { attacks: harmless }, 'foe-1': { attacks: harmless }, 'foe-2': { attacks: harmless } });
  return fightRound(p, rigged, { p1: { choiceId: 'a', roll: 10 }, p2: { choiceId: 'a', roll: 10 } });
}

test('morale in the fight: the shaken foes stand, flee (XP for the slain, Opportunity Attacks) or surrender (all the XP)', () => {
  const rounds = Array.from({ length: 60 }, (_, i) => shakenRound(i + 1));
  const by = (word: string) => rounds.find((r) => r.lines.some((l) => l.startsWith('Morale (') && l.includes(word)))!;
  const stand = by('stand firm');
  assert.equal(stand.ended, null);
  const fled = by('break and flee');
  assert.equal(fled.ended, 'fled');
  assert.ok(fled.lines.some((l) => /^Opportunity Attack: Cleo attacks Goblin Warrior 2 with Poke: /.test(l)), fled.lines.join(' | '));
  assert.ok(fled.lines.includes('The foes flee. 50 XP, 25 each.'));
  assert.deepEqual([fled.party.sheets.p1.xp, fled.party.sheets.p2.xp], [25, 25]);
  const morale = fled.lines.findIndex((l) => l.startsWith('Morale ('));
  assert.ok(fled.lines.findIndex((l) => l.startsWith('Opportunity Attack')) > morale, 'the flight, then the parting blows');
  const yielded = by('surrender');
  assert.equal(yielded.ended, 'victory');
  assert.ok(yielded.lines.includes('Victory! 100 XP, 50 each.'), yielded.lines.join(' | '));
});

test('a hero at half HP or less drinks its least healing potion as a Bonus Action, then acts', () => {
  const stocked = { ...fighter, equipment: [...fighter.equipment, { id: 'potion-of-greater-healing', name: 'Potion of Greater Healing', count: 1 }, { id: 'potion-of-healing', name: 'Potion of Healing', count: 2 }] };
  const { combat, party: p } = startFight(party({ p1: stocked, p2: wizard }), ['goblin-warrior']);
  const half = Math.floor(stocked.maxHp / 2);
  const calm = patch(combat, { p1: { hp: half }, 'foe-1': { attacks: harmless } });
  const result = fightRound(p, calm, { p1: { choiceId: 'c', roll: 10 } });
  const drank = result.lines.find((l) => l.startsWith('Bryn drinks'))!;
  assert.match(drank, /^Bryn drinks a Potion of Healing as a Bonus Action: (\d+) HP back\.$/);
  const healed = Number(/: (\d+) HP/.exec(drank)![1]);
  assert.ok(healed >= 4 && healed <= 10);
  assert.ok(result.lines.indexOf(drank) < result.lines.indexOf('Bryn dodges.'), 'the potion, then the action');
  assert.equal(result.party.sheets.p1.hp, half + healed);
  assert.deepEqual(result.party.sheets.p1.equipment.filter((e) => e.id.startsWith('potion')).map((e) => [e.id, e.count]), [['potion-of-greater-healing', 1], ['potion-of-healing', 1]]);
  const fine = fightRound(p, patch(combat, { p1: { hp: half + 1 }, 'foe-1': { attacks: harmless } }), { p1: { choiceId: 'c', roll: 10 } });
  assert.ok(!fine.lines.some((l) => l.includes('drinks')), 'above half: no potion');
  const exact = fightRound(p, patch(combat, { p1: { hp: 6, maxHp: 12 }, 'foe-1': { attacks: harmless } }), { p1: { choiceId: 'c', roll: 10 } });
  assert.ok(exact.lines.some((l) => l.startsWith('Bryn drinks')), 'exactly half: a potion');
  const one = { ...fighter, equipment: [...fighter.equipment, { id: 'potion-of-healing', name: 'Potion of Healing', count: 1 }] };
  const single = startFight(party({ p1: one, p2: wizard }), ['goblin-warrior']);
  const last = fightRound(single.party, patch(single.combat, { p1: { hp: 1 }, 'foe-1': { attacks: harmless } }), { p1: { choiceId: 'c', roll: 10 } });
  assert.ok(last.lines.some((l) => l.startsWith('Bryn drinks')), 'the last potion too');
  assert.equal(last.party.sheets.p1.equipment.some((e) => e.id === 'potion-of-healing'), false);
  const dry = fightRound(party(), patch(startFight(party(), ['goblin-warrior']).combat, { p1: { hp: 1 }, 'foe-1': { attacks: harmless } }), {});
  assert.ok(!dry.lines.some((l) => l.includes('drinks')), 'no potion, none drunk');
  const unvoted = fightRound(p, calm, {});
  assert.ok(unvoted.lines.some((l) => l.startsWith('Bryn drinks')), 'without a vote they still drink, then Dodge');
});

test('a hero slain in the fight is Revivified at its end by a party caster with the spell, a slot and the gold', () => {
  const cleric = heroSheet({ id: 'c', name: 'Mira', race: 'human', characterClass: 'cleric' });
  const slots = [4, 3, 2, 0, 0, 0, 0, 0, 0];
  const priest = { ...cleric, gp: 300, spellcasting: { ...cleric.spellcasting!, prepared: ['revivify'], slots, expended: slots.map(() => 0) } };
  const { combat, party: p } = startFight(party({ p1: fighter, p2: priest, p3: wizard }), ['goblin-warrior']);
  const { result, lines } = winRound(combat, p, { p2: { attacks: harmless }, p3: { hp: 0, status: 'dead' } });
  assert.equal(result.ended, 'victory');
  assert.deepEqual([result.party.sheets.p3.dead, result.party.sheets.p3.hp, result.party.sheets.p2.gp], [undefined, 1, 0]);
  assert.deepEqual(lines.slice(-2), ['Cleo is dead.', 'Mira casts Revivify on Cleo, using up a 300 gp diamond: Cleo lives again with 1 HP.']);
  const lost = winRound(combat, p, { p2: { hp: 0, status: 'dead' } });
  assert.equal(lost.result.party.sheets.p2.dead, true, 'the caster herself slain: nobody to cast');
});

test('in the dark whoever cannot see fights Blinded: darkvision, blindsight or truesight see; in any light nobody is', () => {
  const human = { ...heroSheet({ id: 'h', name: 'Ann', race: 'human', characterClass: 'fighter' }) };
  const dwarf = { ...heroSheet({ id: 'd', name: 'Dun', race: 'dwarf', characterClass: 'fighter' }) };
  const p: PartyState = { version: 1, rng: 3, sheets: { p1: human, p2: dwarf } };
  const dark = startFight(p, ['bandit', 'goblin-warrior'], 'dark');
  const blind = Object.values(dark.combat.combatants).filter((c) => c.conditions.includes('blinded')).map((c) => c.name);
  assert.deepEqual(blind, ['Ann', 'Bandit']);
  assert.equal(dark.lines[1], 'In the dark, Ann, Bandit cannot see (Blinded).');
  for (const light of ['dim', 'bright'] as const) {
    const lit = startFight(p, ['bandit'], light);
    assert.equal(Object.values(lit.combat.combatants).some((c) => c.conditions.length > 0), false, light);
    assert.equal(lit.lines.length, 1);
  }
});

test('a hero brings its conditions into a fight (a Poisoned hero attacks with Disadvantage)', () => {
  const sick = { ...heroSheet({ id: 'h', name: 'Ann', race: 'human', characterClass: 'fighter' }), conditions: [{ condition: 'poisoned' as const, until: { kind: 'time' as const, left: 600 } }] };
  const { combat } = startFight({ version: 1, rng: 3, sheets: { p1: sick } }, ['bandit'], 'dark');
  assert.deepEqual(combat.combatants.p1.conditions, ['poisoned', 'blinded']);
  const blind = { ...sick, conditions: [{ condition: 'blinded' as const, until: { kind: 'long-rest' as const } }] };
  assert.deepEqual(startFight({ version: 1, rng: 3, sheets: { p1: blind } }, ['bandit'], 'dark').combat.combatants.p1.conditions, ['blinded'], 'not twice');
});

test('each round a hero first saves against what a save ends; what its sheet loses, its combatant loses too', () => {
  const scared = { ...fighter, conditions: [{ condition: 'frightened' as const, until: { kind: 'save' as const, ability: 'wis' as const, dc: 10 } }] };
  const start = startFight(party({ p1: scared, p2: wizard }), ['goblin-warrior']);
  assert.deepEqual(start.combat.combatants.p1.carried, ['frightened']);
  assert.equal(start.combat.combatants.p2.carried, undefined, 'nothing carried, nothing kept');
  const easy = { ...scared, conditions: [{ ...scared.conditions[0], until: { ...scared.conditions[0].until, dc: -50 } }] };
  const free = fightRound({ ...start.party, sheets: { p1: easy, p2: wizard } }, patch(start.combat, { 'foe-1': { attacks: harmless } }), {});
  assert.match(free.lines[0], /^Bryn shakes off Frightened \(WIS save -?\d+ vs DC -50\)\.$/);
  assert.deepEqual(free.combat.combatants.p1.conditions, []);
  assert.deepEqual(free.combat.combatants.p1.carried, []);
  const hard = { ...scared, conditions: [{ ...scared.conditions[0], until: { ...scared.conditions[0].until, dc: 99 } }] };
  const stuck = fightRound({ ...start.party, sheets: { p1: hard, p2: wizard } }, patch(start.combat, { 'foe-1': { attacks: harmless } }), {});
  assert.match(stuck.lines[0], /^Bryn is still Frightened/);
  assert.deepEqual(stuck.combat.combatants.p1.conditions, ['frightened']);
  const netted = { ...fighter, conditions: [{ condition: 'restrained' as const, until: { kind: 'escape' as const, ability: 'str' as const, skill: 'athletics' as const, dc: -50 } }] };
  const held = fightRound(party({ p1: netted, p2: wizard }), patch(startFight(party({ p1: netted, p2: wizard }), ['goblin-warrior']).combat, { 'foe-1': { attacks: harmless } }), {});
  assert.equal(held.lines.some((l) => l.includes('breaks free')), false, 'in a fight, escaping takes the action');
  assert.deepEqual(held.party.sheets.p1.conditions, netted.conditions);
});

test('a concentrating hero who is hurt saves to keep it; when the fight ends, so does any concentration', () => {
  const focused = { ...wizard, spellcasting: { ...wizard.spellcasting!, concentratingOn: 'sleep' } };
  const start = startFight(party({ p1: fighter, p2: focused }), ['goblin-warrior']);
  const sting = [{ name: 'Sting', bonus: 30, ranged: false, damage: [{ dice: '1', type: 'piercing' }] }];
  const round = fightRound(start.party, patch(start.combat, { 'foe-1': { attacks: sting, hp: 500, maxHp: 500 }, p1: { hp: 500, maxHp: 500 }, p2: { hp: 400, maxHp: 500 } }), {});
  assert.ok(round.lines.some((l) => /^Cleo (keeps concentrating|loses concentration) on Sleep \(CON save -?\d+ vs DC 10\)\.$/.test(l)), round.lines.join('\n'));
  const won = fightRound(start.party, patch(start.combat, { 'foe-1': { hp: 1, attacks: harmless }, p1: { attacks: deadly }, p2: { attacks: deadly } }), { p1: { choiceId: 'a', roll: 15 }, p2: { choiceId: 'a', roll: 15 } });
  assert.equal(won.ended, 'victory');
  assert.equal(won.party.sheets.p2.spellcasting!.concentratingOn, null);
});

test('Attack with Extra Attack: the best weapon again for each extra attack; without it, one', () => {
  const { combat } = startFight(party(), ['goblin-warrior']);
  const veteran = { ...fighter, features: [...fighter.features, 'Extra Attack'] };
  const best = [...combat.combatants.p1.attacks].sort((x, y) => y.bonus - x.bonus)[0].name;
  assert.deepEqual(heroAction(combat, veteran, 'p1', 'a', 12).action, { kind: 'attack', attack: best, target: 'foe-1', natural: 12, then: [best] });
  assert.equal('then' in heroAction(combat, fighter, 'p1', 'a', 12).action, false);
});

test('a monster power is told, and the condition it brings goes on the hero sheet, with how it ends', () => {
  const start = startFight(party({ p1: fighter }), ['giant-spider']);
  const clumsy = patch(start.combat, { p1: { saveBonuses: { ...start.combat.combatants.p1.saveBonuses, dex: -50 }, attacks: harmless, hp: 500, maxHp: 500 } });
  const round = fightRound(start.party, clumsy, {});
  assert.ok(round.lines.includes('Giant Spider uses Web (DC 13 DEX save): Bryn fails, Restrained.'), round.lines.join('\n'));
  assert.deepEqual(round.party.sheets.p1.conditions, [{ condition: 'restrained', until: { kind: 'escape', ability: 'str', skill: 'athletics', dc: 13 } }]);
  assert.deepEqual(round.combat.combatants.p1.carried, ['restrained']);
  const wolf = startFight(party({ p1: fighter }), ['winter-wolf']);
  const hard = fightRound(wolf.party, patch(wolf.combat, { p1: { attacks: harmless, hp: 500, maxHp: 500 } }), {});
  assert.ok(hard.lines.some((l) => /^Winter Wolf uses Cold Breath \(DC 12 CON save\): Bryn (saves|fails), \d+ damage\.$/.test(l)), hard.lines.join('\n'));
  assert.equal(hard.party.sheets.p1.conditions, undefined, 'no condition, nothing on the sheet');
});

test('a hit rider is told, and its condition goes on the hero sheet', () => {
  const start = startFight(party({ p1: fighter }), ['ghoul']);
  const sure = start.combat.combatants['foe-1'].attacks.map((a) => ({ ...a, bonus: 50 }));
  const weak = patch(start.combat, { 'foe-1': { attacks: sure, multiattack: ['Claw'] }, p1: { saveBonuses: { ...start.combat.combatants.p1.saveBonuses, con: -50 }, attacks: harmless, hp: 500, maxHp: 500 } });
  const round = fightRound(start.party, weak, {});
  assert.ok(round.lines.some((l) => /^Ghoul attacks Bryn with Claw: .* hit for \d+\. Bryn fails the DC 10 CON save: Paralyzed\.$/.test(l)), round.lines.join('\n'));
  assert.deepEqual(round.party.sheets.p1.conditions, [{ condition: 'paralyzed', until: { kind: 'time', left: 6 } }]);
  const toad = startFight(party({ p1: fighter }), ['giant-toad']);
  const bit = fightRound(toad.party, patch(toad.combat, { 'foe-1': { attacks: toad.combat.combatants['foe-1'].attacks.map((a) => ({ ...a, bonus: 50 })) }, p1: { attacks: harmless, hp: 500, maxHp: 500 } }), {});
  assert.ok(bit.lines.some((l) => l.endsWith('Bryn is Grappled.')), bit.lines.join('\n'));
  const tough = fightRound(start.party, patch(weak, { p1: { saveBonuses: { ...start.combat.combatants.p1.saveBonuses, con: 50 }, attacks: harmless, hp: 500, maxHp: 500 } }), {});
  assert.ok(tough.lines.some((l) => l.endsWith('Bryn makes the DC 10 CON save.')), tough.lines.join('\n'));
  const immune = fightRound(start.party, patch(weak, { p1: { conditionImmunities: ['paralyzed'], saveBonuses: { ...start.combat.combatants.p1.saveBonuses, con: -50 }, attacks: harmless, hp: 500, maxHp: 500 } }), {});
  assert.ok(immune.lines.some((l) => l.endsWith('Bryn fails the DC 10 CON save: unaffected.')), immune.lines.join('\n'));
});
