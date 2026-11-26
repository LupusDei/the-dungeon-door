import { createHmac, timingSafeEqual } from 'node:crypto';
import { authStore, randomToken, sha256 } from './authstore.ts';
import { HttpError, originOf } from './http.ts';
import { type Person, personByLogin, personForKey } from './quests.ts';

/**
 * Who is making this request? Three ways to prove you are one of the team:
 *
 *  1. A browser session: signed in with GitHub on the website (an HttpOnly cookie).
 *  2. A bearer token: an MCP access token issued by lib/oauth.ts, or a personal quest key.
 *  3. The `x-quest-key` header: a personal quest key, for scripts.
 *
 * GitHub sign-in needs a GitHub OAuth app: GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET, with the
 * callback URL `<site>/api/auth/callback`. Sessions are signed with SESSION_SECRET.
 */

export const SESSION_COOKIE = 'dd_session';
const SESSION_DAYS = 30;

const isLocalDev = () => !process.env.DATABASE_URL && !process.env.VERCEL;

/** Local dev only: pretend GitHub said the visitor is this login, so sign-in can be tested offline. */
export const fakeGithubLogin = (): string | null => (isLocalDev() ? process.env.DD_FAKE_GITHUB_LOGIN || null : null);

export const githubConfigured = (): boolean =>
  Boolean(fakeGithubLogin() || (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET && sessionSecret()));

function sessionSecret(): string | null {
  return process.env.SESSION_SECRET || (isLocalDev() ? 'local-dev-session-secret' : null);
}

// ---- session cookie ----

const sign = (payload: string, secret: string) => createHmac('sha256', secret).update(payload).digest('base64url');

export function sessionCookie(login: string, request: Request): string {
  const secret = sessionSecret();
  if (!secret) throw new HttpError(503, 'Sign-in is not set up yet.');
  const payload = Buffer.from(JSON.stringify({ login, exp: Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400 })).toString('base64url');
  const secure = originOf(request).startsWith('https://') ? '; Secure' : '';
  return `${SESSION_COOKIE}=${payload}.${sign(payload, secret)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`;
}

export const clearedSessionCookie = () => `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

/** The GitHub login in a valid session cookie, whoever that is (possibly not on the team). */
export function sessionLogin(request: Request): string | null {
  const secret = sessionSecret();
  const raw = (request.headers.get('cookie') ?? '').split(/;\s*/).find((c) => c.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  if (!secret || !raw) return null;
  const [payload, mac] = raw.split('.');
  if (!payload || !mac) return null;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const { login, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof login === 'string' && typeof exp === 'number' && exp > Date.now() / 1000 ? login : null;
  } catch {
    return null;
  }
}

// ---- access tokens (issued by lib/oauth.ts) ----

export interface AccessGrant {
  login: string;
  clientId: string;
  scope: string;
  resource: string;
  /** Seconds since epoch. */
  expiresAt: number;
}

export const ACCESS_TTL = 3600;
export const REFRESH_TTL = 60 * 86400;

export async function issueTokens(grant: Omit<AccessGrant, 'expiresAt'>) {
  const access = randomToken('ddm');
  const refresh = randomToken('ddr');
  const expiresAt = Math.floor(Date.now() / 1000) + ACCESS_TTL;
  await authStore().put('access', sha256(access), { ...grant, expiresAt }, ACCESS_TTL);
  await authStore().put('refresh', sha256(refresh), { ...grant }, REFRESH_TTL);
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL, refresh_token: refresh, scope: grant.scope };
}

export const accessGrant = (token: string) => authStore().get<AccessGrant>('access', sha256(token));

// ---- putting it together ----

export interface Identity {
  person: Person;
  via: 'session' | 'token' | 'key';
}

export async function identify(request: Request): Promise<Identity | null> {
  const key = request.headers.get('x-quest-key');
  if (key) {
    const person = personForKey(key);
    return person ? { person, via: 'key' } : null;
  }
  const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) {
    const byKey = personForKey(bearer);
    if (byKey) return { person: byKey, via: 'key' };
    const grant = await accessGrant(bearer);
    const person = grant ? personByLogin(grant.login) : null;
    return person ? { person, via: 'token' } : null;
  }
  const person = personByLogin(sessionLogin(request));
  return person ? { person, via: 'session' } : null;
}

/**
 * The team member making this request, or a 401. Browser sessions must also send the
 * `x-requested-with` header on anything that changes data: a page on another site can't add it,
 * so a signed-in visitor can't be tricked into making changes from elsewhere.
 */
export async function requirePerson(request: Request): Promise<Person> {
  const identity = await identify(request);
  if (!identity) throw new HttpError(401, 'Sign in as a team member (GitHub sign-in, an access token or a quest key) to change the quest log.');
  if (identity.via === 'session' && request.method !== 'GET' && request.method !== 'HEAD' && !request.headers.get('x-requested-with')) {
    throw new HttpError(403, 'This request must come from the website itself.');
  }
  return identity.person;
}
