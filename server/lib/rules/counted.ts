/** "1 hour", "2 hours", "1.5 hours": a count with its unit, singular for exactly one. */
export const counted = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
