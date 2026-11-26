import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Combatant, heroCombatant, monsterCombatant } from './combatant.ts';
import { monster } from './monsters.ts';
import { act, choicesFor, currentActor, monsterAction, orderByInitiative, playRound, reactionAttack, startCombat, xpEarned } from './scene.ts';
import { SAMPLE } from './sheet.fixture.ts';

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
  assert.deepEqual(won.log.map((e) => e.kind), [...s.log.map((e) => e.kind), 'attack'], 'nothing happens after the end');
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
