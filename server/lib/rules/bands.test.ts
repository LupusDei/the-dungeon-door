import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Combatant, heroCombatant, monsterCombatant } from './combatant.ts';
import { monster } from './monsters.ts';
import { heroSheet } from '../characters.ts';
import { RuleViolation } from './violation.ts';
import {
  type Band, BAND_FEET, bandSteps, distanceFeet, legalMoves, type Move, neededApproach, openingPlaces, parseMove, placesAfter,
  provokedBy, stepsToEngage, validateMove,
} from './bands.ts';

const fighter = heroSheet({ id: 'f', name: 'Bryn', race: 'human', characterClass: 'fighter' });
const person = (id: string, side: Combatant['side'], place: { band: Band; with: string[] }, over: Partial<Combatant> = {}): Combatant => {
  const base = side === 'party' ? heroCombatant(id, { ...fighter, name: id }) : monsterCombatant(id, monster('goblin-warrior'));
  return { ...base, name: id, side, place, ...over };
};

const field = (...cs: Combatant[]) => ({ round: 1, combatants: Object.fromEntries(cs.map((c) => [c.id, c])) });
const near = (id: string, side: Combatant['side'], over?: Partial<Combatant>) => person(id, side, { band: 'near', with: [] }, over);
const at = (id: string, side: Combatant['side'], band: Band, holding: string[] = [], over?: Partial<Combatant>) =>
  person(id, side, { band, with: holding }, over);

const violation = (message: RegExp) => (e: unknown) => e instanceof RuleViolation && message.test(e.message);

test('bands are a line: engaged, near (about 30 ft), far (about 60 ft)', () => {
  assert.deepEqual([bandSteps('engaged', 'near'), bandSteps('near', 'far'), bandSteps('engaged', 'far'), bandSteps('near', 'near')], [1, 1, 2, 0]);
  assert.deepEqual([BAND_FEET.engaged, BAND_FEET.near, BAND_FEET.far], [5, 30, 60]);
  assert.equal(stepsToEngage('near', 'near', false), 1, 'closing with someone near is one move');
  assert.equal(stepsToEngage('far', 'near', false), 2, 'from far into the near melee is a Dash');
  assert.equal(stepsToEngage('engaged', 'far', false), 3, 'out of melee and across to a far foe cannot be done in one turn');
  assert.equal(stepsToEngage('near', 'near', true), 0, 'already in melee');
});

test('distance: melee is 5 ft, otherwise the farther band, and never under a near band apart unless engaged', () => {
  const a = near('a', 'party');
  const b = near('b', 'foes');
  assert.equal(distanceFeet(a, b), 30);
  const melee = placesAfter(field(a, b).combatants, 'a', { to: 'engaged', engage: ['b'] });
  assert.equal(distanceFeet(melee.a, melee.b), 5);
  assert.equal(distanceFeet(at('a', 'party', 'far'), at('b', 'foes', 'near')), 60);
  assert.equal(distanceFeet(at('a', 'party', 'far'), at('b', 'foes', 'far')), 60);
  assert.equal(distanceFeet(at('a', 'party', 'engaged', ['c']), at('b', 'foes', 'engaged', ['d'])), 30, 'two melees are a move apart');
  assert.equal(distanceFeet({ ...a, place: undefined }, b), null, 'a stored fight with no places is not checked');
});

test('a fight starts near, and in melee when one side surprises the other', () => {
  const heroes = [near('bryn', 'party'), near('ash', 'party', { status: 'stable', hp: 0 })];
  const foes = [near('g1', 'foes')];
  assert.deepEqual(openingPlaces([...heroes, ...foes]).bryn, { band: 'near', with: [] });
  const sprung = openingPlaces([...heroes, ...foes], 'foes');
  assert.deepEqual(sprung.bryn, { band: 'engaged', with: ['g1'] });
  assert.deepEqual(sprung.g1, { band: 'engaged', with: ['bryn'] });
  assert.deepEqual(sprung.ash, { band: 'near', with: [] }, 'a hero who is down is not in the melee');
});

test('moving to engaged is symmetric; leaving drops the other back to near when nobody else holds them', () => {
  const start = field(near('bryn', 'party'), near('g1', 'foes'), near('g2', 'foes'));
  const inMelee = placesAfter(start.combatants, 'bryn', { to: 'engaged', engage: ['g1', 'g2'] });
  assert.deepEqual(inMelee.bryn.place, { band: 'engaged', with: ['g1', 'g2'] });
  assert.deepEqual(inMelee.g1.place, { band: 'engaged', with: ['bryn'] });
  const out = placesAfter(inMelee, 'bryn', { to: 'near' });
  assert.deepEqual(out.bryn.place, { band: 'near', with: [] });
  assert.deepEqual(out.g1.place, { band: 'near', with: [] });
});

test('a move is one band, Dash is two, and a move that changes nothing or reaches too far is refused', () => {
  const calm = field(near('bryn', 'party'), near('g1', 'foes'), at('g2', 'foes', 'far'));
  validateMove(calm, 'bryn', { to: 'engaged', engage: ['g1'] });
  validateMove(calm, 'bryn', { to: 'far' });
  validateMove(calm, 'bryn', { to: 'engaged', engage: ['g2'], dash: true });
  assert.throws(() => validateMove(calm, 'bryn', { to: 'near' }), violation(/already near/));
  assert.throws(() => validateMove(calm, 'bryn', { to: 'engaged', engage: ['g2'] }), violation(/needs to Dash/));
  assert.throws(() => validateMove(calm, 'bryn', { to: 'far', dash: true }), violation(/A move is enough/));
  assert.throws(() => validateMove(calm, 'bryn', { to: 'engaged', engage: [] }), violation(/must name who/));
  assert.throws(() => validateMove(calm, 'bryn', { to: 'engaged', engage: ['bryn'] }), violation(/cannot engage/));
  const held = field(at('bryn', 'party', 'engaged', ['g1']), at('g1', 'foes', 'engaged', ['bryn']), at('g2', 'foes', 'far'));
  assert.throws(() => validateMove(held, 'bryn', { to: 'engaged', engage: ['g2'], dash: true }), violation(/cannot get there/));
  assert.throws(() => validateMove(calm, 'bryn', { to: 'far', disengage: true }), violation(/not leaving/));
  validateMove(held, 'bryn', { to: 'near', disengage: true });
});

test('leaving melee provokes from each foe left behind, unless you Disengage or they already spent their reaction', () => {
  const held = field(at('bryn', 'party', 'engaged', ['g1', 'g2']), at('g1', 'foes', 'engaged', ['bryn']), at('g2', 'foes', 'engaged', ['bryn']));
  assert.deepEqual(provokedBy(held, 'bryn', { to: 'near' }).sort(), ['g1', 'g2']);
  assert.deepEqual(provokedBy(held, 'bryn', { to: 'near', disengage: true }), []);
  const nimble = { ...held, combatants: { ...held.combatants, bryn: { ...held.combatants.bryn, disengages: true as const } } };
  assert.deepEqual(provokedBy(nimble, 'bryn', { to: 'near' }), [], 'a goblin Disengages as a Bonus Action');
  const spent = { ...held, reacted: ['g1'] };
  assert.deepEqual(provokedBy(spent, 'bryn', { to: 'near' }), ['g2']);
  const shifting = provokedBy(held, 'bryn', { to: 'engaged', engage: ['g1'] });
  assert.deepEqual(shifting, ['g2'], 'dropping one foe provokes only from that foe');
});

test('a melee attack steps into the cluster one band away; a ranged monster steps out of melee; Dash is not taken for them', () => {
  const calm = field(near('bryn', 'party'), near('g1', 'foes'), near('g2', 'foes'));
  const sword = calm.combatants.bryn.attacks.find((a) => !a.ranged)!;
  assert.deepEqual(neededApproach(calm, calm.combatants.bryn, 'attack', { attack: sword, target: calm.combatants.g1 }), { to: 'engaged', engage: ['g1', 'g2'] });
  const far = field(at('bryn', 'party', 'far'), near('g1', 'foes'));
  assert.equal(neededApproach(far, far.combatants.bryn, 'attack', { attack: sword, target: far.combatants.g1 }), null, 'two bands away is not free with the attack');
  const bow = { ...calm.combatants.g1.attacks.find((a) => a.ranged)!, normal: 80, long: 320 };
  const pinned = field(at('g1', 'foes', 'engaged', ['bryn']), at('bryn', 'party', 'engaged', ['g1']));
  assert.deepEqual(neededApproach(pinned, pinned.combatants.g1, 'attack', { attack: bow, target: pinned.combatants.bryn }), { to: 'near', disengage: true });
  const heroBow = { name: 'Longbow', bonus: 4, ranged: true, damage: [], normal: 150, long: 600 };
  assert.equal(neededApproach(pinned, pinned.combatants.bryn, 'attack', { attack: heroBow, target: pinned.combatants.g1 }), null, 'a hero shoots from where they are');
});

test('a vote move is read off the body, and a bad shape is refused', () => {
  assert.deepEqual(parseMove(undefined), undefined);
  assert.deepEqual(parseMove({ to: 'far', dash: true, disengage: true }), { to: 'far', dash: true, disengage: true });
  assert.deepEqual(parseMove({ to: 'engaged', engage: ['g1'] }), { to: 'engaged', engage: ['g1'] });
  assert.throws(() => parseMove({ to: 'up' }), violation(/engaged/));
  assert.throws(() => parseMove('near'), violation(/move must say where/));
  assert.throws(() => parseMove({ to: 'near', engage: [1] }), violation(/list of ids/));
});

test('the moves a hero can make are the legal ones, ready for a list of actions', () => {
  const calm = field(near('bryn', 'party'), near('g1', 'foes'), at('g2', 'foes', 'far'));
  const moves = legalMoves(calm, 'bryn');
  const has = (m: Move) => moves.some((x) => x.to === m.to && !!x.dash === !!m.dash && !!x.disengage === !!m.disengage && (x.engage ?? []).join() === (m.engage ?? []).join());
  assert.equal(has({ to: 'far' }), true);
  assert.equal(has({ to: 'engaged', engage: ['g1'] }), true);
  assert.equal(has({ to: 'engaged', engage: ['g2'], dash: true }), true);
  assert.equal(has({ to: 'near' }), false, 'already near');
  assert.equal(has({ to: 'engaged', engage: ['g2'] }), false, 'a far foe takes a Dash');
  assert.equal(legalMoves({ ...calm, combatants: { ...calm.combatants, bryn: { ...calm.combatants.bryn, status: 'dying', hp: 0 } } }, 'bryn').length, 0);
});
