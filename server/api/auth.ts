import { authStore, randomToken } from '../lib/authstore.ts';
import { githubAuthorizeUrl, githubLoginFor } from '../lib/github.ts';
import { HttpError, handle } from '../lib/http.ts';
import { clearedSessionCookie, fakeGithubLogin, githubConfigured, identify, sessionCookie, sessionLogin } from '../lib/identity.ts';

/**
 * Signing in to the website with GitHub (see lib/identity.ts). vercel.json maps these paths here:
 *
 *   GET  /api/auth/login?return=/admin    off to GitHub, then back to `return`
 *   GET  /api/auth/callback               where GitHub sends the visitor back
 *   GET  /api/auth/me                     who is signed in, and whether GitHub sign-in is set up
 *   POST /api/auth/logout
 */
const actionOf = (request: Request): string => {
  const url = new URL(request.url);
  return url.searchParams.get('action') ?? url.pathname.match(/\/api\/auth\/([a-z]+)/)?.[1] ?? '';
};

/** Only ever send the visitor back to a page on this site. */
const safeReturn = (value: string | null): string => (value && /^\/(?![/\\])/.test(value) ? value : '/admin');

const redirect = (location: string, cookie?: string) =>
  new Response(null, { status: 302, headers: { location, 'cache-control': 'no-store', ...(cookie ? { 'set-cookie': cookie } : {}) } });

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const url = new URL(request.url);
    const action = actionOf(request);

    if (action === 'me') {
      const identity = await identify(request);
      const login = sessionLogin(request);
      return Response.json(
        { githubSignIn: githubConfigured(), person: identity?.person ?? null, via: identity?.via ?? null, signedInAs: login, onTeam: Boolean(identity) },
        { headers: { 'cache-control': 'no-store' } },
      );
    }

    if (action === 'login') {
      if (!githubConfigured()) throw new HttpError(503, 'GitHub sign-in has not been set up on this site yet.');
      const returnTo = safeReturn(url.searchParams.get('return'));
      const fake = fakeGithubLogin();
      if (fake) return redirect(returnTo, sessionCookie(fake, request));
      const state = randomToken('ddstate', 24);
      await authStore().put('state', state, { returnTo }, 600);
      return redirect(githubAuthorizeUrl(request, state));
    }

    if (action === 'callback') {
      const saved = await authStore().take<{ returnTo: string }>('state', url.searchParams.get('state') ?? '');
      const code = url.searchParams.get('code');
      if (!saved || !code) return redirect('/admin?signin=failed');
      const login = await githubLoginFor(code, request);
      // Anyone can sign in; only team members can do anything. The pages say which you are.
      return redirect(safeReturn(saved.returnTo), sessionCookie(login, request));
    }

    return Response.json({ error: 'not found' }, { status: 404 });
  });
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    if (actionOf(request) !== 'logout') return Response.json({ error: 'not found' }, { status: 404 });
    return Response.json({ ok: true }, { headers: { 'set-cookie': clearedSessionCookie(), 'cache-control': 'no-store' } });
  });
}
