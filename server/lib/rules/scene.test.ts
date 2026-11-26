import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Combatant, extraAttacks, heroCombatant, monsterCombatant } from './combatant.ts';
import { monster } from './monsters.ts';
import { act, aimAgain, choicesFor, currentActor, drinkPotion, monsterAction, orderByInitiative, playRound, reactionAttack, startCombat, xpEarned } from './scene.ts';
import { heroSheet } from '../characters.ts';
import { SAMPLE } from './sheet.fixture.ts';
import type { CombatState } from './scene.ts';

const hero = (id: string, o: Partial<Combatant> = {}): Combatant => ({ ...heroCombatant(id, { ...SAMPLE, name: id }), ...o });
const goblin = (id: string, o: Partial<Combatant> = {}): Combatant => ({ ...monsterCombatant(id, monster('goblin-warrior')), name: id, ...o });
/** Hits anything short of AC 40 and kills anything with less than 100 HP. */
const deadly = [{ name: 'Doom', bonus: 20, ranged: false, damage: [{ dice: '100', type: 'force' }] }];
const harmless = [{ name: 'Poke', bonus: -100, ranged: false, damage: [{ dice: '0', type: 'force' }] }];

test('initiative goes highest first, ties to the higher bonus, then to the order given', () => {
  assert.deepEqual(orderByInitiative([
    { id: 'a', roll: 12, bonus: 1 }, { id: 'b', roll: 15, bonus: 0 }, { id: 'c', roll: 12, bonus: 3 }, { id: 'd', roll: 12, bonus: 1 },
  ]), ['b', 'c', 'a', 'd']);
});

test('a combat starts with everyone in initiative order, round 1, and is the same for the same seed', () => {
  const s = startCombat(7, [hero('bryn'), goblin('g1'), goblin('g2')]);
  assert.equal(s.version, 1);
  assert.equal(s.round, 1);
  assert.deepEqual([...s.order].sort(), ['bryn', 'g1', 'g2']);
  const rolls = s.order.map((id) => s.initiative[id]);
  assert.deepEqual(rolls, [...rolls].sort((x, y) => y - x));
  assert.deepEqual(startCombat(7, [hero('bryn'), goblin('g1'), goblin('g2')]), s);
  assert.equal(s.outcome, 'ongoing');
  assert.equal(currentActor(s), s.order[0], 'the highest roll goes first');
});

test('a hero’s choices are each attack against each living foe, and Dodge', () => {
  const s = startCombat(1, [hero('bryn'), goblin('g1'), goblin('g2', { status: 'dead', hp: 0 })]);
  assert.deepEqual(choicesFor(s, 'bryn'), [
    { label: 'Unarmed Strike: g1', action: { kind: 'attack', attack: 'Unarmed Strike', target: 'g1' } },
    { label: 'Dodge', action: { kind: 'dodge' } },
  ]);
});

const heroFirst = (combatants: Combatant[]) => {
  for (let seed = 0; ; seed++) {
    const s = startCombat(seed, combatants);
    if (currentActor(s) === combatants[0].id) return s;
  }
};

test('a vote’s d20 is the attack roll; the turn passes on and the log says what happened', () => {
  const s = heroFirst([hero('bryn'), goblin('g1', { attacks: harmless })]);
  const next = act(s, { kind: 'attack', attack: 'Unarmed Strike', target: 'g1', natural: 18 });
  const event = next.log.at(-1)!;
  assert.equal(event.kind, 'attack');
  assert.deepEqual(event.kind === 'attack' && [event.actor, event.result.roll.total, event.result.hit, event.result.damage], ['bryn', 23, true, 4]);
  assert.equal(next.combatants.g1.hp, 6);
  assert.equal(currentActor(next), 'g1');
  assert.equal(s.combatants.g1.hp, 10, 'the old state is untouched');
});

const fireBolt = { spellId: 'fire-bolt', slotLevel: 0, damageDice: '1d10', beams: 1, healingDice: null, endedConcentration: null };
const sacredFlame = { spellId: 'sacred-flame', slotLevel: 0, damageDice: '1d8', beams: 1, healingDice: null, endedConcentration: null };
const caster = { saveDc: 13, attackBonus: 5, modifier: 3 };

test('a spell is an action: a spell attack uses the vote’s d20, a save spell the target’s save; both are logged', () => {
  const s = heroFirst([hero('bryn'), goblin('g1', { attacks: harmless })]);
  const hit = act(s, { kind: 'spell', caster, cast: fireBolt, targets: ['g1'], natural: 15 });
  const event = hit.log.at(-1)!;
  assert.equal(event.kind, 'spell');
  assert.deepEqual(event.kind === 'spell' && [event.actor, event.spellId, event.outcomes[0].attack!.roll.total, event.outcomes[0].attack!.hit], ['bryn', 'fire-bolt', 20, true]);
  assert.equal(hit.combatants.g1.hp, 10 - (event.kind === 'spell' ? event.outcomes[0].damage : 0));
  assert.equal(currentActor(hit), 'g1');
  const burned = act(s, { kind: 'spell', caster, cast: sacredFlame, targets: ['g1'] });
  const saved = burned.log.at(-1)!;
  assert.ok(saved.kind === 'spell' && saved.outcomes[0].save !== null);
});

test('a spell that drops the last foe wins the fight', () => {
  const s = heroFirst([hero('bryn'), goblin('g1', { hp: 1 })]);
  const won = act(s, { kind: 'spell', caster, cast: fireBolt, targets: ['g1'], natural: 19 });
  assert.equal(won.outcome, 'victory');
});

test('the side that loses everyone loses: victory when the foes are dead', () => {
  const s = heroFirst([hero('bryn', { attacks: deadly }), goblin('g1')]);
  const won = act(s, { kind: 'attack', attack: 'Doom', target: 'g1', natural: 10 });
  assert.equal(won.outcome, 'victory');
  assert.equal(xpEarned(won), 50);
  assert.deepEqual(won.log.map((e) => e.kind), [...s.log.map((e) => e.kind), 'move', 'attack'], 'the hero steps in, then the blow; nothing happens after the end');
  assert.equal(xpEarned({ ...won, combatants: { ...won.combatants, g2: goblin('g2') } }), 50, 'only defeated foes count');
  assert.throws(() => act(won, { kind: 'dodge' }), /the combat is over/);
});

test('defeat when no hero is still up; a dying hero rolls a death save at the start of its turn', () => {
  const s = heroFirst([hero('bryn', { attacks: harmless }), hero('ash', { attacks: harmless }), goblin('g1', { attacks: deadly })]);
  let state = s;
  for (let i = 0; i < 12 && state.outcome === 'ongoing'; i++) state = act(state, monsterAction(state) ?? { kind: 'dodge' });
  assert.equal(state.outcome, 'defeat');
  assert.ok(Object.values(state.combatants).filter((c) => c.side === 'party').every((c) => c.status !== 'up'));
});

test('a dying hero’s turn is a death save, logged, and then the next combatant acts', () => {
  const dying = hero('ash', { hp: 0, status: 'dying', conditions: ['unconscious'] });
  const s = startCombat(5, [hero('bryn'), dying, goblin('g1', { attacks: harmless })]);
  const next = playRound(s, {});
  assert.ok(next.log.some((e) => e.kind === 'deathSave' && e.actor === 'ash'));
  assert.notEqual(currentActor(next), 'ash');
});

test('dodging gives attackers disadvantage until the dodger’s next turn', () => {
  const s = heroFirst([hero('bryn'), goblin('g1')]);
  const dodged = act(s, { kind: 'dodge' });
  assert.deepEqual(dodged.dodging, ['bryn']);
  const attacked = act(dodged, monsterAction(dodged)!);
  const event = attacked.log.find((e) => e.kind === 'attack')!;
  assert.equal(event.kind === 'attack' && event.result.roll.rolls.length, 2);
  assert.deepEqual(attacked.dodging, [], 'it ends when bryn’s turn comes round again');
});

test('a monster attacks the up hero with the fewest hit points', () => {
  const s = startCombat(3, [hero('bryn', { hp: 9 }), hero('ash', { hp: 4 }), hero('cy', { hp: 0, status: 'stable' }), goblin('g1')]);
  assert.deepEqual(monsterAction({ ...s, turn: s.order.indexOf('g1') }), { kind: 'attack', attack: 'Scimitar', target: 'ash' });
  const tied = startCombat(3, [hero('bryn', { hp: 4 }), hero('ash', { hp: 4 }), goblin('g1', { attacks: [monster('goblin-warrior').attacks[1]] })]);
  assert.deepEqual(monsterAction({ ...tied, turn: tied.order.indexOf('g1') }), { kind: 'attack', attack: 'Shortbow', target: 'bryn' }, 'a tie goes to the first; a ranged-only monster shoots');
});

test('only the current, able combatant acts, and only against the other side', () => {
  const s = heroFirst([hero('bryn'), hero('ash'), goblin('g1')]);
  assert.throws(() => act(s, { kind: 'attack', attack: 'Unarmed Strike', target: 'ash' }), /bryn will not attack an ally/);
  assert.throws(() => act(s, { kind: 'attack', attack: 'Unarmed Strike', target: 'nobody' }), /there is no combatant nobody/);
});

test('a combatant who cannot act loses its turn, and a fight where no one can act stops instead of hanging', () => {
  const stunned = { conditions: ['stunned' as const] };
  const s = startCombat(2, [hero('bryn', stunned), goblin('g1', stunned)]);
  assert.equal(s.log.filter((e) => e.kind === 'skip').length, 6, 'three rounds of skips for two combatants');
  assert.equal(s.outcome, 'ongoing');
});

test('a round plays every turn: heroes by their votes (Dodge without one), monsters by their own rules', () => {
  const s = startCombat(11, [hero('bryn'), hero('ash'), goblin('g1', { attacks: harmless }), goblin('g2', { attacks: harmless })]);
  const after = playRound(s, { bryn: { kind: 'attack', attack: 'Unarmed Strike', target: 'g1', natural: 15 } });
  assert.equal(after.round, 2);
  assert.ok(after.log.some((e) => e.kind === 'attack' && e.actor === 'bryn'));
  assert.ok(after.log.some((e) => e.kind === 'dodge' && e.actor === 'ash'));
  assert.equal(after.log.filter((e) => e.kind === 'attack' && e.actor.startsWith('g')).length, 2);
});

test('a stored combat resumes exactly: same seed and same choices, same fight', () => {
  const start = () => startCombat(21, [hero('bryn'), goblin('g1'), goblin('g2')]);
  const votes = { bryn: { kind: 'attack', attack: 'Unarmed Strike', target: 'g1', natural: 12 } } as const;
  const direct = playRound(playRound(start(), votes), votes);
  const stored = JSON.parse(JSON.stringify(playRound(start(), votes)));
  assert.deepEqual(playRound(stored, votes), direct);
});

test('a reaction attack (an Opportunity Attack) strikes outside the turn order and can end the fight', () => {
  const s = startCombat(3, [hero('h1', { attacks: deadly }), goblin('g1')]);
  const struck = reactionAttack(s, 'h1', 'Doom', 'g1');
  assert.deepEqual([struck.turn, struck.round, struck.order], [s.turn, s.round, s.order], 'nobody\'s turn is used');
  assert.equal(struck.combatants.g1.status, 'dead');
  assert.equal(struck.outcome, 'victory');
  assert.deepEqual(struck.log.slice(s.log.length).map((e) => [e.kind, e.actor, e.kind === 'attack' && e.reaction]), [['attack', 'h1', true]]);
  assert.notEqual(struck.rng, s.rng, 'the dice move on');
});

test('a potion drunk as a Bonus Action heals the one whose turn it is, and the turn goes on', () => {
  const s = startCombat(3, [hero('h1'), goblin('g1')]);
  const me = currentActor(s);
  const hurt = { ...s, combatants: { ...s.combatants, [me]: { ...s.combatants[me], hp: 1 } } };
  const after = drinkPotion(hurt, 'potion-of-healing', '1d1+3');
  assert.equal(after.combatants[me].hp, Math.min(5, s.combatants[me].maxHp));
  assert.deepEqual(after.log.at(-1), { kind: 'potion', round: s.round, actor: me, item: 'potion-of-healing', healed: after.combatants[me].hp - 1 });
  assert.deepEqual([currentActor(after), after.turn], [me, s.turn], 'still their turn');
  assert.notEqual(drinkPotion(hurt, 'potion-of-healing', '2d4+2').rng, s.rng, 'the dice move on');
});

test('Multiattack: a monster makes all its attacks in its turn, each further one at the most wounded hero still up', () => {
  const bear = (o: Partial<Combatant> = {}): Combatant => ({ ...monsterCombatant('ob', monster('owlbear')), ...o });
  const s = startCombat(3, [hero('bryn', { hp: 9 }), hero('ash', { hp: 4 }), bear()]);
  const turn = { ...s, turn: s.order.indexOf('ob') };
  assert.deepEqual(monsterAction(turn), { kind: 'attack', attack: 'Rend', target: 'ash', then: ['Rend'] });
  const killer = [{ name: 'Rend', bonus: 30, ranged: false, damage: [{ dice: '200', type: 'slashing' }] }];
  const done = act({ ...turn, combatants: { ...turn.combatants, ob: { ...turn.combatants.ob, attacks: killer } } }, monsterAction(turn)!);
  const strikes = done.log.filter((e) => e.kind === 'attack' && e.actor === 'ob').map((e) => e.kind === 'attack' && e.result.target);
  assert.deepEqual(strikes, ['ash', 'bryn'], 'the second Rend goes to the next hero up');
  const alone = startCombat(3, [hero('ash', { hp: 4 }), bear({ attacks: killer })]);
  const once = act({ ...alone, turn: alone.order.indexOf('ob') }, monsterAction({ ...alone, turn: alone.order.indexOf('ob') })!);
  assert.equal(once.log.filter((e) => e.kind === 'attack').length, 1, 'nobody left up: no more attacks');
  assert.equal(monsterCombatant('g', monster('goblin-warrior')).multiattack, undefined);
});

test('Extra Attack: a hero adds one attack; a Fighter two or three at levels 11 and 20', () => {
  assert.equal(extraAttacks({ ...SAMPLE, features: [] }), 0);
  assert.equal(extraAttacks({ ...SAMPLE, features: ['Extra Attack'] }), 1);
  assert.equal(extraAttacks({ ...SAMPLE, features: ['Extra Attack', 'Two Extra Attacks'] }), 2);
  assert.equal(extraAttacks({ ...SAMPLE, features: ['Extra Attack', 'Two Extra Attacks', 'Three Extra Attacks'] }), 3);
});

const wolf = (o: Partial<Combatant> = {}): Combatant => ({ ...monsterCombatant('ww', monster('winter-wolf')), ...o });
const onTurn = (s: CombatState, id: string): CombatState => ({ ...s, turn: s.order.indexOf(id) });

test('a monster with a ready power uses it: the most wounded heroes up its area catches; then it is spent', () => {
  const s = onTurn(startCombat(3, [hero('bryn', { hp: 30 }), hero('ash', { hp: 20 }), hero('cy', { hp: 25 }), hero('di', { hp: 0, status: 'stable' }), wolf()]), 'ww');
  assert.deepEqual(monsterAction(s), { kind: 'power', power: 'Cold Breath', targets: ['ash', 'cy', 'bryn'] }, 'a 15-foot cone, after stepping in, catches every hero near');
  const done = act(s, monsterAction(s)!);
  const e = done.log.find((x) => x.kind === 'power')!;
  assert.ok(e.kind === 'power');
  assert.deepEqual(e.outcomes.map((o) => o.target), ['ash', 'cy', 'bryn']);
  for (const o of e.outcomes) assert.equal(done.combatants[o.target].hp, s.combatants[o.target].hp - o.damage);
  assert.equal(done.combatants.ww.spent!['Cold Breath'], 1);
  const again = onTurn({ ...done, combatants: { ...done.combatants, ww: { ...done.combatants.ww, spent: { 'Cold Breath': 1 } } } }, 'ww');
  assert.equal(monsterAction(again)!.kind, 'attack', 'spent: it bites');
});

test('a power: one damage roll for all; a failure takes it all, a success half (or none), after defenses', () => {
  const sure = (o: Partial<Combatant>) => hero('x', { hp: 90, maxHp: 90, saveBonuses: { ...hero('x').saveBonuses, con: 50 }, ...o });
  const sorry = (o: Partial<Combatant>) => hero('y', { hp: 90, maxHp: 90, saveBonuses: { ...hero('y').saveBonuses, con: -50 }, ...o });
  const s = onTurn(startCombat(4, [sure({}), sorry({}), wolf()]), 'ww');
  const done = act(s, { kind: 'power', power: 'Cold Breath', targets: ['x', 'y'] });
  const e = done.log.find((x) => x.kind === 'power')!;
  assert.ok(e.kind === 'power');
  const [saved, failed] = e.outcomes;
  assert.deepEqual([saved.success, failed.success], [true, false]);
  assert.equal(saved.damage, Math.floor(failed.damage / 2));
  assert.ok(failed.damage >= 4);
  const warm = act(onTurn(startCombat(4, [sorry({ resistances: ['cold'] }), wolf()]), 'ww'), { kind: 'power', power: 'Cold Breath', targets: ['y'] });
  const w = warm.log.find((x) => x.kind === 'power')!;
  assert.ok(w.kind === 'power' && w.outcomes[0].damage < failed.damage, 'resistance halves it');
  const spider = monsterCombatant('sp', monster('giant-spider'));
  const webbed = act(onTurn(startCombat(4, [sure({ saveBonuses: { ...hero('x').saveBonuses, dex: 50 } }), sorry({ saveBonuses: { ...hero('y').saveBonuses, dex: -50 } }), spider]), 'sp'), { kind: 'power', power: 'Web', targets: ['x', 'y'] });
  const web = webbed.log.find((x) => x.kind === 'power')!;
  assert.ok(web.kind === 'power');
  assert.deepEqual(web.outcomes.map((o) => [o.success, o.damage, o.condition]), [[true, 0, null], [false, 0, 'restrained']]);
  assert.deepEqual(webbed.combatants.y.conditions, ['restrained']);
  const immune = act(onTurn(startCombat(4, [sorry({ saveBonuses: { ...hero('y').saveBonuses, dex: -50 }, conditionImmunities: ['restrained'] }), spider]), 'sp'), { kind: 'power', power: 'Web', targets: ['y'] });
  const im = immune.log.find((x) => x.kind === 'power')!;
  assert.ok(im.kind === 'power' && im.outcomes[0].condition === null, 'immune: nothing');
});

test('a spent power recharges on its d6 at the start of the monster turn; a power a day runs out; at will only without attacks', () => {
  let seen = false;
  for (let seed = 0; seed < 40 && !seen; seed++) {
    const s = startCombat(seed, [hero('bryn', { attacks: harmless, hp: 500, maxHp: 500 }), wolf({ spent: { 'Cold Breath': 1 }, attacks: harmless })]);
    const later = playRound(playRound(s, {}), {});
    const r = later.log.find((e) => e.kind === 'recharge');
    if (r && r.kind === 'recharge') { seen = true; assert.ok(r.roll >= 5); assert.equal(r.power, 'Cold Breath'); }
  }
  assert.ok(seen, 'some seed recharges it');
  const dretch = (spent: number) => onTurn(startCombat(2, [hero('bryn'), { ...monsterCombatant('d', monster('dretch')), spent: { 'Fetid Cloud': spent } }]), 'd');
  assert.equal(monsterAction(dretch(0))!.kind, 'power');
  assert.equal(monsterAction(dretch(1))!.kind, 'attack', 'once a day, used');
  const glad = monsterCombatant('g', monster('gladiator'));
  assert.equal(monsterAction(onTurn(startCombat(2, [hero('bryn'), glad]), 'g'))!.kind, 'attack', 'at will, but it has attacks');
  assert.deepEqual(monsterAction(onTurn(startCombat(2, [hero('bryn'), { ...glad, attacks: [] }]), 'g')), { kind: 'power', power: 'Shield Bash', targets: ['bryn'] });
});

test('a hit with a rider: the target saves or takes the condition; no save means it takes it; a miss, or immunity, nothing', () => {
  const ghoul = monsterCombatant('gh', monster('ghoul'));
  const sure = { ...ghoul, attacks: ghoul.attacks.map((a) => ({ ...a, bonus: 50 })) };
  const weak = hero('bryn', { hp: 90, maxHp: 90, saveBonuses: { ...hero('bryn').saveBonuses, con: -50 } });
  const s = onTurn(startCombat(5, [weak, sure]), 'gh');
  const clawed = act(s, { kind: 'attack', attack: 'Claw', target: 'bryn', natural: 15 });
  const e = clawed.log.find((x) => x.kind === 'attack')!;
  assert.ok(e.kind === 'attack');
  assert.deepEqual({ ...e.rider!, roll: null }, { dc: 10, ability: 'con', roll: null, success: false, condition: 'paralyzed' });
  assert.ok(e.rider!.roll !== null);
  assert.deepEqual(clawed.combatants.bryn.conditions, ['paralyzed']);
  const tough = act(onTurn(startCombat(5, [{ ...weak, saveBonuses: { ...weak.saveBonuses, con: 50 } }, sure]), 'gh'), { kind: 'attack', attack: 'Claw', target: 'bryn', natural: 15 });
  const t = tough.log.find((x) => x.kind === 'attack')!;
  assert.ok(t.kind === 'attack' && t.rider!.success && t.rider!.condition === null);
  assert.deepEqual(tough.combatants.bryn.conditions, []);
  const missed = act(s, { kind: 'attack', attack: 'Claw', target: 'bryn', natural: 1 });
  const m = missed.log.find((x) => x.kind === 'attack')!;
  assert.ok(m.kind === 'attack' && m.rider === undefined);
  const toad = monsterCombatant('td', monster('giant-toad'));
  const gulp = act(onTurn(startCombat(5, [weak, { ...toad, attacks: toad.attacks.map((a) => ({ ...a, bonus: 50 })) }]), 'td'), { kind: 'attack', attack: 'Bite', target: 'bryn', natural: 15 });
  const g = gulp.log.find((x) => x.kind === 'attack')!;
  assert.ok(g.kind === 'attack');
  assert.deepEqual(g.rider, { dc: 12, ability: 'str', roll: null, success: false, condition: 'grappled' });
  const free = act(onTurn(startCombat(5, [{ ...weak, conditionImmunities: ['paralyzed'] }, sure]), 'gh'), { kind: 'attack', attack: 'Claw', target: 'bryn', natural: 15 });
  const f = free.log.find((x) => x.kind === 'attack')!;
  assert.ok(f.kind === 'attack' && f.rider!.condition === null && !f.rider!.success);
  const slain = act(onTurn(startCombat(5, [{ ...weak, hp: 1, maxHp: 1 }, sure]), 'gh'), { kind: 'attack', attack: 'Claw', target: 'bryn', natural: 15 });
  const sl = slain.log.find((x) => x.kind === 'attack')!;
  assert.ok(sl.kind === 'attack' && sl.rider === undefined, 'the dead take no condition');
});

test('a monster spares a hero who Dodges when another is up, however wounded; with no other, it attacks anyway', () => {
  const s = startCombat(3, [hero('bryn', { hp: 9 }), hero('ash', { hp: 4 }), goblin('g1')]);
  assert.equal((monsterAction({ ...s, dodging: ['ash'], turn: s.order.indexOf('g1') }) as { target: string }).target, 'bryn');
  assert.equal((monsterAction({ ...s, dodging: ['ash', 'bryn'], turn: s.order.indexOf('g1') }) as { target: string }).target, 'ash');
  assert.equal(monsterCombatant('b', monster('bugbear-warrior')).disengages, undefined);
  assert.equal(goblin('g').disengages, true);
});

test('a monster with no attack and no power Dodges on its turn, using its own action if it has one (SRD 5.2: Shriek, Bubble Dash)', () => {
  const hero = heroCombatant('p1', SAMPLE);
  const turnOf = (id: string) => {
    const s = startCombat(1, [hero, monsterCombatant('m', monster(id))]);
    return monsterAction({ ...s, turn: s.order.indexOf('m') });
  };
  assert.deepEqual(turnOf('shrieker-fungus'), { kind: 'dodge', as: 'Shriek' });
  assert.deepEqual(turnOf('seahorse'), { kind: 'dodge', as: 'Bubble Dash' });
  assert.deepEqual(turnOf('vampire-mist'), { kind: 'dodge' });
  const s = startCombat(1, [hero, monsterCombatant('m', monster('shrieker-fungus'))]);
  const after = act({ ...s, turn: s.order.indexOf('m') }, { kind: 'dodge', as: 'Shriek' });
  assert.ok(after.dodging.includes('m'));
  assert.deepEqual(after.log.at(-1), { kind: 'dodge', round: s.round, actor: 'm', as: 'Shriek' });
});

test('a vote at a foe that fell earlier in the round lands on a living foe instead of throwing (q-mwx1ub52)', () => {
  const fighter = (id: string) => heroCombatant(id, heroSheet({ id, name: id, race: 'human', characterClass: 'fighter' }));
  const rat = { ...monsterCombatant('rat', monster('rat')), hp: 1 };
  const strike = (id: string) => ({ kind: 'attack' as const, attack: fighter(id).attacks[0].name, target: 'rat', natural: 19 });
  const after = playRound(startCombat(1, [fighter('h1'), fighter('h2'), rat, monsterCombatant('gob', monster('goblin-warrior'))]), { h1: strike('h1'), h2: strike('h2') });
  const heroAttacks = after.log.flatMap((e) => (e.kind === 'attack' && e.actor.startsWith('h') ? [e.result.target] : []));
  assert.deepEqual(heroAttacks, ['rat', 'gob'], 'the first drops the rat; the second hero\u2019s attack lands on the goblin');
  assert.equal(after.combatants.rat.status, 'dead');
});

test('a spell vote at fallen foes goes to the most wounded living foe: every beam, but an area catches each foe once', () => {
  const s = heroFirst([hero('bryn'), goblin('g1', { hp: 0, status: 'dead' }), goblin('g2', { hp: 3, attacks: harmless }), goblin('g3', { attacks: harmless })]);
  const spellAt = (st: CombatState) => st.log.flatMap((e) => (e.kind === 'spell' ? e.outcomes.map((o) => o.target) : []));
  const blast = { ...fireBolt, spellId: 'eldritch-blast', beams: 2 };
  assert.deepEqual(aimAgain(s, 'bryn', { kind: 'spell', caster, cast: blast, targets: ['g1', 'g1'], natural: 2 }), { kind: 'spell', caster, cast: blast, targets: ['g2', 'g2'], natural: 2 });
  assert.deepEqual(aimAgain(s, 'bryn', { kind: 'spell', caster, cast: sacredFlame, targets: ['g1', 'g2'] }), { kind: 'spell', caster, cast: sacredFlame, targets: ['g2'] });
  assert.deepEqual(spellAt(playRound(s, { bryn: { kind: 'spell', caster, cast: fireBolt, targets: ['g1'], natural: 2 } })), ['g2']);
});

test('a vote at a living foe, or not at a foe, stands; with no foe left it becomes a Dodge', () => {
  const s = heroFirst([hero('bryn'), hero('ash', { hp: 0, status: 'dying' }), goblin('g1', { hp: 0, status: 'dead' }), goblin('g2')]);
  const atG2 = { kind: 'attack' as const, attack: 'Unarmed Strike', target: 'g2', natural: 12 };
  assert.equal(aimAgain(s, 'bryn', atG2), atG2);
  const heal = { kind: 'spell' as const, caster, cast: { ...fireBolt, damageDice: null, healingDice: '1d8' }, targets: ['ash'] };
  assert.equal(aimAgain(s, 'bryn', heal), heal, 'a heal at a dying friend is not redirected');
  const none = { ...s, combatants: { ...s.combatants, g2: { ...s.combatants.g2, hp: 0, status: 'dead' as const } } };
  assert.deepEqual(aimAgain(none, 'bryn', { ...atG2, target: 'g1' }), { kind: 'dodge' });
  assert.deepEqual(aimAgain(none, 'bryn', { kind: 'spell', caster, cast: fireBolt, targets: ['g1'] }), { kind: 'dodge' });
  assert.deepEqual(aimAgain(none, 'bryn', { kind: 'dodge' }), { kind: 'dodge' });
});

test('Magic Missile at a foe that drops goes on to the other foes in the fight; the slain one is dead, not dying (q-mwxx6wwz)', () => {
  const missile = { spellId: 'magic-missile', slotLevel: 1, damageDice: '1d4+1', beams: 3, healingDice: null, endedConcentration: null };
  const s = heroFirst([hero('bryn'), goblin('g1', { hp: 2, attacks: harmless }), goblin('g2', { attacks: harmless })]);
  const after = act(s, { kind: 'spell', caster, cast: missile, targets: ['g1', 'g1', 'g1'] });
  const event = after.log.find((e) => e.kind === 'spell')!;
  assert.deepEqual(event.kind === 'spell' && event.outcomes.map((o) => o.target), ['g1', 'g2', 'g2']);
  assert.deepEqual([after.combatants.g1.status, after.combatants.g1.deathSaves.failures], ['dead', 0]);
  assert.ok(!after.log.some((e) => e.kind === 'deathSave'));
});

test('a foe left dying by the old rule makes no death save: on its turn it is dead, and the fight is won', () => {
  const s = heroFirst([hero('bryn'), goblin('g1', { hp: 0, status: 'dying', conditions: ['unconscious'] })]);
  const after = act(s, { kind: 'dodge' });
  assert.equal(after.combatants.g1.status, 'dead');
  assert.equal(after.outcome, 'victory');
  assert.ok(!after.log.some((e) => e.kind === 'deathSave'));
});
