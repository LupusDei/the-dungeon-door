/**
 * Seeded randomness. The rules engine never calls Math.random: every roll comes from an Rng the caller
 * owns, so the same seed and the same choices always give the same result, and a stored game can resume
 * its dice exactly. See docs/rules-design.md, "Randomness".
 */

export interface Rng {
  /** A whole number from 1 to `sides`, inclusive. */
  die(sides: number): number;
  /** What to store. `seededRng(state)` continues exactly where this rng is now. */
  state(): number;
}

/** mulberry32: a whole generator in one uint32, so its state fits in a JSON number. */
export function seededRng(seed: number): Rng {
  let s = seed >>> 0;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { die: (sides) => 1 + Math.floor(next() * sides), state: () => s };
}

/** Replays the given faces in order: for tests, and for dice already rolled (a player's vote d20). */
export function scriptedRng(faces: readonly number[]): Rng {
  let used = 0;
  return {
    die(sides) {
      if (used >= faces.length) throw new Error('out of scripted dice');
      const face = faces[used++];
      if (face < 1 || face > sides) throw new Error(`${face} is not a face of a d${sides}`);
      return face;
    },
    state: () => used,
  };
}

/** One element of a non-empty list, chosen by the rng. */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[rng.die(items.length) - 1];
}

/** `n` different elements, chosen by the rng in turn from what is left. */
export function sample<T>(rng: Rng, items: readonly T[], n: number): T[] {
  const left = [...items];
  return Array.from({ length: n }, () => left.splice(rng.die(left.length) - 1, 1)[0]);
}

/**
 * An rng for one named thing inside a seeded whole (a dungeon area): FNV-1a of `seed/key` seeds it, so its
 * dice depend only on the seed and the key, never on what was rolled before.
 */
export function derivedRng(seed: number, key: string): Rng {
  let hash = 0x811c9dc5;
  for (const ch of `${seed}/${key}`) hash = Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return seededRng(hash);
}
