/**
 * Step helpers for features/streamlined_game.feature. Generated specs call these synchronously
 * (the node:test callbacks gherclj writes are not async), so the game runs in a child process
 * (streamlined_replay.ts): two heroes at a door, a dungeon master who may write at length, and the
 * game as a player is sent it.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sentencesOf, wordCount } from '../lib/telling.ts';
import type { Op, View } from './streamlined_replay.ts';

const replay = join(dirname(fileURLToPath(import.meta.url)), 'streamlined_replay.ts');

function play(journal: Op[]): View {
  const env: NodeJS.ProcessEnv = { ...process.env, DD_FAKE_AI: '1' };
  delete env.DATABASE_URL;
  delete env.DD_APP_KEY;
  delete env.BLOB_READ_WRITE_TOKEN;
  delete env.DD_FAKE_DELAY_MS;
  const result = spawnSync(process.execPath, ['--experimental-strip-types', replay], {
    input: JSON.stringify(journal),
    encoding: 'utf8',
    cwd: join(dirname(replay), '..'),
    env,
    timeout: 30_000,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `replay exited ${result.status}`);
  const marker = '\n__DD_VIEW__\n';
  const out = result.stdout ?? '';
  const at = out.lastIndexOf(marker);
  if (at < 0) throw new Error(`replay returned no view\n${out}\n${result.stderr}`);
  return JSON.parse(out.slice(at + marker.length)) as View;
}

export class StreamlinedSteps {
  private journal: Op[] = [];
  private seen: View | null = null;

  /** The game as it stands after every step so far. Played once, then kept until a step adds to the journal. */
  private view(): View {
    this.seen ??= play(this.journal);
    return this.seen;
  }

  private then(op: Op): void {
    this.journal.push(op);
    this.seen = null;
  }

  wordyDungeonMaster(): void {
    this.then({ op: 'wordy' });
  }

  opensWithoutATelling(): void {
    this.then({ op: 'start' });
  }

  opensOnA(telling: string): void {
    this.then({ op: 'start', telling });
  }

  partyPicksTheSecondChoice(): void {
    this.then({ op: 'pick', choice: 'b' });
  }

  catalogOffers(ids: string): void {
    assert.deepEqual(this.view().tellings, ids.split(/,\s*/));
  }

  gameIsTold(telling: string): void {
    const view = this.view();
    assert.equal(view.startStatus, 200, view.error ?? '');
    assert.equal(view.telling, telling);
  }

  dungeonMasterWasAskedFor(telling: string): void {
    const { asked } = this.view();
    assert.ok(asked.length > 0, 'the dungeon master has written');
    assert.ok(asked.every((t) => t === telling), JSON.stringify(asked));
  }

  sceneInAtMost(sentences: number): void {
    const { narration } = this.view();
    assert.ok(narration.length > 0, 'a scene is told');
    assert.ok(sentencesOf(narration).length <= sentences, narration);
    assert.equal(/What do you do\?/.test(narration), false, 'no question handed back');
  }

  sceneInMoreThan(sentences: number): void {
    const { narration } = this.view();
    assert.ok(sentencesOf(narration).length > sentences, narration);
  }

  labelsAtMost(words: number): void {
    const { choices } = this.view();
    assert.ok(choices.length >= 2);
    for (const c of choices) assert.ok(wordCount(c.label) <= words, c.label);
  }

  detailsAtMost(words: number): void {
    for (const c of this.view().choices) assert.ok(wordCount(c.detail) <= words, c.detail);
  }

  choicesCarryTheirDice(): void {
    for (const c of this.view().choices) assert.ok(c.rules, `${c.label} has no rules line`);
  }

  asideIsPosted(): void {
    assert.ok(this.view().dmLines.includes('Mind the rat, my dears, it bites.'), JSON.stringify(this.view().dmLines));
  }

  asideIsNotPosted(): void {
    assert.equal(this.view().dmLines.includes('Mind the rat, my dears, it bites.'), false, JSON.stringify(this.view().dmLines));
  }

  whatHappenedIn(sentences: number): void {
    const { outcome } = this.view();
    assert.ok(outcome, 'the turn has an outcome');
    assert.equal(sentencesOf(outcome).length, sentences, outcome);
  }

  resultNamesEveryHero(): void {
    const view = this.view();
    assert.ok(view.heroes.length > 0);
    assert.deepEqual(view.resultHeroes, view.heroes);
  }

  checkIsInTheDiceLog(): void {
    assert.ok(this.view().diceLines.length > 0, 'a line with "vs DC"');
  }

  startIsRefused(): void {
    const view = this.view();
    assert.equal(view.startStatus, 400, view.error ?? '');
    assert.match(view.error ?? '', /telling must be/);
  }

  stillAtTheDoor(): void {
    assert.equal(this.view().gameStatus, 'lobby');
  }
}
