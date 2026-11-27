import assert from 'node:assert/strict';
import { test } from 'node:test';
import { outOfCredit } from './ai-errors.ts';

test('the gateway out of credit is told from any other failure, however deep it is wrapped', () => {
  // The shape the AI Gateway's 402 arrives in (production, 2026-11-26): a gateway error whose cause is the API call error.
  const call = Object.assign(new Error('{"error":{"message":"A positive credit balance is required for all requests, including BYOK, so fallback providers remain available.","type":"insufficient_funds"}}'), { name: 'AI_APICallError' });
  const gateway = Object.assign(new Error('A positive credit balance is required for all requests, including BYOK, so fallback providers remain available.'), { name: 'GatewayInternalServerError', statusCode: 402, cause: call });
  assert.equal(outOfCredit(gateway), true);
  assert.equal(outOfCredit(call), true);
  assert.equal(outOfCredit({ statusCode: 402 }), true);
  // The AI SDK's retry wrapper keeps what it gave up on in lastError and errors.
  assert.equal(outOfCredit(Object.assign(new Error('Failed after 3 attempts'), { lastError: gateway, errors: [gateway] })), true);
  assert.equal(outOfCredit(new Error('wrapped', { cause: new Error('again', { cause: call }) })), true);

  assert.equal(outOfCredit(new Error('boom')), false);
  assert.equal(outOfCredit(Object.assign(new Error('rate limited'), { statusCode: 429 })), false);
  assert.equal(outOfCredit(Object.assign(new Error('The model is overloaded'), { statusCode: 503 })), false);
  assert.equal(outOfCredit(null), false);
  assert.equal(outOfCredit(undefined), false);
  const loop: { cause?: unknown } = {};
  loop.cause = loop;
  assert.equal(outOfCredit(loop), false, 'a cause that points at itself ends');
});
