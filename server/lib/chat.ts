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

/**
 * True when this player may read the line. A whisper is visible to its sender and the players it names,
 * and to nobody else. Anything that is not a whisper is visible to the whole party.
 */
export function canSee(message: Pick<Message, 'playerId' | 'whisperTo'>, playerId: string): boolean {
  const to = message.whisperTo;
  if (!to || to.length === 0) return true;
  if (message.playerId === playerId) return true;
  return to.some((target) => target.playerId === playerId);
}

const SLASH = /^\/(whisper|emote|me|w)(?![\p{L}\p{N}])/iu;

/**
 * Turns a composed line into what is stored. `/me` and `/emote` are an emote. `/w` and `/whisper`
 * name who hears it, by hero name or `player:Name`, and the rest is the message. A comma, or "and"
 * when another name follows, separates several people. The longest name at the table wins, so a
 * space in a name stays part of the name. `emote` and `whisperTo` on the request do the same work
 * without a slash, and a slash adds to them.
 */
export function interpretChat(
  text: string,
  party: Named[],
  options: { emote?: unknown; whisperTo?: unknown } = {},
): { text: string; emote: boolean; whisperTo: Mention[] | null } {
  if (options.emote !== undefined && options.emote !== null && typeof options.emote !== 'boolean') {
    throw new Error('emote must be true or false');
  }
  let body = text;
  let emote = options.emote === true;
  let targets = whisperTargets(options.whisperTo, party);

  const command = body.match(SLASH);
  if (command) {
    const word = command[1]!.toLowerCase();
    const rest = body.slice(command[0].length).trim();
    if (word === 'me' || word === 'emote') {
      emote = true;
      body = rest;
    } else {
      const parsed = readWhisper(rest, party);
      targets = mergeTargets(targets, parsed.targets);
      body = parsed.text;
      const inner = body.match(/^\/(emote|me)(?![\p{L}\p{N}])/iu);
      if (inner) {
        emote = true;
        body = body.slice(inner[0].length).trim();
      }
    }
  }

  return { text: body.trim(), emote, whisperTo: targets.length ? targets : null };
}

/** A leading name, optionally `player:` or `@`, matching the longest hero name. */
function takeMention(text: string, party: Named[]): { mention: Mention; length: number } | null {
  let target: MentionTarget = 'hero';
  let rest = text;
  let mark = 0;
  if (rest.startsWith('@')) {
    rest = rest.slice(1);
    mark += 1;
  }
  if (rest.toLowerCase().startsWith('player:')) {
    target = 'player';
    rest = rest.slice('player:'.length);
    mark += 'player:'.length;
  }
  const hit = longestName(rest, party);
  if (!hit) return null;
  return { mention: { playerId: hit.playerId, name: hit.name, target }, length: mark + hit.length };
}

/** Names at the start of a `/w` or `/whisper`, then the words they should hear. */
function readWhisper(rest: string, party: Named[]): { targets: Mention[]; text: string } {
  let cursor = rest.trimStart();
  const targets: Mention[] = [];
  while (cursor) {
    const hit = takeMention(cursor, party);
    if (!hit) break;
    if (!targets.some((target) => target.playerId === hit.mention.playerId)) targets.push(hit.mention);
    cursor = cursor.slice(hit.length).trimStart();
    if (cursor.startsWith(',')) {
      const after = cursor.slice(1).trimStart();
      if (takeMention(after, party)) {
        cursor = after;
        continue;
      }
      cursor = after;
      break;
    }
    const and = cursor.match(/^and\s+/i);
    if (and && takeMention(cursor.slice(and[0].length), party)) {
      cursor = cursor.slice(and[0].length);
      continue;
    }
    break;
  }
  if (!targets.length) throw new Error('a whisper needs someone at the table');
  const text = cursor.trim().replace(/^:\s*/, '');
  if (!text) throw new Error('a whisper needs words');
  return { targets, text };
}

function whisperTargets(value: unknown, party: Named[]): Mention[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('whisperTo must name players at the table');
  const out: Mention[] = [];
  for (const item of value) {
    let playerId = '';
    let target: MentionTarget = 'hero';
    if (typeof item === 'string') playerId = item;
    else if (item && typeof item === 'object') {
      const record = item as { playerId?: unknown; target?: unknown };
      if (typeof record.playerId !== 'string') throw new Error('whisperTo must name players at the table');
      playerId = record.playerId;
      if (record.target === 'player') target = 'player';
      else if (record.target !== undefined && record.target !== null && record.target !== 'hero') {
        throw new Error('whisperTo must name players at the table');
      }
    } else throw new Error('whisperTo must name players at the table');
    const hero = party.find((person) => person.playerId === playerId);
    if (!hero) throw new Error('whisperTo must name players at the table');
    if (!out.some((named) => named.playerId === playerId)) out.push({ playerId, name: hero.name, target });
  }
  return out;
}

function mergeTargets(first: Mention[], second: Mention[]): Mention[] {
  const out = [...first];
  for (const target of second) if (!out.some((named) => named.playerId === target.playerId)) out.push(target);
  return out;
}

export function quoteOf(message: Message): MessageQuote {
  return {
    id: message.id,
    kind: message.kind,
    playerId: message.playerId,
    characterName: message.characterName,
    text: message.text,
    voice: message.voice,
    ...(message.emote ? { emote: true } : {}),
  };
}

/**
 * A line the dungeon master can read. System lines are dropped. A whisper is dropped entirely:
 * the narrator never hears it. `voice` is "in" or "out" for a player's line and null for the DM's
 * own quip, so in-character speech is visible in the data. An emote keeps that voice.
 */
export function chatLine(message: Message): ChatLine | null {
  if (message.kind === 'system') return null;
  if (message.kind !== 'chat' && message.kind !== 'dm') return null;
  if (message.whisperTo && message.whisperTo.length > 0) return null;
  return {
    characterName: message.characterName,
    kind: message.kind,
    text: message.text,
    voice: message.kind === 'chat' ? (message.voice ?? 'in') : null,
    ...(message.emote ? { emote: true } : {}),
  };
}

export function chatLines(messages: Message[]): ChatLine[] {
  return messages.flatMap((message) => {
    const line = chatLine(message);
    return line ? [line] : [];
  });
}
