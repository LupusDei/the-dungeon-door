/**
 * Telling one kind of AI failure from the rest: the account that pays for the dungeon master and the
 * portraits has run out of credit. The AI Gateway answers every request with 402 and
 * `"type": "insufficient_funds"` until the owner tops it up, so asking again cannot help, and the
 * table should be told that instead of being invited to try again.
 */

const SIGNS = [/insufficient_funds/i, /positive credit balance/i, /payment required/i];

/** True when `error`, or anything it wraps (`cause`, the AI SDK's `lastError` and `errors`), is the gateway saying the account is out of credit. */
export function outOfCredit(error: unknown, depth = 0): boolean {
  if (error === null || error === undefined || depth > 6) return false;
  if (typeof error === 'string') return SIGNS.some((sign) => sign.test(error));
  if (typeof error !== 'object') return false;
  const e = error as { statusCode?: unknown; status?: unknown; message?: unknown; responseBody?: unknown; type?: unknown;
    cause?: unknown; lastError?: unknown; errors?: unknown };
  if (e.statusCode === 402 || e.status === 402 || e.type === 'insufficient_funds') return true;
  if ([e.message, e.responseBody].some((text) => typeof text === 'string' && SIGNS.some((sign) => sign.test(text)))) return true;
  const wrapped = [e.cause, e.lastError, ...(Array.isArray(e.errors) ? e.errors : [])];
  return wrapped.some((inner) => outOfCredit(inner, depth + 1));
}

/** What a player is told when the account is out of credit. */
export const OUT_OF_CREDIT = "The game's AI account has run out of credit. Its owner needs to top it up before the dungeon master can speak or paint.";
