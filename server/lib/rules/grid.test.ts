import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Combatant, heroCombatant, monsterCombatant } from './combatant.ts';
import { monster } from './monsters.ts';
import { heroSheet } from '../characters.ts';
import { RuleViolation } from './violation.ts';
import {
  type Battlefield, closestApproach, derivePlace, feetBetween, leavesReach, meleeReach, openingSquares, pathFeet,
  reachableSquares, roomBattlefield, roadBattlefield, squareForBand, squaresMatchingPlaces, stepIntoReach, syncPlaces,
} from './grid.ts';

const fighter = heroSheet({ id: 'f', name: 'Bryn', race: 'human', characterClass: 'fighter' });
const person = (id: string, side: Combatant['side'], square: { x: number; y: number }, over: Partial<Combatant> = {}): Combatant => {
  const base = side === 'party' ? heroCombatant(id, { ...fighter, name: id }) : monsterCombatant(id, monster('goblin-warrior'));
  return { ...base, name: id, side, square, speed: base.speed ?? 30, ...over };
};

const violation = (message: RegExp) => (e: unknown) => e instanceof RuleViolation && message.test(e.message);

test('distance is 5 feet times the Chebyshev distance, diagonal included', () => {
  assert.equal(feetBetween({ x: 0, y: 0 }, { x: 0, y: 0 }), 0);
  assert.equal(feetBetween({ x: 0, y: 3 }, { x: 6, y: 0 }), 30);
  assert.equal(feetBetween({ x: 0, y: 0 }, { x: 1, y: 1 }), 5, 'a diagonal is one square');
  assert.equal(feetBetween({ x: 0, y: 3 }, { x: 12, y: 0 }), 60);
});

test('a room starts the sides 30 feet apart, a road 60, and surprise puts them in reach', () => {
  const tokens = [
    { id: 'bryn', side: 'party' as const, status: 'up' },
    { id: 'ash', side: 'party' as const, status: 'stable' },
    { id: 'g1', side: 'foes' as const, status: 'up' },
  ];
  const room = openingSquares(tokens);
  assert.deepEqual([room.battlefield.width, room.battlefield.height, room.battlefield.squareFeet], [10, 8, 5]);
  assert.equal(room.battlefield.walls.length, 0);
  assert.equal(feetBetween(room.squares.bryn, room.squares.g1), 30);
  assert.equal(feetBetween(room.squares.ash, room.squares.g1), 30);
  assert.equal(room.squares.bryn.x, 0, 'heroes stand on the west edge');

  const road = openingSquares(tokens.filter((t) => t.status === 'up'), { far: true });
  assert.deepEqual([road.battlefield.width, road.battlefield.height], [16, 6]);
  assert.equal(feetBetween(road.squares.bryn, road.squares.g1), 60);

  const sprung = openingSquares(tokens, { surprise: true });
  assert.equal(feetBetween(sprung.squares.bryn, sprung.squares.g1), 5);
  const back = feetBetween(sprung.squares.ash, sprung.squares.g1);
  assert.ok(back > 10 && back <= 30, `a hero who is down stays near, not in the melee (${back})`);
});

test('bands are read off the squares: reach engages, 30 is near, beyond is far', () => {
  const bryn = person('bryn', 'party', { x: 0, y: 3 });
  const goblin = person('g1', 'foes', { x: 6, y: 0 });
  const all = { bryn, g1: goblin };
  assert.deepEqual(derivePlace(bryn, all), { band: 'near', with: [] });
  const beside = syncPlaces({ ...all, bryn: { ...bryn, square: { x: 5, y: 0 } } });
  assert.deepEqual(beside.bryn.place, { band: 'engaged', with: ['g1'] });
  assert.deepEqual(beside.g1.place, { band: 'engaged', with: ['bryn'] }, 'engagement is symmetric');
  const away = syncPlaces({ ...all, bryn: { ...bryn, square: { x: 0, y: 7 } } });
  assert.equal(away.bryn.place?.band, 'far');
  assert.equal(away.g1.place?.band, 'far');
  const glaive = person('bryn', 'party', { x: 0, y: 0 }, { attacks: [{ name: 'Glaive', bonus: 5, ranged: false, damage: [], reach: 10 }] });
  const atTen = person('g1', 'foes', { x: 2, y: 0 });
  assert.equal(meleeReach(glaive), 10);
  assert.deepEqual(derivePlace(glaive, { bryn: glaive, g1: atTen }).band, 'engaged');
  assert.equal(feetBetween(glaive.square!, atTen.square!), 10);
});

test('speed, walls and occupied squares bound a move; a diagonal costs 5 feet', () => {
  const open = roomBattlefield();
  const from = { x: 0, y: 0 };
  const one = reachableSquares({ battlefield: open, from, speedFeet: 5, blocked: [], through: [] });
  assert.deepEqual(one, [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]);
  const walled: Battlefield = { ...open, walls: [{ x: 1, y: 0 }] };
  const around = reachableSquares({ battlefield: walled, from, speedFeet: 5, blocked: [], through: [] });
  assert.deepEqual(around.map((s) => `${s.x},${s.y}`), ['0,1', '1,1']);
  assert.equal(pathFeet({ battlefield: walled, from, speedFeet: 30, blocked: [], through: [] }, { x: 1, y: 0 }), null);
  const blocked = reachableSquares({ battlefield: open, from, speedFeet: 10, blocked: [{ x: 1, y: 0 }], through: [{ x: 0, y: 1 }] });
  assert.equal(blocked.some((s) => s.x === 1 && s.y === 0), false, 'an enemy square is not entered');
  assert.equal(blocked.some((s) => s.x === 0 && s.y === 1), false, 'an ally square is not where a move ends');
  assert.equal(blocked.some((s) => s.x === 0 && s.y === 2), true, 'the far side of an ally can be reached');
  assert.equal(reachableSquares({ battlefield: open, from, speedFeet: 0, blocked: [], through: [] }).length, 0);
});

test('a band move lands on a square that reads as that band, and Dash is required only when speed is not enough', () => {
  const laid = openingSquares([{ id: 'bryn', side: 'party', status: 'up' }, { id: 'g1', side: 'foes', status: 'up' }]);
  const all = syncPlaces({
    bryn: person('bryn', 'party', laid.squares.bryn),
    g1: person('g1', 'foes', laid.squares.g1),
  });
  const far = squareForBand('Bryn', laid.battlefield, all.bryn, all, { to: 'far' });
  assert.equal(far.dash, false);
  const gone = syncPlaces({ ...all, bryn: { ...all.bryn, square: far } });
  assert.equal(gone.bryn.place?.band, 'far');
  assert.throws(() => squareForBand('Bryn', laid.battlefield, all.bryn, all, { to: 'near' }), violation(/already near/));
  const engage = squareForBand('Bryn', laid.battlefield, all.bryn, all, { to: 'engaged', engage: ['g1'] });
  assert.equal(engage.dash, false);
  assert.ok(feetBetween(engage, all.g1.square!) <= 5);

  const road = openingSquares([{ id: 'bryn', side: 'party', status: 'up' }, { id: 'g1', side: 'foes', status: 'up' }], { far: true });
  const wide = syncPlaces({
    bryn: person('bryn', 'party', road.squares.bryn),
    g1: person('g1', 'foes', road.squares.g1),
  });
  assert.throws(() => squareForBand('Bryn', road.battlefield, wide.bryn, wide, { to: 'engaged', engage: ['g1'] }), violation(/needs to Dash/));
  const dashed = squareForBand('Bryn', road.battlefield, wide.bryn, wide, { to: 'engaged', engage: ['g1'], dash: true });
  assert.equal(dashed.dash, true);
  assert.ok(feetBetween(dashed, wide.g1.square!) <= 5);
});

test('stepping out of an enemy\'s reach provokes; a reach weapon threatens 10 feet', () => {
  const bryn = person('bryn', 'party', { x: 5, y: 0 });
  const goblin = person('g1', 'foes', { x: 6, y: 0 });
  const all = { bryn, g1: goblin };
  assert.deepEqual(leavesReach(bryn, all, { x: 5, y: 2 }), ['g1']);
  assert.deepEqual(leavesReach(bryn, all, { x: 5, y: 1 }), [], 'still in reach: no opportunity attack');
  const pike = person('g1', 'foes', { x: 6, y: 0 }, { attacks: [{ name: 'Pike', bonus: 4, ranged: false, damage: [], reach: 10 }] });
  const back = person('bryn', 'party', { x: 4, y: 0 });
  assert.equal(feetBetween(back.square!, pike.square!), 10);
  assert.deepEqual(leavesReach(back, { bryn: back, g1: pike }, { x: 3, y: 0 }), ['g1']);
  assert.deepEqual(leavesReach({ ...back, disengages: true }, { bryn: back, g1: pike }, { x: 3, y: 0 }), ['g1'], 'the flag is the caller\'s; the geometry still leaves');
});

test('a stored fight keeps its bands when it is laid on a grid', () => {
  const tokens = [
    { id: 'bryn', side: 'party' as const, status: 'up', band: 'engaged' as const },
    { id: 'g1', side: 'foes' as const, status: 'up', band: 'engaged' as const },
    { id: 'ash', side: 'party' as const, status: 'up', band: 'near' as const },
  ];
  const laid = squaresMatchingPlaces(tokens);
  assert.equal(feetBetween(laid.squares.bryn, laid.squares.g1), 5);
  const aside = feetBetween(laid.squares.ash, laid.squares.g1);
  assert.ok(aside > 5 && aside <= 30, `the hero who is near stays near (${aside})`);
  const far = squaresMatchingPlaces([
    { id: 'bryn', side: 'party', status: 'up', band: 'far' },
    { id: 'g1', side: 'foes', status: 'up', band: 'far' },
  ]);
  assert.equal(far.battlefield.width, 16);
  assert.equal(feetBetween(far.squares.bryn, far.squares.g1), 60);
});

test('closing in stops at reach, and a step toward a far foe is the nearest square', () => {
  const bryn = person('bryn', 'party', { x: 0, y: 3 }, { speed: 30 });
  const goblin = person('g1', 'foes', { x: 6, y: 0 });
  const all = { bryn, g1: goblin };
  const into = stepIntoReach(roomBattlefield(), bryn, all, goblin.square!, 5, 30);
  assert.ok(into);
  assert.ok(feetBetween(into!, goblin.square!) <= 5);
  const road = roadBattlefield();
  const farHero = person('bryn', 'party', { x: 0, y: 0 }, { speed: 30 });
  const farFoe = person('g1', 'foes', { x: 12, y: 0 });
  const step = closestApproach(road, farHero, { bryn: farHero, g1: farFoe }, farFoe.square!, 30);
  assert.ok(step);
  assert.equal(feetBetween(farHero.square!, step!), 30, 'a move spends the whole speed closing');
  assert.equal(stepIntoReach(road, farHero, { bryn: farHero, g1: farFoe }, farFoe.square!, 5, 30), null, '60 feet is not one move');
});
