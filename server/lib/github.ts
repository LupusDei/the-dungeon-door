import { HttpError, originOf } from './http.ts';
import { fakeGithubLogin } from './identity.ts';

/**
 * GitHub as the identity provider: send the visitor to GitHub, get a code back, and learn their
 * login. Nothing else is kept: no GitHub token is stored, and no scopes are requested beyond the
 * public profile.
 */

type Fetch = typeof fetch;
let githubFetch: Fetch = (...args) => fetch(...args);

/** Tests: stand in for GitHub's two endpoints. Call with no argument to restore the real ones. */
export function setGithubFetch(fn?: Fetch): void {
  githubFetch = fn ?? ((...args) => fetch(...args));
}

export const callbackUrl = (request: Request) => `${originOf(request)}/api/auth/callback`;

export function githubAuthorizeUrl(request: Request, state: string): string {
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', process.env.GITHUB_CLIENT_ID ?? '');
  url.searchParams.set('redirect_uri', callbackUrl(request));
  url.searchParams.set('state', state);
  url.searchParams.set('allow_signup', 'false');
  return url.toString();
}

/** Exchanges the code GitHub sent back for the visitor's GitHub login. */
export async function githubLoginFor(code: string, request: Request): Promise<string> {
  const fake = fakeGithubLogin();
  if (fake) return fake;
  const tokenResponse = await githubFetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: callbackUrl(request),
    }),
  });
  const token = (await tokenResponse.json().catch(() => ({}))) as { access_token?: string };
  if (!tokenResponse.ok || !token.access_token) throw new HttpError(502, 'GitHub did not accept that sign-in. Try again.');
  const userResponse = await githubFetch('https://api.github.com/user', {
    headers: { authorization: `Bearer ${token.access_token}`, accept: 'application/vnd.github+json', 'user-agent': 'the-dungeon-door' },
  });
  const user = (await userResponse.json().catch(() => ({}))) as { login?: string };
  if (!userResponse.ok || !user.login) throw new HttpError(502, 'GitHub did not say who signed in. Try again.');
  return user.login;
}
