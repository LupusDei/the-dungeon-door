/**
 * Step helpers for features/ability_bonuses.feature. Generated specs call these synchronously
 * (the node:test callbacks gherclj writes are not async), so the server runs in a child process.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AbilityScores } from '../lib/rules/abilities.ts';
import type { CharacterSheet } from '../lib/rules/sheet.ts';
import { srd } from '../lib/rules/srd.ts';
import type { Character } from '../lib/types.ts';

type Ability = keyof AbilityScores;

interface View {
  status: number;
  error: string | null;
  home: Character | null;
  forge: AbilityScores;
  preview: CharacterSheet | null;
  table: AbilityScores | null;
  gameStatus: string | null;
}

const replay = join(dirname(fileURLToPath(import.meta.url)), 'ability_bonuses_replay.ts');

const twoOne = (plusTwo: string, plusOne: string) => ({ kind: 'twoOne', plusTwo, plusOne });
const oneOneOne = { kind: 'oneOneOne' };

export class AbilityBonusesSteps {
  /** Fixed for the scenario: the hero's id seeds the forge, so every replay builds the same Bryn. */
  private ids = { bryn: randomUUID(), hero: randomUUID(), other: randomUUID() };
  private journal: object[] = [];

  backgroundRaises(a: string, b: string, c: string): void {
    assert.deepEqual([...(srd().backgrounds.get('soldier')?.abilities ?? [])], [a, b, c]);
  }

  forgedWithTwoOne(plusTwo: string, plusOne: string): void {
    this.do({ op: 'forge', boost: twoOne(plusTwo, plusOne) });
  }

  forgedWithOneOneOne(): void {
    this.do({ op: 'forge', boost: oneOneOne });
  }

  forgedWithThree(ability: string): void {
    this.do({ op: 'forge', boost: { kind: 'plusThree', ability } });
  }

  forgedWithoutChoosing(): void {
    this.do({ op: 'forge', boost: null });
    assert.equal(this.play().status, 200);
  }

  wasForgedWithTwoOne(plusTwo: string, plusOne: string): void {
    this.forgedWithTwoOne(plusTwo, plusOne);
    assert.equal(this.play().status, 200);
  }

  previewedWithTwoOne(plusTwo: string, plusOne: string): void {
    this.do({ op: 'preview', boost: twoOne(plusTwo, plusOne) });
  }

  placesTwoOne(plusTwo: string, plusOne: string): void {
    this.do({ op: 'place', boost: twoOne(plusTwo, plusOne) });
  }

  placesOneOneOne(): void {
    this.do({ op: 'place', boost: oneOneOne });
  }

  scoreHasRisen(ability: string, by: number): void {
    this.do({ op: 'drift', ability, by });
  }

  sitsWith(other: string): void {
    this.do({ op: 'seat', other });
  }

  adventureHasBegun(): void {
    this.do({ op: 'start' });
    assert.notEqual(this.play().gameStatus, 'lobby');
  }

  adventureEnds(): void {
    this.do({ op: 'end' });
    assert.equal(this.play().gameStatus, 'ended');
  }

  accepted(): void {
    const view = this.play();
    assert.equal(view.status, 200, view.error ?? '');
  }

  refusedAsInvalid(): void {
    assert.equal(this.play().status, 400);
  }

  refusedAsInvalidWith(message: string): void {
    const view = this.play();
    assert.deepEqual([view.status, view.error], [400, message]);
  }

  refusedAsConflictWith(message: string): void {
    const view = this.play();
    assert.deepEqual([view.status, view.error], [409, message]);
  }

  notSaved(): void {
    assert.equal(this.play().home, null);
  }

  recordsTwoOne(plusTwo: string, plusOne: string): void {
    assert.deepEqual(this.hero().sheet.abilityBoost, twoOne(plusTwo, plusOne));
  }

  recordsOneOneOne(): void {
    assert.deepEqual(this.hero().sheet.abilityBoost, oneOneOne);
  }

  aboveForge(ability: string, by: number): void {
    const view = this.play();
    const at = ability as Ability;
    assert.equal(this.hero(view).sheet.abilityScores[at], view.forge[at] + by);
  }

  belowForge(ability: string, by: number): void {
    this.aboveForge(ability, -by);
  }

  matchesForge(ability: string): void {
    this.aboveForge(ability, 0);
  }

  atTableMatchesForge(ability: string): void {
    const view = this.play();
    assert.ok(view.table, 'Bryn is not at a table');
    assert.equal(view.table[ability as Ability], view.forge[ability as Ability]);
  }

  bonusesOpen(): void {
    assert.equal(this.hero().bonusesOpen, true);
  }

  bonusesNotOpen(): void {
    assert.equal(this.hero().bonusesOpen, false);
  }

  previewMatchesSaved(): void {
    const view = this.play();
    assert.ok(view.preview, 'nothing was previewed');
    assert.deepEqual(this.hero(view).sheet, view.preview);
  }

  private do(op: object): void {
    this.journal.push(op);
    this.play();
  }

  private hero(view = this.play()): Character {
    assert.ok(view.home, 'Bryn was not saved');
    return view.home;
  }

  private play(): View {
    const env: NodeJS.ProcessEnv = { ...process.env, DD_FAKE_AI: '1' };
    delete env.DATABASE_URL;
    delete env.DD_APP_KEY;
    delete env.BLOB_READ_WRITE_TOKEN;
    delete env.DD_FAKE_DELAY_MS;
    const result = spawnSync(process.execPath, ['--experimental-strip-types', replay], {
      input: JSON.stringify({ ids: this.ids, ops: this.journal }),
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
}
