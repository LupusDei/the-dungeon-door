import assert from 'node:assert/strict';
import { test } from 'node:test';
import { counted } from './counted.ts';

test('a count reads with its unit, singular for exactly one', () => {
  assert.deepEqual([counted(1, 'hour'), counted(2, 'hour'), counted(0, 'minute'), counted(1.5, 'hour')], ['1 hour', '2 hours', '0 minutes', '1.5 hours']);
  assert.deepEqual([counted(1, 'foot', 'feet'), counted(10, 'foot', 'feet')], ['1 foot', '10 feet'], 'an irregular plural');
});
