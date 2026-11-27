/**
 * The heroes belong to the players. The narrator describes the world and the result of a chosen
 * action, and may repeat a line a player actually wrote. It does not invent what a hero says.
 */

export const PLAYER_VOICE = `
THE HEROES BELONG TO THE PLAYERS
- Never put words in a hero's mouth. Do not write dialogue, thoughts, or quoted speech for a player character unless you are repeating words the player actually wrote, unchanged.
- Never decide a hero's feelings, attitudes, or choices.
- Never narrate an action a hero did not take. The party already chose. Describe only the immediate physical result of that chosen action (the door gives, the blow lands, the rope holds) and what the engine's results say happened.
- Describe the world, the NPCs, the monsters, and those outcomes. Then hand the moment back to the players. For example: "The innkeeper eyes you warily. What do you say?"
- Whimsical details of the world and of items are welcome: a staff that hiccups, a door that hums, a coin that always lands on its edge.
- When the turn includes IN CHARACTER lines, your outcome, narration, and NPC reactions answer those exact words and deeds. Do not rewrite them.
- A written action is also the player's own words. Narrate the result the engine recorded. Do not add speech, feelings, or deeds beyond the words they wrote.`;

/** A line a player wrote, so the narrator may repeat it and must not replace it. */
export interface HeroLine {
  name: string;
  text: string;
}

const SPEECH = 'says|said|whispers|whispered|whisper|mutters|muttered|mutter|shouts|shouted|shout|asks|asked|ask|replies|replied|reply|calls|called|call|cries|cried|cry|murmurs|murmured|murmur|declares|declared|declare|answers|answered|answer|yells|yelled|yell|exclaims|exclaimed|exclaim|snaps|snapped|snap|laughs|laughed|laugh|sighs|sighed|sigh|adds|added|tells|told|tell|announces|announced|announce|screams|screamed|scream|gasps|gasped|gasp|protests|protested|protest|insists|insisted|insist|admits|admitted|admit|demands|demanded|demand|hisses|hissed|hiss|growls|growled|growl';

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').replace(/^[\s"'“”]+|[\s"'“”.,!?…]+$/g, '').trim();

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Lines the narrator must answer and must not rewrite: a scene's roleplay (from POST /speak and a
 * written action) plus in-character chat. Out-of-character chat (`voice: "out"`) is table talk and
 * is left out. A chat line with no voice yet counts as in character, the same as the stored default.
 * A whisper is never included, whatever its voice. An in-character emote is included as a deed
 * (`*draws her sword*`). An out-of-character emote is not a deed.
 */
export function keptWords(
  roleplay: { characterName: string; text: string }[],
  chat: {
    characterName: string | null;
    kind?: string;
    text: string;
    voice?: 'in' | 'out' | null;
    emote?: boolean;
    whisperTo?: { playerId: string }[] | null;
  }[],
): { characterName: string; text: string }[] {
  const fromChat = chat.flatMap((line) => {
    if ((line.kind ?? 'chat') !== 'chat' || line.voice === 'out' || !line.characterName) return [];
    if (line.whisperTo && line.whisperTo.length > 0) return [];
    const text = line.emote ? `*${line.text}*` : line.text;
    return [{ characterName: line.characterName, text }];
  });
  const seen = new Set<string>();
  const lines: { characterName: string; text: string }[] = [];
  for (const line of [...roleplay, ...fromChat]) {
    const key = `${line.characterName}\n${line.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
  }
  return lines;
}

/** What the players said and did this turn, in their own words, for the narrator to answer. */
export function roleplayBlock(lines: { characterName: string; text: string }[]): string {
  if (!lines.length) return '';
  return [
    'IN CHARACTER (the players wrote these words and deeds; your narration and the NPCs answer them. Repeat a hero only in these words, unchanged)',
    ...lines.map((l) => `- ${l.characterName}: ${l.text}`),
  ].join('\n');
}

/** "Bryn" and "Bryn Ashgrove" are the same hero; a shared first name is how the table speaks. */
function sameHero(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  return x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `);
}

function allowed(speaker: string | null, lines: HeroLine[]): string[] {
  const pool = speaker === null ? lines : lines.filter((l) => sameHero(l.name, speaker));
  return pool.map((l) => norm(l.text)).filter(Boolean);
}

function quoteIsTheirs(quote: string, lines: string[]): boolean {
  const q = norm(quote);
  return q.length > 0 && lines.some((line) => line.includes(q));
}

type Quote = 'd' | 's' | null;

/** Double quotes always, and a single quote only when it is opening or closing dialogue. */
function toggleQuote(text: string, i: number, quote: Quote): Quote {
  const c = text[i];
  if (c === '"' || c === '\u201C' || c === '\u201D') {
    if (quote === 'd') return null;
    if (quote === null) return 'd';
    return quote;
  }
  if (c !== "'") return quote;
  if (quote === 's') {
    const next = text[i + 1];
    return next === undefined || /[\s.,!?;:)\]}]/.test(next) ? null : quote;
  }
  if (quote !== null) return quote;
  const prev = text[i - 1];
  return prev === undefined || /[\s,:([{]/.test(prev) ? 's' : null;
}

/** Sentences, keeping the space after each. A quote that ends on .!? ends the sentence. */
function sentencesOf(paragraph: string): string[] {
  const parts: string[] = [];
  let buf = '';
  let quote: Quote = null;
  for (let i = 0; i < paragraph.length; i++) {
    const c = paragraph[i];
    buf += c;
    const next = toggleQuote(paragraph, i, quote);
    const closedDialogue = quote !== null && next === null;
    quote = next;
    const ended = (!quote && /[.!?]/.test(c)) || (closedDialogue && /[.!?]/.test(paragraph[i - 1] ?? ''));
    if (!ended) continue;
    if (paragraph[i + 1] === ' ') { buf += ' '; i++; }
    parts.push(buf);
    buf = '';
  }
  if (buf) parts.push(buf);
  return parts;
}

function sentenceSteals(sentence: string, heroes: string[], lines: HeroLine[]): boolean {
  const names = [...heroes].filter(Boolean).sort((a, b) => b.length - a.length);
  const quoted = '[“"\']([^”"\']*)[”"\']';
  const patterns: { re: RegExp; speaker: number; quote: number }[] = [];
  if (names.length) {
    const name = names.map(escapeRegExp).join('|');
    patterns.push(
      { re: new RegExp(`\\b(${name})\\s+(?:${SPEECH})\\s*[,:]?\\s*${quoted}`, 'gi'), speaker: 1, quote: 2 },
      { re: new RegExp(`${quoted}\\s*,?\\s*(${name})\\s+(?:${SPEECH})\\b`, 'gi'), speaker: 2, quote: 1 },
      { re: new RegExp(`\\b(${name})\\s*:\\s*${quoted}`, 'gi'), speaker: 1, quote: 2 },
    );
  }
  patterns.push({ re: new RegExp(`(?:^|\\s)you\\s+(?:${SPEECH})\\s*[,:]?\\s*${quoted}`, 'gi'), speaker: 0, quote: 1 });
  return patterns.some(({ re, speaker, quote }) => {
    for (const match of sentence.matchAll(re)) {
      const who = speaker === 0 ? null : match[speaker];
      const said = match[quote] ?? '';
      if (!quoteIsTheirs(said, allowed(who, lines))) return true;
    }
    return false;
  });
}

/** Quoted speech put in a hero's mouth that the player did not write. */
export function hasStolenHeroSpeech(text: string, heroes: string[], lines: HeroLine[]): boolean {
  return text.split(/\n\n/).some((paragraph) => sentencesOf(paragraph).some((s) => sentenceSteals(s, heroes, lines)));
}

/**
 * Drops sentences that put words in a hero's mouth. NPC speech, the player's own lines, and
 * whimsical world detail stay. The input is returned unchanged when nothing was stolen.
 */
export function stripHeroSpeech(text: string, heroes: string[], lines: HeroLine[]): string {
  if (!hasStolenHeroSpeech(text, heroes, lines)) return text;
  return text.split(/\n\n/).flatMap((paragraph) => {
    const kept = sentencesOf(paragraph).filter((s) => !sentenceSteals(s, heroes, lines)).join('');
    const tidy = kept.replace(/[ \t]{2,}/g, ' ').replace(/\s+([,.;!?])/g, '$1').trim();
    return tidy ? [tidy] : [];
  }).join('\n\n');
}
