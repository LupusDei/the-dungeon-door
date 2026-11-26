import type { ChatLine } from './dm/types.ts';
import type { Mention, MentionTarget, Message, MessageQuote, MessageVoice } from './types.ts';

/** How long a typing ping stays on the table. The app pings again while the composer is in use. */
export const TYPING_MS = 5000;

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * A single emoji, or null. Skin-tone and variation selectors stay in the one grapheme, so 👍🏻 and ❤️
 * count. Two emoji, or a word, do not.
 */
export function oneEmoji(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > 32) return null;
  const parts = [...segmenter.segment(text)];
  if (parts.length !== 1) return null;
  if (!/\p{Extended_Pictographic}/u.test(text)) return null;
  return text;
}

export function voiceOf(value: unknown): MessageVoice {
  if (value === undefined || value === null || value === 'in') return 'in';
  if (value === 'out') return 'out';
  throw new Error('voice');
}

/** A positive message id, or null when the field was left out. Throws on anything else. */
export function replyIdOf(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new Error('replyTo');
  return value;
}

interface Named {
  playerId: string;
  name: string;
}

/** The longest hero name that the text starts with, and that ends on a boundary (so Bryn isn't Brynn). */
function longestName(text: string, party: Named[]): (Named & { length: number }) | null {
  const lower = text.toLowerCase();
  let best: (Named & { length: number }) | null = null;
  for (const hero of party) {
    const name = hero.name;
    if (!name || !lower.startsWith(name.toLowerCase())) continue;
    const after = text[name.length];
    if (after !== undefined && /[\p{L}\p{N}]/u.test(after)) continue;
    if (!best || name.length > best.length) best = { ...hero, length: name.length };
  }
  return best;
}

/**
 * `@Ilsa` names the hero. `@player:Ilsa` names the player of that hero. Names not at the table stay text.
 * The same person is mentioned at most once for each target.
 */
export function parseMentions(text: string, party: Named[]): Mention[] {
  const found: Mention[] = [];
  const seen = new Set<string>();
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '@' || (i > 0 && /[\p{L}\p{N}]/u.test(text[i - 1]!))) {
      i += 1;
      continue;
    }
    let target: MentionTarget = 'hero';
    let rest = text.slice(i + 1);
    let mark = 1;
    if (rest.toLowerCase().startsWith('player:')) {
      target = 'player';
      rest = rest.slice('player:'.length);
      mark += 'player:'.length;
    }
    const hit = longestName(rest, party);
    if (!hit) {
      i += 1;
      continue;
    }
    const key = `${target}:${hit.playerId}`;
    if (!seen.has(key)) {
      seen.add(key);
      found.push({ playerId: hit.playerId, name: hit.name, target });
    }
    i += mark + hit.length;
  }
  return found;
}

export function quoteOf(message: Message): MessageQuote {
  return {
    id: message.id,
    kind: message.kind,
    playerId: message.playerId,
    characterName: message.characterName,
    text: message.text,
    voice: message.voice,
  };
}

/**
 * A line the dungeon master can read. System lines are dropped. `voice` is "in" or "out" for a player's
 * line and null for the DM's own quip, so in-character speech is visible in the data.
 */
export function chatLine(message: Message): ChatLine | null {
  if (message.kind === 'system') return null;
  if (message.kind !== 'chat' && message.kind !== 'dm') return null;
  return {
    characterName: message.characterName,
    kind: message.kind,
    text: message.text,
    voice: message.kind === 'chat' ? (message.voice ?? 'in') : null,
  };
}

export function chatLines(messages: Message[]): ChatLine[] {
  return messages.flatMap((message) => {
    const line = chatLine(message);
    return line ? [line] : [];
  });
}
