/**
 * Step helpers for features/party_chat.feature. Generated specs call these synchronously
 * (the node:test callbacks gherclj writes are not async), so the game runs in a child process.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Message } from '../lib/types.ts';

interface Op {
  op: 'party' | 'say' | 'react' | 'typing';
  names?: string[];
  hero?: string;
  text?: string;
  voice?: 'in' | 'out';
  reply?: boolean;
  emoji?: string;
  emote?: boolean;
  /** Hero names, joined with "and", who a whisper is for. */
  whisper?: string;
}

interface View {
  messages: Message[];
  typing: { playerId: string; name: string }[];
  players: { playerId: string; name: string }[];
  byHero: Record<string, Message[]>;
  narratorKept: string;
  narratorTalk: string;
  anchorId: number | null;
  lastId: number | null;
}

const replay = join(dirname(fileURLToPath(import.meta.url)), 'party_chat_replay.ts');

function play(journal: Op[]): View {
  const env: NodeJS.ProcessEnv = { ...process.env, DD_FAKE_AI: '1' };
  delete env.DATABASE_URL;
  delete env.DD_APP_KEY;
  delete env.BLOB_READ_WRITE_TOKEN;
  const result = spawnSync(process.execPath, ['--experimental-strip-types', replay], {
    input: JSON.stringify(journal),
    encoding: 'utf8',
    cwd: join(dirname(replay), '..'),
    env,
    timeout: 30_000,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `replay exited ${result.status}`);
  }
  const marker = '\n__DD_VIEW__\n';
  const out = result.stdout ?? '';
  const at = out.lastIndexOf(marker);
  if (at < 0) throw new Error(`replay returned no view\n${out}\n${result.stderr}`);
  return JSON.parse(out.slice(at + marker.length)) as View;
}

export class PartyChatSteps {
  private journal: Op[] = [];
  /** The line a later reaction or "that line" talks about, and how far the log had grown. */
  private anchorId: number | null = null;
  private maxId = 0;

  theTable(party: string): void {
    const names = party.split(/\s+and\s+/).map((name) => name.trim()).filter(Boolean);
    this.journal.push({ op: 'party', names });
    this.play();
  }

  saidInCharacter(hero: string, text: string): void {
    this.speak(hero, text, 'in', false);
    const view = this.play();
    this.anchorId = view.anchorId;
    this.maxId = Math.max(...view.messages.map((m) => m.id));
  }

  saysInCharacter(hero: string, text: string): void {
    this.speak(hero, text, 'in', false);
    this.play();
  }

  saysOutOfCharacter(hero: string, text: string): void {
    this.speak(hero, text, 'out', false);
    this.play();
  }

  repliesInCharacter(hero: string, text: string): void {
    this.speak(hero, text, 'in', true);
    this.play();
  }

  reacts(hero: string, emoji: string): void {
    this.journal.push({ op: 'react', hero, emoji });
    this.play();
  }

  isTyping(hero: string): void {
    this.journal.push({ op: 'typing', hero });
    this.play();
  }

  whispersTo(hero: string, text: string, who: string): void {
    this.journal.push({ op: 'say', hero, text, voice: 'in', reply: false, whisper: who });
    this.play();
  }

  emotesInCharacter(hero: string, text: string): void {
    this.journal.push({ op: 'say', hero, text, voice: 'in', reply: false, emote: true });
    this.play();
  }

  emotesOutOfCharacter(hero: string, text: string): void {
    this.journal.push({ op: 'say', hero, text, voice: 'out', reply: false, emote: true });
    this.play();
  }

  replyQuotes(text: string): void {
    assert.equal(this.latest(this.play()).reply?.text, text);
  }

  replyIsInCharacter(hero: string): void {
    const line = this.latest(this.play());
    assert.equal(line.voice, 'in');
    assert.equal(line.characterName, hero);
  }

  replyHasItsOwnId(): void {
    const view = this.play();
    const line = this.latest(view);
    assert.notEqual(line.id, line.replyTo);
    assert.equal(line.reply?.id, view.anchorId);
  }

  lineIsOutOfCharacter(hero: string): void {
    const line = this.latest(this.play());
    assert.equal(line.voice, 'out');
    assert.equal(line.characterName, hero);
    assert.ok(line.playerId);
  }

  mentionsHero(hero: string): void {
    const line = this.latest(this.play());
    assert.ok(line.mentions.some((m) => m.target === 'hero' && m.name === hero), JSON.stringify(line.mentions));
  }

  mentionsPlayer(hero: string): void {
    const line = this.latest(this.play());
    assert.ok(line.mentions.some((m) => m.target === 'player' && m.name === hero), JSON.stringify(line.mentions));
  }

  lineIdUnchanged(): void {
    const view = this.play();
    assert.equal(view.anchorId, this.anchorId);
    assert.ok(view.messages.some((m) => m.id === this.anchorId));
    assert.equal(Math.max(...view.messages.map((m) => m.id)), this.maxId);
  }

  noReaction(emoji: string): void {
    const line = this.anchored(this.play());
    assert.equal(line.reactions.find((r) => r.emoji === emoji), undefined);
  }

  reactionCount(count: number, emoji: string, a: string, b: string): void {
    const view = this.play();
    const reaction = this.anchored(view).reactions.find((r) => r.emoji === emoji);
    assert.ok(reaction, `no ${emoji}`);
    assert.equal(reaction.count, count);
    const names = reaction.playerIds.map((id) => view.players.find((p) => p.playerId === id)?.name);
    assert.ok(names.includes(a) && names.includes(b), JSON.stringify(names));
  }

  showsTyping(hero: string): void {
    const view = this.play();
    assert.ok(view.typing.some((t) => t.name === hero), JSON.stringify(view.typing));
  }

  whisperToHero(name: string): void {
    const line = this.latest(this.play());
    assert.ok(line.whisperTo?.some((m) => m.target === 'hero' && m.name === name), JSON.stringify(line.whisperTo));
  }

  whisperToPlayer(name: string): void {
    const line = this.latest(this.play());
    assert.ok(line.whisperTo?.some((m) => m.target === 'player' && m.name === name), JSON.stringify(line.whisperTo));
  }

  onlyThoseSee(who: string): void {
    const view = this.play();
    const names = who.split(/\s+and\s+/).map((name) => name.trim());
    for (const [hero, messages] of Object.entries(view.byHero)) {
      const sees = messages.some((m) => m.id === view.lastId);
      assert.equal(sees, names.includes(hero), `${hero} ${sees ? 'sees' : 'misses'} ${view.lastId}`);
    }
  }

  lineReads(text: string): void {
    assert.equal(this.latest(this.play()).text, text);
  }

  lineIsEmote(hero: string, text: string): void {
    const line = this.latest(this.play());
    assert.equal(line.emote, true);
    assert.equal(line.characterName, hero);
    assert.equal(line.text, text);
  }

  narratorNeverHears(text: string): void {
    const view = this.play();
    assert.equal(view.narratorKept.includes(text), false, view.narratorKept);
    assert.equal(view.narratorTalk.includes(text), false, view.narratorTalk);
  }

  narratorKeepsDeed(hero: string, text: string): void {
    const view = this.play();
    assert.ok(view.narratorKept.includes(`${hero}: *${text}*`), view.narratorKept);
  }

  narratorDoesNotKeepDeed(text: string): void {
    const view = this.play();
    assert.equal(view.narratorKept.includes(text), false, view.narratorKept);
  }

  private speak(hero: string, text: string, voice: 'in' | 'out', reply: boolean): void {
    this.journal.push({ op: 'say', hero, text, voice, reply });
  }

  private play(): View {
    return play(this.journal);
  }

  private latest(view: View): Message {
    const line = view.messages.find((m) => m.id === view.lastId);
    assert.ok(line, 'no line was spoken');
    return line;
  }

  private anchored(view: View): Message {
    const line = view.messages.find((m) => m.id === view.anchorId);
    assert.ok(line, 'no line to react to');
    return line;
  }
}
