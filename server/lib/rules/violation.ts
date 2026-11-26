/** A choice the rules forbid. The message is written for the player; the API turns it into a 400. */
export class RuleViolation extends Error {
  override name = 'RuleViolation';
}

/** Throws a RuleViolation with `message` unless `ok`. */
export function require(ok: boolean, message: string): asserts ok {
  if (!ok) throw new RuleViolation(message);
}
