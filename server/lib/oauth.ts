import { createHash, timingSafeEqual } from 'node:crypto';
import { authStore, randomToken, sha256 } from './authstore.ts';
import { HttpError, originOf, readBody } from './http.ts';
import { githubConfigured, issueTokens, sessionLogin } from './identity.ts';
import { personByLogin } from './quests.ts';

/**
 * A small OAuth 2.1 authorization server for the MCP endpoint, so MCP clients (Claude Code, Cursor
 * and the like) can sign a team member in. GitHub can't play this part itself: it has no discovery
 * document, no client registration and no audience-bound tokens. So this server registers clients
 * (RFC 7591), sends the person to GitHub to prove who they are, asks them to approve the client,
 * and then issues its own short-lived tokens bound to /api/mcp.
 *
 * Deliberately narrow: public clients only, PKCE (S256) required, exact redirect matching, one
 * scope, single-use codes, rotating refresh tokens, and a consent screen for every authorization,
 * because any app can register itself and must never be approved silently.
 */

export const SCOPE = 'quests';
const CLIENT_TTL = 90 * 86400;
const PENDING_TTL = 600;
const CODE_TTL = 300;

export const mcpUrl = (request: Request) => `${originOf(request)}/api/mcp`;

interface Client {
  clientId: string;
  name: string;
  redirectUris: string[];
}

interface Pending {
  clientId: string;
  clientName: string;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
}

interface Code extends Omit<Pending, 'clientName' | 'state'> {
  login: string;
  resource: string;
}

export function serverMetadata(request: Request) {
  const origin = originOf(request);
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/api/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [SCOPE],
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${origin}/admin`,
  };
}

/** OAuth error responses are `{ error, error_description }` (RFC 6749 §5.2). */
export class OAuthProblem extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, description: string, status = 400) {
    super(description);
    this.code = code;
    this.status = status;
  }
  toResponse(): Response {
    return Response.json({ error: this.code, error_description: this.message }, { status: this.status, headers: { 'cache-control': 'no-store', ...CORS } });
  }
}

export const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization, mcp-protocol-version',
};

// ---- client registration ----

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const BANNED_SCHEMES = new Set(['javascript:', 'data:', 'file:', 'vbscript:', 'about:', 'blob:']);

function checkedRedirect(value: unknown): string {
  if (typeof value !== 'string' || value.length > 500) throw new OAuthProblem('invalid_redirect_uri', 'redirect_uris must be URLs');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OAuthProblem('invalid_redirect_uri', `not a URL: ${value.slice(0, 80)}`);
  }
  if (url.hash) throw new OAuthProblem('invalid_redirect_uri', 'redirect URIs must not have a fragment');
  if (url.protocol === 'https:') return value;
  if (url.protocol === 'http:') {
    if (LOOPBACK.has(url.hostname)) return value;
    throw new OAuthProblem('invalid_redirect_uri', 'http redirect URIs are only allowed on localhost');
  }
  if (BANNED_SCHEMES.has(url.protocol)) throw new OAuthProblem('invalid_redirect_uri', 'that URL scheme is not allowed');
  return value; // an app's own scheme, e.g. cursor://…
}

export async function registerClient(request: Request): Promise<Response> {
  const body = await readBody(request).catch(() => {
    throw new OAuthProblem('invalid_client_metadata', 'the body must be a JSON object');
  });
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || uris.length < 1 || uris.length > 10) {
    throw new OAuthProblem('invalid_redirect_uri', 'redirect_uris must list between 1 and 10 URLs');
  }
  const method = body.token_endpoint_auth_method ?? 'none';
  if (method !== 'none') throw new OAuthProblem('invalid_client_metadata', 'only public clients (token_endpoint_auth_method "none") are supported');
  const client: Client = {
    clientId: randomToken('ddclient', 18),
    name: typeof body.client_name === 'string' && body.client_name.trim() ? body.client_name.trim().slice(0, 80) : 'An MCP client',
    redirectUris: uris.map(checkedRedirect),
  };
  await authStore().put('client', client.clientId, { ...client }, CLIENT_TTL);
  return Response.json(
    {
      client_id: client.clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: client.name,
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
    { status: 201, headers: { 'cache-control': 'no-store', ...CORS } },
  );
}

/** Exact match, except that a loopback redirect may use any port (RFC 8252 §7.3). */
function redirectAllowed(client: Client, given: string): boolean {
  if (client.redirectUris.includes(given)) return true;
  try {
    const want = new URL(given);
    if (want.protocol !== 'http:' || !LOOPBACK.has(want.hostname)) return false;
    return client.redirectUris.some((registered) => {
      const have = new URL(registered);
      return have.protocol === 'http:' && have.hostname === want.hostname && have.pathname === want.pathname && have.search === want.search;
    });
  } catch {
    return false;
  }
}

// ---- pages ----

const esc = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — The Dungeon Door</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #120e0a; color: #eadbc0; font: 16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; padding: 24px; box-sizing: border-box; }
  main { width: min(460px, 100%); border: 1px solid #3b2f22; border-radius: 16px; background: #1b150f; padding: 28px; }
  h1 { font: 700 1.35rem/1.25 Georgia, serif; margin: 0 0 12px; color: #d9a649; }
  p { margin: 0 0 12px; } .muted { color: #a8957a; font-size: 14px; }
  ul { margin: 0 0 16px; padding-left: 20px; color: #a8957a; }
  code { background: #120e0a; border: 1px solid #3b2f22; border-radius: 6px; padding: 1px 6px; font-size: 13px; overflow-wrap: anywhere; }
  .who { display: flex; align-items: center; gap: 12px; margin: 16px 0; }
  .who img { width: 44px; height: 44px; border-radius: 50%; border: 1px solid #3b2f22; }
  form { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 20px; }
  button, a.btn { font: inherit; font-weight: 600; border-radius: 10px; padding: 10px 18px; cursor: pointer; border: 1px solid #3b2f22; background: #261e15; color: #eadbc0; text-decoration: none; }
  button.go { background: linear-gradient(180deg, #f0c66b, #d9a649 55%, #a87a2c); border-color: transparent; color: #1a1206; }
</style></head><body><main>${body}</main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      // The approval screen must never be framed by another site.
      'x-frame-options': 'DENY',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src https://github.com https://avatars.githubusercontent.com; frame-ancestors 'none'; base-uri 'none'",
      'referrer-policy': 'no-referrer',
    },
  });
}

const problemPage = (message: string, status = 400) =>
  page('Sign-in problem', `<h1>That didn't work</h1><p>${esc(message)}</p><p class="muted">Go back to the app you were connecting and start again.</p>`, status);

function redirectBack(redirectUri: string, params: Record<string, string | null>, request: Request): Response {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) if (value != null) url.searchParams.set(key, value);
  url.searchParams.set('iss', originOf(request));
  return new Response(null, { status: 303, headers: { location: url.toString(), 'cache-control': 'no-store' } });
}

const loginRedirect = (returnTo: string) =>
  new Response(null, { status: 302, headers: { location: `/api/auth/login?return=${encodeURIComponent(returnTo)}`, 'cache-control': 'no-store' } });

// ---- authorize → consent → code ----

export async function authorize(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams;
  const client = await authStore().get<Client>('client', q.get('client_id') ?? '');
  if (!client) return problemPage('This app is not registered here. It needs to register before asking you to sign in.');
  const redirectUri = q.get('redirect_uri') ?? '';
  if (!redirectAllowed(client, redirectUri)) return problemPage('This app asked to send you somewhere it did not register.');

  const state = q.get('state');
  const refuse = (error: string, description: string) => redirectBack(redirectUri, { error, error_description: description, state }, request);
  if (q.get('response_type') !== 'code') return refuse('unsupported_response_type', 'only response_type=code is supported');
  const challenge = q.get('code_challenge') ?? '';
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(challenge) || q.get('code_challenge_method') !== 'S256') {
    return refuse('invalid_request', 'PKCE with code_challenge_method=S256 is required');
  }
  const resource = q.get('resource');
  if (resource && resource.replace(/\/$/, '') !== mcpUrl(request)) return refuse('invalid_target', `this server only issues tokens for ${mcpUrl(request)}`);
  if (!githubConfigured()) return problemPage('GitHub sign-in has not been set up on this site yet. Use a personal quest key instead.', 503);

  const id = randomToken('ddreq', 24);
  const pending: Pending = { clientId: client.clientId, clientName: client.name, redirectUri, state, codeChallenge: challenge };
  await authStore().put('pending', id, { ...pending }, PENDING_TTL);
  await authStore().put('client', client.clientId, { ...client }, CLIENT_TTL); // still in use: keep it
  const consent = `/api/oauth/consent?request=${id}`;
  return sessionLogin(request)
    ? new Response(null, { status: 302, headers: { location: consent, 'cache-control': 'no-store' } })
    : loginRedirect(consent);
}

function redirectHost(uri: string): string {
  const url = new URL(uri);
  return url.protocol === 'https:' || url.protocol === 'http:' ? url.host : `${url.protocol}//…`;
}

export async function consentPage(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get('request') ?? '';
  const pending = await authStore().get<Pending>('pending', id);
  if (!pending) return problemPage('This sign-in request has expired.');
  const login = sessionLogin(request);
  if (!login) return loginRedirect(`/api/oauth/consent?request=${id}`);
  const person = personByLogin(login);
  const hidden = `<input type="hidden" name="request" value="${esc(id)}">`;
  if (!person) {
    return page('Not on the team', `<h1>Not on the team</h1>
      <p>You're signed in to GitHub as <strong>${esc(login)}</strong>, who isn't a member of The Dungeon Door team, so there is nothing to connect.</p>
      <form method="post" action="/api/oauth/consent">${hidden}<button name="decision" value="deny">Go back to ${esc(pending.clientName)}</button></form>`, 403);
  }
  const extra = person.role === 'admin' ? '<li>Reshape the board: levels, workstreams and the headline</li>' : '';
  return page('Connect an app', `<h1>Connect ${esc(pending.clientName)}?</h1>
    <div class="who"><img src="${esc(person.avatar)}" alt=""><div><strong>${esc(person.name)}</strong><div class="muted">signed in with GitHub as ${esc(person.id)}</div></div></div>
    <p><strong>${esc(pending.clientName)}</strong> wants to use The Dungeon Door quest log as you. It will be able to:</p>
    <ul><li>Read the whole board</li><li>Add, change and delete tasks</li>${extra}</ul>
    <p class="muted">Everything it does is recorded under your name. You'll be sent back to <code>${esc(redirectHost(pending.redirectUri))}</code>. Only allow this if you started it yourself.</p>
    <form method="post" action="/api/oauth/consent">${hidden}
      <button class="go" name="decision" value="allow">Allow</button><button name="decision" value="deny">Deny</button></form>`);
}

export async function decideConsent(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  if (origin && origin !== originOf(request)) throw new HttpError(403, 'This form must be sent from this site.');
  const form = new URLSearchParams(await request.text());
  const id = form.get('request') ?? '';
  const login = sessionLogin(request);
  if (!login) return problemPage('Your sign-in has expired.', 401);
  const pending = await authStore().take<Pending>('pending', id);
  if (!pending) return problemPage('This sign-in request has expired or was already answered.');
  const person = personByLogin(login);
  if (!person || form.get('decision') !== 'allow') {
    return redirectBack(pending.redirectUri, { error: 'access_denied', error_description: 'The request was not approved.', state: pending.state }, request);
  }
  const code = randomToken('ddcode', 24);
  const record: Code = { clientId: pending.clientId, redirectUri: pending.redirectUri, codeChallenge: pending.codeChallenge, login: person.id, resource: mcpUrl(request) };
  await authStore().put('code', sha256(code), { ...record }, CODE_TTL);
  return redirectBack(pending.redirectUri, { code, state: pending.state }, request);
}

// ---- token ----

async function tokenParams(request: Request): Promise<URLSearchParams> {
  const text = await request.text();
  if ((request.headers.get('content-type') ?? '').includes('application/json')) {
    try {
      return new URLSearchParams(Object.entries(JSON.parse(text) as Record<string, unknown>).map(([k, v]) => [k, String(v)]));
    } catch {
      throw new OAuthProblem('invalid_request', 'the body is not valid JSON');
    }
  }
  return new URLSearchParams(text);
}

export async function token(request: Request): Promise<Response> {
  const p = await tokenParams(request);
  const clientId = p.get('client_id') ?? '';
  const grantType = p.get('grant_type');
  const done = (tokens: unknown) => Response.json(tokens, { headers: { 'cache-control': 'no-store', pragma: 'no-cache', ...CORS } });

  if (grantType === 'authorization_code') {
    const record = await authStore().take<Code>('code', sha256(p.get('code') ?? ''));
    if (!record || record.clientId !== clientId) throw new OAuthProblem('invalid_grant', 'that code is not valid (codes work once and expire after five minutes)');
    if (p.get('redirect_uri') !== record.redirectUri) throw new OAuthProblem('invalid_grant', 'redirect_uri does not match the one used to sign in');
    const expected = Buffer.from(record.codeChallenge);
    const given = Buffer.from(createHash('sha256').update(p.get('code_verifier') ?? '').digest('base64url'));
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new OAuthProblem('invalid_grant', 'code_verifier does not match the code_challenge');
    return done(await issueTokens({ login: record.login, clientId, scope: SCOPE, resource: record.resource }));
  }

  if (grantType === 'refresh_token') {
    const record = await authStore().take<{ login: string; clientId: string; scope: string; resource: string }>('refresh', sha256(p.get('refresh_token') ?? ''));
    if (!record || record.clientId !== clientId) throw new OAuthProblem('invalid_grant', 'that refresh token is not valid; sign in again');
    if (!personByLogin(record.login)) throw new OAuthProblem('invalid_grant', 'that account is no longer on the team');
    return done(await issueTokens(record));
  }

  throw new OAuthProblem('unsupported_grant_type', 'use authorization_code or refresh_token');
}
