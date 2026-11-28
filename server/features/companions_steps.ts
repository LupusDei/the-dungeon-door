/**
 * Step helpers for features/companions.feature. Generated specs call these synchronously (the node:test
 * callbacks gherclj writes are not async), so the replay runs in a child process.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Op, View } from './companions_replay.ts';

const replay = join(dirname(fileURLToPath(import.meta.url)), 'companions_replay.ts');

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

/** "Brannoch and Ilse" → ["Brannoch", "Ilse"]; "none" → []. */
function namesOf(list: string): string[] {
  if (list.trim() === 'none') return [];
  return list.split(/\s*,\s*|\s+and\s+/).map((name) => name.trim()).filter(Boolean);
}

export class CompanionsSteps {
  private journal: Op[] = [];
  private view: View | null = null;

  private push(op: Op): void {
    this.journal.push(op);
    this.view = null;
  }

  private seen(): View {
    return this.view ?? (this.view = play(this.journal));
  }

  /** The one companion every scenario has. */
  private companion() {
    const { companions } = this.seen();
    assert.equal(companions.length, 1, JSON.stringify(companions));
    return companions[0];
  }

  private invitation() {
    const { invites } = this.seen();
    assert.equal(invites.length, 1, `their invitations: ${JSON.stringify(invites)}`);
    return invites[0];
  }

  adventuredBeside(hero: string): void { this.push({ op: 'meet', hero }); }
  alsoHasTheHeroes(names: string): void { this.push({ op: 'forge', names: namesOf(names) }); }
  heroHasFallen(hero: string): void { this.push({ op: 'fall', hero }); }
  heroIsRetired(hero: string): void { this.push({ op: 'retire', hero }); }
  companionGoesBy(name: string): void { this.push({ op: 'theyGoBy', name }); }
  iGoBy(name: string): void { this.push({ op: 'iGoBy', name }); }

  iCallThatCompanion(name: string): void { this.push({ op: 'iCall', name }); }
  iForgetMyNameForThem(): void { this.push({ op: 'iCall', name: '' }); }
  inviteThePerson(): void { this.push({ op: 'invite' }); }
  inviteAskingFor(hero: string): void { this.push({ op: 'invite', hero }); }
  askForInstead(hero: string): void { this.push({ op: 'askAgain', hero }); }
  tryANameOf(letters: number): void { this.push({ op: 'iGoBy', name: 'n'.repeat(letters) }); }

  companionsAreCalled(names: string): void {
    assert.deepEqual(this.seen().companions.map((c) => c.name), namesOf(names));
  }

  wasNamedBy(who: string): void {
    const by = { me: 'you', them: 'them', nobody: null }[who];
    assert.notEqual(by, undefined, `named by ${who}?`);
    assert.equal(this.companion().namedBy, by);
  }

  canBring(names: string): void {
    assert.deepEqual(this.companion().heroes, namesOf(names).sort());
  }

  theyAreInvited(): void {
    const { last } = this.seen();
    assert.deepEqual([last.status, last.alreadyInvited], [200, false], last.error ?? '');
    this.invitation();
  }

  theyWereAlreadyInvited(): void {
    const { last } = this.seen();
    assert.deepEqual([last.status, last.alreadyInvited], [200, true], last.error ?? '');
    this.invitation();
  }

  theyHaveNoInvitation(): void {
    assert.deepEqual(this.seen().invites, []);
  }

  invitationAsksFor(hero: string): void {
    assert.equal(this.invitation().hero, hero);
  }

  invitationAsksForNoHero(): void {
    assert.equal(this.invitation().hero, null);
  }

  invitationIsFrom(name: string): void {
    const invitation = this.invitation();
    assert.deepEqual([invitation.fromPlayerName, invitation.fromName], [name, 'Bryn']);
  }

  invitationNamesNoPerson(): void {
    const invitation = this.invitation();
    assert.deepEqual([invitation.fromPlayerName, invitation.fromName], [null, 'Bryn']);
  }

  invitationRefusedWith(text: string): void {
    const { last } = this.seen();
    assert.deepEqual([last.status, last.error], [409, text]);
  }

  nameRefusedAsTooLong(): void {
    const { last } = this.seen();
    assert.deepEqual([last.status, last.error], [400, 'name is at most 24 characters']);
  }
}
