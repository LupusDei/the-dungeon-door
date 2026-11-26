import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { beforeEach, test } from 'node:test';
import * as auth from '../api/auth.ts';
import * as oauth from '../api/oauth.ts';
import * as questMeta from '../api/quest-meta.ts';
import * as questsApi from '../api/quests.ts';
import { resetAuthStore } from './authstore.ts';
import { setGithubFetch } from './github.ts';
import { quests, resetQuests } from './quests.ts';

const SITE = 'https://quest.test';
let githubSays = 'unclebob';

beforeEach(async () => {
  delete process.env.DATABASE_URL;
  delete process.env.QUEST_KEYS;
  delete process.env.DD_FAKE_GITHUB_LOGIN;
  process.env.GITHUB_CLIENT_ID = 'test-client';
  process.env.GITHUB_CLIENT_SECRET = 'test-secret';
  process.env.SESSION_SECRET = 'test-session-secret';
  githubSays = 'unclebob';
  setGithubFetch(async (input) =>
    String(input).includes('access_token') ? Response.json({ access_token: 'gho_test' }) : Response.json({ login: githubSays }));
  resetAuthStore();
  resetQuests();
  await quests().setMeta({
    summary: 'test', facts: [],
    milestones: [{ id: 'door', name: 'The Door', blurb: '' }, { id: 'armory', name: 'The Armory', blurb: '' }],
    areas: [{ id: 'rules', name: 'Rules engine' }],
  });
});

const get = (path: string, headers: Record<string, string> = {}) => new Request(SITE + path, { headers });
const cookieOf = (response: Response) => (response.headers.get('set-cookie') ?? '').split(';')[0];

/** Signs in through the (stand-in) GitHub round trip and returns the session cookie. */
async function signIn(login: string, returnTo = '/admin'): Promise<string> {
  githubSays = login;
  const start = await auth.GET(get(`/api/auth/login?return=${encodeURIComponent(returnTo)}`));
  assert.equal(start.status, 302);
  const github = new URL(start.headers.get('location')!);
  assert.equal(github.origin + github.pathname, 'https://github.com/login/oauth/authorize');
  assert.equal(github.searchParams.get('redirect_uri'), `${SITE}/api/auth/callback`);
  const back = await auth.GET(get(`/api/auth/callback?code=abc&state=${github.searchParams.get('state')}`));
  assert.equal(back.status, 302);
  assert.equal(back.headers.get('location'), returnTo);
  const cookie = cookieOf(back);
  assert.match(back.headers.get('set-cookie')!, /HttpOnly; SameSite=Lax; .*Secure/);
  return cookie;
}

const me = async (cookie?: string) => (await auth.GET(get('/api/auth/me', cookie ? { cookie } : {}))).json();

test('GitHub sign-in gives a team member a session; the state works once', async () => {
  const cookie = await signIn('UncleBob'); // GitHub logins are case-insensitive
  const who = await me(cookie);
  assert.equal(who.person.id, 'unclebob');
  assert.equal(who.person.role, 'admin');
  assert.equal(who.githubSignIn, true);
  assert.equal((await me()).person, null);

  const replay = await auth.GET(get('/api/auth/callback?code=abc&state=ddstate_nope'));
  assert.equal(replay.headers.get('location'), '/admin?signin=failed');
  assert.equal(replay.headers.get('set-cookie'), null);
});

test('a forged or tampered session cookie is nobody', async () => {
  const cookie = await signIn('unclebob');
  const [payload, mac] = cookie.slice('dd_session='.length).split('.');
  const forged = Buffer.from(JSON.stringify({ login: 'LupusDei', exp: 9999999999 })).toString('base64url');
  assert.equal((await me(`dd_session=${forged}.${mac}`)).person, null);
  assert.equal((await me(`dd_session=${payload}.${mac.slice(0, -2)}xx`)).person, null);
});

test('someone not on the team can sign in but cannot change anything', async () => {
  const cookie = await signIn('mallory');
  const who = await me(cookie);
  assert.equal(who.signedInAs, 'mallory');
  assert.equal(who.onTeam, false);
  const write = await questsApi.POST(new Request(`${SITE}/api/quests`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/json', 'x-requested-with': 'dungeon-door' }, body: '{"title":"x"}' }));
  assert.equal(write.status, 401);
});

test('a session can change the board only from the site itself', async () => {
  const cookie = await signIn('slagyr');
  const body = JSON.stringify({ title: 'From the admin portal', area: 'rules' });
  const crossSite = await questsApi.POST(new Request(`${SITE}/api/quests`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body }));
  assert.equal(crossSite.status, 403);
  const ok = await questsApi.POST(new Request(`${SITE}/api/quests`, { method: 'POST', headers: { cookie, 'content-type': 'application/json', 'x-requested-with': 'dungeon-door' }, body }));
  assert.equal(ok.status, 201);
  assert.equal((await ok.json()).createdBy, 'slagyr');
});

test('the return address after sign-in can only be a page on this site', async () => {
  for (const evil of ['https://evil.example/', '//evil.example', '/\\evil.example']) {
    githubSays = 'slagyr';
    const start = await auth.GET(get(`/api/auth/login?return=${encodeURIComponent(evil)}`));
    const state = new URL(start.headers.get('location')!).searchParams.get('state');
    const back = await auth.GET(get(`/api/auth/callback?code=abc&state=${state}`));
    assert.equal(back.headers.get('location'), '/admin', evil);
  }
});

test('admins reshape the board; members cannot; removing a level frees its tasks', async () => {
  const admin = await signIn('LupusDei');
  const member = await signIn('slagyr-assistant');
  const put = (cookie: string, body: unknown) => questMeta.PUT(new Request(`${SITE}/api/quest-meta`, {
    method: 'PUT', headers: { cookie, 'content-type': 'application/json', 'x-requested-with': 'dungeon-door' }, body: JSON.stringify(body) }));

  assert.equal((await put(member, { summary: 'nope' })).status, 403);

  await quests().put({ id: 't1', title: 'In the armory', area: 'rules', milestone: 'armory', status: 'todo', owner: '', notes: '', link: '',
    createdAt: 'x', updatedAt: 'x', lastChange: 'added', createdBy: 'LupusDei', updatedBy: 'LupusDei' });
  const saved = await put(admin, {
    summary: 'New headline',
    milestones: [{ id: 'door', name: 'The Door', blurb: 'first' }, { name: 'The Hall of Voices', blurb: 'new' }],
    facts: [{ label: 'Latest build', value: 'TestFlight 0.1 (4)' }],
  });
  assert.equal(saved.status, 200);
  const board = await saved.json();
  assert.deepEqual(board.meta.milestones.map((m: { id: string }) => m.id), ['door', 'the-hall-of-voices']);
  assert.equal(board.meta.areas.length, 1, 'sections not sent are left alone');
  assert.equal(board.tasks[0].milestone, '', 'the removed level no longer holds the task');
  assert.equal(board.tasks[0].area, 'rules');

  assert.equal((await put(admin, { facts: [{ label: 'x', value: 'y', href: 'http://insecure' }] })).status, 400);
});

// ---- the OAuth server MCP clients use ----

const pkce = () => {
  const verifier = 'v'.repeat(64);
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};

async function register(redirect = 'http://localhost:7777/callback') {
  const response = await oauth.POST(new Request(`${SITE}/api/oauth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Test <b>Client</b>', redirect_uris: [redirect] }) }));
  assert.equal(response.status, 201);
  return (await response.json()) as { client_id: string };
}

const authorizeUrl = (clientId: string, extra: Record<string, string> = {}) => {
  const url = new URL(`${SITE}/api/oauth/authorize`);
  const params = { response_type: 'code', client_id: clientId, redirect_uri: 'http://localhost:7777/callback', state: 'xyz',
    code_challenge: pkce().challenge, code_challenge_method: 'S256', resource: `${SITE}/api/mcp`, ...extra };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.pathname + url.search;
};

const form = (path: string, fields: Record<string, string>, headers: Record<string, string> = {}) =>
  oauth.POST(new Request(SITE + path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(fields) }));

/** Runs authorize → sign in → approve, returning the code the client would receive. */
async function approve(login: string, clientId: string, port = '7777'): Promise<{ code: string; cookie: string }> {
  const started = await oauth.GET(get(authorizeUrl(clientId, { redirect_uri: `http://localhost:${port}/callback` })));
  assert.equal(started.status, 302);
  const loginHop = started.headers.get('location')!;
  assert.match(loginHop, /^\/api\/auth\/login\?return=/);
  const consentPath = decodeURIComponent(loginHop.split('return=')[1]);
  const cookie = await signIn(login, consentPath);
  const screen = await oauth.GET(get(consentPath, { cookie }));
  const html = await screen.text();
  assert.equal(screen.status, 200);
  assert.match(html, /Test &lt;b&gt;Client&lt;\/b&gt;/, 'the client name is escaped');
  assert.equal(screen.headers.get('x-frame-options'), 'DENY');
  const request = consentPath.split('request=')[1];
  const answered = await form('/api/oauth/consent', { request, decision: 'allow' }, { cookie, origin: SITE });
  assert.equal(answered.status, 303);
  const back = new URL(answered.headers.get('location')!);
  assert.equal(back.origin, `http://localhost:${port}`);
  assert.equal(back.searchParams.get('state'), 'xyz');
  assert.equal(back.searchParams.get('iss'), SITE);
  return { code: back.searchParams.get('code')!, cookie };
}

test('discovery documents say where to sign in', async () => {
  const resource = await (await oauth.GET(get('/.well-known/oauth-protected-resource/api/mcp'))).json();
  assert.equal(resource.resource, `${SITE}/api/mcp`);
  assert.deepEqual(resource.authorization_servers, [SITE]);
  const server = await (await oauth.GET(get('/.well-known/oauth-authorization-server'))).json();
  assert.equal(server.issuer, SITE);
  assert.equal(server.registration_endpoint, `${SITE}/api/oauth/register`);
  assert.deepEqual(server.code_challenge_methods_supported, ['S256']);
});

test('the whole flow: register, sign in with GitHub, approve, get tokens, use them, refresh them', async () => {
  const { client_id } = await register();
  const { code } = await approve('unclebob', client_id, '54321'); // loopback clients may use any port
  const exchange = (fields: Record<string, string>) => form('/api/oauth/token', { client_id, ...fields });

  const wrongVerifier = await exchange({ grant_type: 'authorization_code', code, redirect_uri: 'http://localhost:54321/callback', code_verifier: 'w'.repeat(64) });
  assert.equal(wrongVerifier.status, 400);
  assert.equal((await wrongVerifier.json()).error, 'invalid_grant');
  // A failed attempt burns the code: it cannot be tried again with the right verifier.
  const burnt = await exchange({ grant_type: 'authorization_code', code, redirect_uri: 'http://localhost:54321/callback', code_verifier: pkce().verifier });
  assert.equal(burnt.status, 400);

  const second = await approve('unclebob', client_id);
  const granted = await exchange({ grant_type: 'authorization_code', code: second.code, redirect_uri: 'http://localhost:7777/callback', code_verifier: pkce().verifier });
  assert.equal(granted.status, 200);
  const tokens = await granted.json();
  assert.equal(tokens.token_type, 'Bearer');
  assert.equal(granted.headers.get('cache-control'), 'no-store');

  const write = await questsApi.POST(new Request(`${SITE}/api/quests`, {
    method: 'POST', headers: { authorization: `Bearer ${tokens.access_token}`, 'content-type': 'application/json' }, body: '{"title":"Added by an MCP client"}' }));
  assert.equal(write.status, 201);
  assert.equal((await write.json()).createdBy, 'unclebob');

  const refreshed = await exchange({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
  assert.equal(refreshed.status, 200);
  assert.notEqual((await refreshed.json()).refresh_token, tokens.refresh_token, 'refresh tokens rotate');
  assert.equal((await exchange({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token })).status, 400, 'an old refresh token is dead');
  assert.equal((await form('/api/oauth/token', { client_id: 'someone-else', grant_type: 'refresh_token', refresh_token: 'ddr_x' })).status, 400);
});

test('the server refuses the usual tricks', async () => {
  const { client_id } = await register();

  const unknownClient = await oauth.GET(get(authorizeUrl('ddclient_nope')));
  assert.equal(unknownClient.status, 400);
  assert.equal(unknownClient.headers.get('location'), null, 'never redirects for an unknown client');

  const strayRedirect = await oauth.GET(get(authorizeUrl(client_id, { redirect_uri: 'https://evil.example/callback' })));
  assert.equal(strayRedirect.status, 400);
  assert.equal(strayRedirect.headers.get('location'), null, 'never redirects to an unregistered address');

  const noPkce = await oauth.GET(get(authorizeUrl(client_id, { code_challenge_method: 'plain' })));
  assert.equal(new URL(noPkce.headers.get('location')!).searchParams.get('error'), 'invalid_request');

  const wrongAudience = await oauth.GET(get(authorizeUrl(client_id, { resource: 'https://other.example/mcp' })));
  assert.equal(new URL(wrongAudience.headers.get('location')!).searchParams.get('error'), 'invalid_target');

  for (const bad of ['javascript:alert(1)', 'http://evil.example/cb', 'https://ok.example/cb#frag']) {
    const response = await oauth.POST(new Request(`${SITE}/api/oauth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: [bad] }) }));
    assert.equal(response.status, 400, bad);
  }
});

test('approval is never silent: denying, outsiders and cross-site posts all end without a code', async () => {
  const { client_id } = await register();
  const start = async (login: string) => {
    const started = await oauth.GET(get(authorizeUrl(client_id)));
    const consentPath = decodeURIComponent(started.headers.get('location')!.split('return=')[1]);
    return { consentPath, cookie: await signIn(login, consentPath), request: consentPath.split('request=')[1] };
  };

  const denied = await start('slagyr');
  const no = await form('/api/oauth/consent', { request: denied.request, decision: 'deny' }, { cookie: denied.cookie });
  assert.equal(new URL(no.headers.get('location')!).searchParams.get('error'), 'access_denied');

  const outsider = await start('mallory');
  const screen = await oauth.GET(get(outsider.consentPath, { cookie: outsider.cookie }));
  assert.equal(screen.status, 403);
  const forced = await form('/api/oauth/consent', { request: outsider.request, decision: 'allow' }, { cookie: outsider.cookie });
  assert.equal(new URL(forced.headers.get('location')!).searchParams.get('error'), 'access_denied');
  assert.equal(new URL(forced.headers.get('location')!).searchParams.get('code'), null);

  const crossSite = await start('slagyr');
  const posted = await form('/api/oauth/consent', { request: crossSite.request, decision: 'allow' }, { cookie: crossSite.cookie, origin: 'https://evil.example' });
  assert.equal(posted.status, 403);

  const signedOut = await start('slagyr');
  const noSession = await form('/api/oauth/consent', { request: signedOut.request, decision: 'allow' });
  assert.equal(noSession.status, 401);
});
