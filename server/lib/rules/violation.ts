/** A choice the rules forbid. The message is written for the player; the API turns it into a 400. */
export class RuleViolation extends Error {
  override name = 'RuleViolation';
}

/** Throws a RuleViolation with `message` unless `ok`. */
export function require(ok: boolean, message: string): asserts ok {
  if (!ok) throw new RuleViolation(message);
}

/** The entry for `key`, or a RuleViolation saying there is no such `kind`. */
export function lookup<K, T>(table: ReadonlyMap<K, T>, key: K, kind: string): T {
  const found = table.get(key);
  require(found !== undefined, `there is no ${kind} ${key}`);
  return found;
}
