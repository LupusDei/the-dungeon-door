/**
 * How a game is told (docs/api.md, `telling`): in full, or streamlined. The host picks it as the door
 * opens. A streamlined game is the same game with the same rules and dice, told in a line or two: what
 * happened, and what stands before the party now.
 *
 * The dungeon master is asked to write that briefly (lib/dm/llm.ts). The limits here are the engine's
 * own, applied where the DM's words enter (lib/game.ts), so a wordy reply cannot make a streamlined game
 * wordy. Original to this game; nothing here is a rule of play.
 */
import { badRequest } from './http.ts';

export const TELLING_IDS = ['full', 'streamlined'] as const;
export type Telling = (typeof TELLING_IDS)[number];
export const DEFAULT_TELLING: Telling = 'full';

/** The `telling` of POST …/start. Left out, it is the full story. */
export function tellingOf(value: unknown): Telling {
  if (value === undefined || value === null) return DEFAULT_TELLING;
  if (!TELLING_IDS.includes(value as Telling)) throw badRequest('telling must be "full" or "streamlined"');
  return value as Telling;
}

/** A telling as stored: anything else (a game from before tellings) reads as the full story. */
export const storedTelling = (value: unknown): Telling => (TELLING_IDS.includes(value as Telling) ? value as Telling : DEFAULT_TELLING);

export const isStreamlined = (telling: Telling | null | undefined): boolean => telling === 'streamlined';

/** What a streamlined game may say. Sentences first, then words, so a single long sentence is cut too. */
export const STREAMLINED = {
  /** What stands before the party now. */
  narration: { sentences: 2, words: 40 },
  /** What physically happened. */
  outcome: { sentences: 1, words: 28 },
  /** A choice: a few words, and a clause of risk at most. */
  label: { words: 6 },
  detail: { words: 10 },
} as const;

const words = (text: string): string[] => text.split(/\s+/).filter(Boolean);
export const wordCount = (text: string): number => words(text).length;

/** A question that only hands the moment back. The choices are right under the line, so it says nothing. */
const HANDS_BACK = /^(so[,:]?\s+)?what (do|will|would) you (all )?(do|say)( now| next)?\?+$/i;

/** The text as sentences: a full stop, a question or exclamation mark or an ellipsis ends one, and so does a new line. */
export function sentencesOf(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)/g) ?? [])
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 0);
}

/** The first `limit.sentences` sentences that fit in `limit.words`; a first sentence longer than that is cut at a word. */
export function briefly(text: string, limit: { sentences: number; words: number }): string {
  const kept: string[] = [];
  let count = 0;
  for (const sentence of sentencesOf(text)) {
    if (HANDS_BACK.test(sentence)) continue;
    if (kept.length >= limit.sentences) break;
    const n = wordCount(sentence);
    if (kept.length > 0 && count + n > limit.words) break;
    kept.push(sentence);
    count += n;
  }
  return cutAt(kept.join(' '), limit.words);
}

/** At most `max` words; a cut ends on a word, with an ellipsis in place of what followed. */
export function cutAt(text: string, max: number): string {
  const all = words(text);
  if (all.length <= max) return all.join(' ');
  return `${all.slice(0, max).join(' ').replace(/[\s,;:—–-]+$/, '')}…`;
}

/** A choice's detail in a streamlined game: its first clause, or nothing. */
export function briefDetail(detail: string): string {
  const [first = ''] = sentencesOf(detail);
  const clause = first.split(/[;:—–]|,\s/)[0]?.trim() ?? '';
  const told = clause.length > 0 && !/[.!?…]$/.test(clause) ? `${clause}.` : clause;
  return wordCount(told) > STREAMLINED.detail.words ? cutAt(told, STREAMLINED.detail.words) : told;
}

/** A choice as a streamlined game shows it. */
export function briefChoice<T extends { label: string; detail: string }>(choice: T): T {
  return { ...choice, label: cutAt(choice.label.trim(), STREAMLINED.label.words), detail: briefDetail(choice.detail) };
}

/** What a scene's draft may say: its narration, the outcome it resolves (if any) and the DM's aside. */
export interface Told { narration: string; outcome?: string; quip?: string }

/**
 * A draft held to a streamlined game: two sentences of what stands before the party, one of what happened,
 * and no aside. A narration or outcome that comes out empty keeps `fallback`'s words, so the page is never blank.
 */
export function streamlinedDraft<T extends Told>(draft: T, fallback: { narration: string; outcome: string }): T {
  const narration = briefly(draft.narration, STREAMLINED.narration) || fallback.narration;
  const { quip: _quip, ...rest } = draft;
  if (draft.outcome === undefined) return { ...rest, narration } as T;
  return { ...rest, narration, outcome: briefly(draft.outcome, STREAMLINED.outcome) || fallback.outcome } as T;
}
