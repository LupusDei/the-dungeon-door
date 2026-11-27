/**
 * Step helpers for features/app_version.feature. Generated specs call these synchronously
 * (the node:test callbacks gherclj writes are not async), so the game runs in a child process.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type Kind = 'current' | 'old' | 'none';

interface Op {
  op: 'party' | 'version' | 'start';
  names?: string[];
  hero?: string;
  kind?: Kind;
  dungeon?: 'none' | 'fixed';
}

interface View {
  actionStatus: number;
  error: string | null;
  code: string | null;
  gameStatus: string;
  players: { name: string; appVersion: string | null; outdated: boolean }[];
}

const replay = join(dirname(fileURLToPath(import.meta.url)), 'app_version_replay.ts');

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

export class AppVersionSteps {
  private journal: Op[] = [];

  private play(): View {
    return play(this.journal);
  }

  theDoorsParty(party: string): void {
    const names = party.split(/\s+and\s+/).map((name) => name.trim()).filter(Boolean);
    this.journal.push({ op: 'party', names });
    this.play();
  }

  sendsNoAppVersion(hero: string): void {
    this.journal.push({ op: 'version', hero, kind: 'none' });
    this.play();
  }

  onAnOldBuild(hero: string): void {
    this.journal.push({ op: 'version', hero, kind: 'old' });
    this.play();
  }

  onTheCurrentBuild(hero: string): void {
    this.journal.push({ op: 'version', hero, kind: 'current' });
    this.play();
  }

  opensTheDoorOnATale(hero: string): void {
    this.journal.push({ op: 'start', hero, dungeon: 'none' });
    this.play();
  }

  opensTheDoorOnADungeon(hero: string): void {
    this.journal.push({ op: 'start', hero, dungeon: 'fixed' });
    this.play();
  }

  adventureHasNotBegun(): void {
    assert.equal(this.play().gameStatus, 'lobby');
  }

  adventureHasBegun(): void {
    assert.notEqual(this.play().gameStatus, 'lobby');
  }

  refusalNames(hero: string): void {
    const view = this.play();
    assert.equal(view.actionStatus, 409, view.error ?? '');
    assert.match(view.error ?? '', new RegExp(hero));
  }

  partyMarksOutdated(hero: string): void {
    const player = this.play().players.find((p) => p.name === hero);
    assert.equal(player?.outdated, true, JSON.stringify(player));
  }

  partyDoesNotMarkOutdated(hero: string): void {
    const player = this.play().players.find((p) => p.name === hero);
    assert.equal(player?.outdated, false, JSON.stringify(player));
  }

  isToldToUpdate(hero: string): void {
    const view = this.play();
    assert.equal(view.actionStatus, 426, `${hero}: ${view.error}`);
    assert.match(view.error ?? '', /Update the app/);
  }
}
