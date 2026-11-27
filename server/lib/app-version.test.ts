import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, test } from 'node:test';

process.env.DD_FAKE_AI = '1';
delete process.env.DATABASE_URL;
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.DD_APP_KEY;
delete process.env.DD_FAKE_DELAY_MS;
delete process.env.DD_MIN_APP_VERSION;

import * as joinApi from '../api/game-join.ts';
import * as messagesApi from '../api/game-messages.ts';
import * as startApi from '../api/game-start.ts';
import * as voteApi from '../api/game-vote.ts';
import * as gameApi from '../api/game.ts';
import * as gamesApi from '../api/games.ts';
import { call, gamePath, makeCharacter } from './api.fixture.ts';
import {
  isOutdated, minAppBuild, outdatedAppVersionHeader, parseAppVersion, partyOutdatedMessage, supportedAppVersionHeader, UPDATE_REQUIRED_MESSAGE,
} from './app-version.ts';
import { settle } from './background.ts';
import { MemoryStore } from './store/memory.ts';
import { setStore } from './store/index.ts';
import type { GameState } from './types.ts';

const savedMin = process.env.DD_MIN_APP_VERSION;

beforeEach(() => {
  setStore(new MemoryStore());
  delete process.env.DD_MIN_APP_VERSION;
});
afterEach(async () => {
  await settle();
  if (savedMin === undefined) delete process.env.DD_MIN_APP_VERSION;
  else process.env.DD_MIN_APP_VERSION = savedMin;
});

test('a version is a build number, alone or beside a marketing version', () => {
  assert.deepEqual(parseAppVersion('0.2+47'), { raw: '0.2+47', marketing: '0.2', build: 47 });
  assert.deepEqual(parseAppVersion(' 0.2 (47) '), { raw: '0.2 (47)', marketing: '0.2', build: 47 });
  assert.deepEqual(parseAppVersion('47'), { raw: '47', marketing: null, build: 47 });
  assert.deepEqual(parseAppVersion('0.2'), { raw: '0.2', marketing: '0.2', build: null });
  assert.equal(parseAppVersion(''), null);
  assert.equal(parseAppVersion('nope'), null);
  assert.equal(parseAppVersion(null), null);
});

test('missing, build-less and too-low versions are out of date; the env can raise the floor', () => {
  assert.equal(minAppBuild(), 1);
  assert.equal(isOutdated(null), true);
  assert.equal(isOutdated(''), true);
  assert.equal(isOutdated('0.2'), true, 'a marketing version with no build cannot clear a build floor');
  assert.equal(isOutdated('0.2+0'), true);
  assert.equal(isOutdated(outdatedAppVersionHeader()), true);
  assert.equal(isOutdated('0.2+1'), false);
  assert.equal(isOutdated('47'), false);
  assert.equal(isOutdated(supportedAppVersionHeader()), false);

  process.env.DD_MIN_APP_VERSION = '5';
  assert.equal(minAppBuild(), 5);
  assert.equal(isOutdated('0.2+4'), true);
  assert.equal(isOutdated('0.9+5'), false);
  process.env.DD_MIN_APP_VERSION = '0.3+8';
  assert.equal(minAppBuild(), 8);
  assert.equal(isOutdated('0.3+8'), false);
});

test('the refusal names whoever has to update', () => {
  assert.equal(partyOutdatedMessage(['Ilsa']), 'Ilsa needs to update the app before the adventure can begin.');
  assert.equal(partyOutdatedMessage(['Ilsa', 'Bryn']), 'Ilsa and Bryn need to update the app before the adventure can begin.');
  assert.equal(partyOutdatedMessage(['Ilsa', 'Bryn', 'Cleo']), 'Ilsa, Bryn and Cleo need to update the app before the adventure can begin.');
});

async function seat(versions: { name: string; appVersion: string | null }[]) {
  const ids = versions.map(() => randomUUID());
  const heroes = await Promise.all(versions.map((v, i) => makeCharacter(ids[i]!, v.name)));
  const created = await call<GameState>(gamesApi.POST, '/api/games', {
    player: ids[0], appVersion: versions[0]!.appVersion, body: { characterId: heroes[0]!.id },
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const code = created.body.code;
  for (let i = 1; i < versions.length; i++) {
    const joined = await call(joinApi.POST, gamePath(code, 'join'), {
      player: ids[i], appVersion: versions[i]!.appVersion, body: { characterId: heroes[i]!.id },
    });
    assert.equal(joined.status, 200, JSON.stringify(joined.body));
  }
  return { code, ids };
}

const lobby = (code: string, player: string, appVersion: string | null = supportedAppVersionHeader()) =>
  call<GameState>(gameApi.GET, gamePath(code), { player, appVersion });

test('a versionless host is told to update, and the tale does not begin', async () => {
  const { code, ids } = await seat([{ name: 'Bryn', appVersion: null }]);
  const started = await call<{ error: string; code: string }>(startApi.POST, gamePath(code, 'start'), {
    player: ids[0], appVersion: null, body: { dungeon: 'none' },
  });
  assert.equal(started.status, 426);
  assert.equal(started.body.code, 'update_required');
  assert.equal(started.body.error, UPDATE_REQUIRED_MESSAGE);
  const view = await lobby(code, ids[0]!, null);
  assert.equal(view.body.status, 'lobby');
  assert.equal(view.body.players[0]!.appVersion, null);
  assert.equal(view.body.players[0]!.outdated, true);
});

test('a current host cannot begin a tale or a dungeon while someone else is behind, and the error names them', async () => {
  const current = supportedAppVersionHeader('0.2');
  const { code, ids } = await seat([
    { name: 'Bryn', appVersion: current },
    { name: 'Ilsa', appVersion: null },
  ]);
  for (const dungeon of ['none', 'fixed'] as const) {
    const started = await call<{ error: string; code: string }>(startApi.POST, gamePath(code, 'start'), {
      player: ids[0], body: { dungeon },
    });
    assert.equal(started.status, 409, dungeon);
    assert.equal(started.body.code, 'party_outdated');
    assert.match(started.body.error, /Ilsa needs to update the app before the adventure can begin/);
  }
  const view = await lobby(code, ids[0]!, current);
  assert.equal(view.body.status, 'lobby');
  const ilsa = view.body.players.find((p) => p.character.name === 'Ilsa')!;
  const bryn = view.body.players.find((p) => p.character.name === 'Bryn')!;
  assert.equal(ilsa.outdated, true);
  assert.equal(ilsa.appVersion, null);
  assert.equal(bryn.outdated, false);
  assert.equal(bryn.appVersion, current);
});

test('an old build is recorded, and once that player sends a current one the door opens', async () => {
  const old = outdatedAppVersionHeader();
  const { code, ids } = await seat([
    { name: 'Bryn', appVersion: supportedAppVersionHeader() },
    { name: 'Ilsa', appVersion: old },
  ]);
  const blocked = await call<{ error: string }>(startApi.POST, gamePath(code, 'start'), { player: ids[0], body: { dungeon: 'fixed' } });
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, /Ilsa/);
  let view = await lobby(code, ids[0]!);
  assert.equal(view.body.players.find((p) => p.character.name === 'Ilsa')!.appVersion, old);

  const seen = await lobby(code, ids[1]!, supportedAppVersionHeader('0.2'));
  assert.equal(seen.body.players.find((p) => p.character.name === 'Ilsa')!.outdated, false);
  const started = await call<GameState>(startApi.POST, gamePath(code, 'start'), { player: ids[0], body: { dungeon: 'none' } });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal(started.body.status, 'preparing');
  view = await lobby(code, ids[0]!);
  assert.notEqual(view.body.status, 'lobby');
});

test('a versionless vote is told to update and does not count, while chat still lands', async () => {
  const { code, ids } = await seat([
    { name: 'Bryn', appVersion: supportedAppVersionHeader() },
    { name: 'Ilsa', appVersion: supportedAppVersionHeader() },
  ]);
  const said = await call(messagesApi.POST, gamePath(code, 'messages'), {
    player: ids[1], appVersion: null, body: { text: 'Still here' },
  });
  assert.equal(said.status, 200);
  const voted = await call<{ error: string; code: string }>(voteApi.POST, gamePath(code, 'vote'), {
    player: ids[1], appVersion: null, body: { sceneIndex: 0, choiceId: 'a' },
  });
  assert.equal(voted.status, 426);
  assert.equal(voted.body.code, 'update_required');
  assert.equal(voted.body.error, UPDATE_REQUIRED_MESSAGE);
  const view = await lobby(code, ids[0]!);
  assert.equal(view.body.status, 'lobby');
  assert.equal(view.body.players.find((p) => p.character.name === 'Ilsa')!.outdated, true, 'the versionless chat was remembered');
  assert.equal(view.body.scene, null);
});
