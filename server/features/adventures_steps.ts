/**
 * Step helpers for adventure_length.feature, past_adventures.feature and out_of_credit.feature.
 * Generated specs call these synchronously (the node:test callbacks gherclj writes are not async),
 * so the game runs in a child process: each step replays the journal so far and reads the view.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Op, View } from './adventures_replay.ts';

const replay = join(dirname(fileURLToPath(import.meta.url)), 'adventures_replay.ts');

function play(journal: Op[]): View {
  const env: NodeJS.ProcessEnv = { ...process.env, DD_FAKE_AI: '1' };
  delete env.DATABASE_URL;
  delete env.DD_APP_KEY;
  delete env.BLOB_READ_WRITE_TOKEN;
  delete env.DD_FAKE_DELAY_MS;
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', replay], {
    input: JSON.stringify(journal),
    encoding: 'utf8',
    cwd: join(dirname(replay), '..'),
    env,
    timeout: 60_000,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `replay exited ${result.status}`);
  const marker = '\n__DD_VIEW__\n';
  const out = result.stdout ?? '';
  const at = out.lastIndexOf(marker);
  if (at < 0) throw new Error(`replay returned no view\n${out}\n${result.stderr}`);
  return JSON.parse(out.slice(at + marker.length)) as View;
}

const listed = (names: string): string[] =>
  names.split(/\s*,\s*|\s+and\s+/).map((name) => name.trim()).filter(Boolean);

export class AdventureSteps {
  private journal: Op[] = [];
  /** The view after the journal so far; replayed only when the journal has grown. */
  private seen: { length: number; view: View } | null = null;

  private view(): View {
    if (!this.seen || this.seen.length !== this.journal.length) this.seen = { length: this.journal.length, view: play(this.journal) };
    return this.seen.view;
  }

  private did(op: Op): void {
    this.journal.push(op);
    this.view();
  }

  // Given / When

  partyAtTheDoor(party: string): void {
    this.did({ op: 'party', names: listed(party) });
  }

  accountOutOfCredit(): void {
    this.did({ op: 'broke' });
  }

  opensForScenes(hero: string, count: number): void {
    this.did({ op: 'start', hero, count });
  }

  opensWithNoSetLength(hero: string): void {
    this.did({ op: 'start', hero, count: 0 });
  }

  playsAScene(): void {
    this.did({ op: 'play', count: 1 });
  }

  playsScenes(count: number): void {
    this.did({ op: 'play', count });
  }

  playsToTheEnd(): void {
    this.did({ op: 'play', count: 0 });
  }

  callsTheEnding(hero: string): void {
    this.did({ op: 'ending', hero });
  }

  walksOut(hero: string): void {
    this.did({ op: 'leave', hero });
  }

  // Then: how long it is

  scenesStillToCome(count: number): void {
    const view = this.view();
    assert.equal(view.scenesLeft, count, `status ${view.gameStatus}`);
  }

  lastSceneIsBeingPlayed(): void {
    const view = this.view();
    assert.equal(view.gameStatus, 'voting');
    assert.equal(view.scenesLeft, 0);
  }

  noLongerCounted(): void {
    const view = this.view();
    assert.equal(view.gameStatus, 'voting');
    assert.equal(view.scenesLeft, null, 'the quest may take longer than planned');
  }

  hasNoSetLength(): void {
    const view = this.view();
    assert.equal(view.openEnded, true);
    assert.equal(view.scenesLeft, null, 'nothing to count down');
  }

  isStillGoing(): void {
    assert.equal(this.view().gameStatus, 'voting');
  }

  hasReachedItsEnd(): void {
    assert.equal(this.view().gameStatus, 'ended');
  }

  doorIsStillShut(): void {
    assert.equal(this.view().gameStatus, 'lobby');
  }

  tableHearsTheEndingWasCalled(): void {
    const said = this.view().told.filter((line) => /has called the ending/.test(line));
    assert.equal(said.length, 1, JSON.stringify(this.view().told));
  }

  isRefusedTheEnding(hero: string): void {
    const view = this.view();
    assert.equal(view.actionStatus, 403, `${hero}: ${view.error}`);
    assert.equal(view.told.some((line) => /has called the ending/.test(line)), false);
  }

  // Then: out of credit

  tableHearsTheAccountIsOutOfCredit(): void {
    assert.ok(this.view().told.some((line) => /run out of credit/.test(line)), JSON.stringify(this.view().told));
  }

  tableIsNotToldToTryAgain(): void {
    assert.equal(this.view().told.some((line) => /try again/.test(line)), false, JSON.stringify(this.view().told));
  }

  // Then: past adventures

  questsNumber(hero: string, count: number): void {
    assert.equal(this.questsOf(hero).length, count, JSON.stringify(this.questsOf(hero).map((q) => q.title)));
  }

  latestQuestHasEnded(hero: string): void {
    const quest = this.latest(hero);
    assert.equal(quest.ended, true);
    assert.ok(quest.ending && quest.ending.length > 0, 'the epilogue is kept');
    assert.ok(quest.title, 'it has a name');
  }

  latestQuestIsUnfinished(hero: string): void {
    const quest = this.latest(hero);
    assert.equal(quest.ended, false);
    assert.equal(quest.ending, null);
  }

  latestQuestKeepsItsPictures(hero: string): void {
    const quest = this.latest(hero);
    assert.ok(quest.images.length > 0, 'at least one picture');
    assert.ok(quest.images.every((url, i) => url.length > 0 && url !== quest.images[i - 1]), JSON.stringify(quest.images));
  }

  latestQuestSaysHowTheyCameOut(hero: string): void {
    const quest = this.latest(hero);
    assert.ok(quest.result, 'a result');
    assert.equal(quest.result!.fell, false);
    assert.ok(quest.result!.level >= 1 && quest.result!.xpGained >= 0);
  }

  latestQuestWasWith(hero: string, company: string): void {
    assert.deepEqual(this.latest(hero).party, listed(company));
  }

  private questsOf(hero: string): View['quests'][string] {
    const quests = this.view().quests[hero];
    assert.ok(quests, `no hero ${hero}`);
    return quests;
  }

  private latest(hero: string): View['quests'][string][number] {
    const quest = this.questsOf(hero)[0];
    assert.ok(quest, `${hero} has no past adventure`);
    return quest;
  }
}
