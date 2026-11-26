import assert from 'node:assert/strict';
import { test } from 'node:test';
import { monster } from './monsters.ts';
import { lastingOf, powersOf } from './powers.ts';

test('a breath weapon: the save, half on a success, its damage, recharge 5-6 and its area', () => {
  assert.deepEqual(monster('winter-wolf').powers, [{
    name: 'Cold Breath', ability: 'con', dc: 12, half: true, damage: [{ dice: '4d8', type: 'cold' }],
    uses: { kind: 'recharge', min: 5 }, area: { shape: 'Cone', feet: 15 }, lasting: null,
  }]);
  assert.deepEqual(monster('brass-dragon-wyrmling').powers[0].area, { shape: 'Line', feet: 20 }, 'a 20-foot-long, 5-foot-wide Line');
});

test('powers are the actions with a save DC and no attack roll; uses a day; at will', () => {
  assert.deepEqual(monster('ghoul').powers, [], 'the Claw save rides on an attack roll');
  assert.deepEqual(monster('dretch').powers[0].uses, { kind: 'per-day', times: 1 });
  assert.equal(monster('gladiator').powers[0].uses, null);
  assert.equal(monster('giant-spider').powers[0].area, null, 'one target');
  assert.equal(monster('giant-spider').powers[0].half, false);
  assert.deepEqual(powersOf([{ name: 'Stare', desc: 'Wisdom Saving Throw: DC 10, one creature.', dc: { dcType: { index: 'wis' }, dcValue: 10, successType: 'none' } }])[0].damage, []);
});

test('the condition a failed save brings, and how it ends', () => {
  const escape = { kind: 'escape', ability: 'str', skill: 'athletics' };
  assert.deepEqual(lastingOf('Failure: The target has the Grappled condition (escape DC 14).', 'str', 12), { condition: 'grappled', until: { ...escape, dc: 14 } });
  assert.deepEqual(lastingOf('Failure: The target has the Restrained condition until the web is destroyed.', 'dex', 13), { condition: 'restrained', until: { ...escape, dc: 13 } });
  assert.deepEqual(lastingOf('Failure: The target has the Frightened condition. It repeats the save at the end of each of its turns.', 'wis', 11), { condition: 'frightened', until: { kind: 'save', ability: 'wis', dc: 11 } });
  assert.deepEqual(lastingOf('Failure: The target has the Poisoned condition for 1 hour.', 'con', 11), { condition: 'poisoned', until: { kind: 'time', left: 3600 } });
  assert.deepEqual(lastingOf('Failure: The target has the Poisoned condition for 1 minute.', 'con', 11), { condition: 'poisoned', until: { kind: 'time', left: 60 } });
  assert.deepEqual(lastingOf('Failure: The target has the Blinded condition until the end of its next turn.', 'dex', 11), { condition: 'blinded', until: { kind: 'time', left: 6 } });
  assert.deepEqual(lastingOf('Failure: The target has the Prone condition.', 'str', 15), { condition: 'prone', until: { kind: 'time', left: 6 } }, 'it stands on its turn');
  assert.deepEqual(lastingOf('Failure: The target has the Charmed condition.', 'wis', 15), { condition: 'charmed', until: { kind: 'time', left: 60 } }, 'otherwise a minute');
  assert.equal(lastingOf('Failure: The target is pushed 10 feet.', 'str', 15), null);
  assert.equal(lastingOf('Failure: The target has the Cursed condition.', 'str', 15), null, 'not a 5.2 condition');
});
