/**
 * Step helpers for features/hall_of_heroes.feature. Generated specs call these synchronously
 * (the node:test callbacks gherclj writes are not async), so the replay runs in a child process.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Death } from '../lib/types.ts';

interface Op {
  op: 'heroes' | 'retire' | 'die' | 'fell' | 'gold' | 'strangerDoor' | 'strangerRetired'
    | 'list' | 'unretire' | 'delete' | 'open' | 'join' | 'slay' | 'raise';
  names?: string[];
  hero?: string;
  host?: string;
  place?: string;
  gp?: number;
  status?: string;
}

type Roster = 'active' | 'retired' | 'dead' | 'all' | 'default';

interface View {
  last: { status: number; error: string | null };
  stamps: Record<string, (string | null)[]>;
  slain: { title: string | null; scenes: string[] } | null;
  lists: Record<Roster, string[]>;
  heroes: Record<string, { retiredAt: string | null; death: Death | null; dead: boolean }>;
}

const replay = join(dirname(fileURLToPath(import.meta.url)), 'hall_of_heroes_replay.ts');

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
    timeout: 60_000,
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

/** "Bryn, Cleo and Dag" → ["Bryn", "Cleo", "Dag"]; "none" → []. */
function namesOf(list: string): string[] {
  if (list.trim() === 'none') return [];
  return list.split(/\s*,\s*|\s+and\s+/).map((name) => name.trim()).filter(Boolean);
}

export class HallOfHeroesSteps {
  private journal: Op[] = [];
  private view: View | null = null;

  private push(op: Op): void {
    this.journal.push(op);
    this.view = play(this.journal);
  }

  private seen(): View {
    return this.view ?? (this.view = play(this.journal));
  }

  private hero(name: string) {
    const hero = this.seen().heroes[name];
    assert.ok(hero, `no hero ${name}`);
    return hero;
  }

  private roster(which: Roster, names: string): void {
    assert.deepEqual(this.seen().lists[which], namesOf(names).sort(), `${which} heroes`);
  }

  iHaveTheHeroes(names: string): void { this.push({ op: 'heroes', names: namesOf(names) }); }
  hasRetired(hero: string): void { this.push({ op: 'retire', hero }); }
  hasDied(hero: string): void { this.push({ op: 'die', hero }); }
  fellIn(hero: string, place: string): void { this.push({ op: 'fell', hero, place }); }
  hasGold(hero: string, gp: number): void { this.push({ op: 'gold', hero, gp }); }
  strangerOpenedADoor(hero: string): void { this.push({ op: 'strangerDoor', hero }); }
  strangerHasRetiredHero(hero: string): void { this.push({ op: 'strangerRetired', hero }); }

  askForHeroes(status: string): void { this.push({ op: 'list', status }); }
  retire(hero: string): void { this.push({ op: 'retire', hero }); }
  unretire(hero: string): void { this.push({ op: 'unretire', hero }); }
  deleteHero(hero: string): void { this.push({ op: 'delete', hero }); }
  triesToOpenADoor(hero: string): void { this.push({ op: 'open', hero }); }
  triesToJoin(hero: string, host: string): void { this.push({ op: 'join', hero, host }); }
  slainOnAnAdventure(hero: string): void { this.push({ op: 'slay', hero }); }
  templeRaises(hero: string): void { this.push({ op: 'raise', hero }); }

  myHeroesAre(status: string, names: string): void {
    assert.ok(['active', 'retired', 'dead'].includes(status), `no such roster: ${status}`);
    this.roster(status as Roster, names);
  }

  allMyHeroesAre(names: string): void { this.roster('all', names); }
  defaultHeroesAre(names: string): void { this.roster('default', names); }

  refusedWith(text: string): void {
    const { last } = this.seen();
    assert.deepEqual([last.status, last.error], [409, text]);
  }

  refusedAsBadRequest(): void {
    const { last } = this.seen();
    assert.equal(last.status, 400, last.error ?? '');
    for (const status of ['active', 'retired', 'dead', 'all']) assert.ok(last.error?.includes(`"${status}"`), last.error ?? '');
  }

  notFound(): void {
    assert.equal(this.seen().last.status, 404, this.seen().last.error ?? '');
  }

  isRetired(hero: string): void {
    const { retiredAt } = this.hero(hero);
    assert.ok(retiredAt && !Number.isNaN(Date.parse(retiredAt)), `${hero} retiredAt: ${retiredAt}`);
  }

  isNotRetired(hero: string): void {
    assert.equal(this.hero(hero).retiredAt, null);
  }

  keepsFirstRetirement(hero: string): void {
    const stamps = this.seen().stamps[hero] ?? [];
    assert.ok(stamps.length >= 2, `${hero} was retired ${stamps.length} time(s)`);
    assert.ok(stamps.every((stamp) => stamp === stamps[0]), JSON.stringify(stamps));
    assert.equal(this.hero(hero).retiredAt, stamps[0]);
  }

  strangersHeroStillRetired(hero: string): void {
    this.isRetired(hero);
  }

  isDead(hero: string): void {
    assert.equal(this.hero(hero).dead, true);
  }

  deathNamesAdventureAndScene(hero: string): void {
    const { death } = this.hero(hero);
    const slain = this.seen().slain;
    assert.ok(death && slain, `${hero}: ${JSON.stringify(death)}`);
    assert.equal(death.adventure, slain.title);
    assert.ok(death.place && slain.scenes.includes(death.place), `${death.place} in ${slain.scenes.join(' | ')}`);
    assert.ok(death.gameCode, 'the game it fell in');
    assert.ok(!Number.isNaN(Date.parse(death.at)), death.at);
  }

  deathSays(hero: string, text: string): void {
    assert.equal(this.hero(hero).death?.cause, text);
  }

  hasNoDeath(hero: string): void {
    assert.equal(this.hero(hero).death, null);
  }
}
