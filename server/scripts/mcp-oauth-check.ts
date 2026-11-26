/**
 * Local check that a real MCP client can sign in through this site's OAuth flow: the SDK client
 * discovers the server, registers itself, and asks to authorize; this script then plays the browser
 * (GitHub sign-in is the dev stand-in, DD_FAKE_GITHUB_LOGIN) and approves on the consent screen.
 *
 *   DD_FAKE_GITHUB_LOGIN=unclebob npm run dev      # in one terminal
 *   node --experimental-strip-types scripts/mcp-oauth-check.ts
 */
import { strict as assert } from 'node:assert';
import { Client, type OAuthClientProvider, StreamableHTTPClientTransport, UnauthorizedError } from '@modelcontextprotocol/client';

const base = process.argv[2] ?? 'http://localhost:3000';
const redirect = 'http://localhost:8976/callback';

let authorizationUrl: URL | undefined;
const saved: { client?: any; tokens?: any; verifier?: string } = {};
const provider: OAuthClientProvider = {
  get redirectUrl() { return redirect; },
  get clientMetadata() {
    return { client_name: 'OAuth interop check', redirect_uris: [redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' };
  },
  clientInformation: () => saved.client,
  saveClientInformation: (info) => { saved.client = info; },
  tokens: () => saved.tokens,
  saveTokens: (tokens) => { saved.tokens = tokens; },
  redirectToAuthorization: (url) => { authorizationUrl = url; },
  saveCodeVerifier: (verifier) => { saved.verifier = verifier; },
  codeVerifier: () => saved.verifier!,
};

const transport = new StreamableHTTPClientTransport(new URL('/api/mcp', base), { authProvider: provider });
try {
  await new Client({ name: 'oauth-interop-check', version: '1.0.0' }).connect(transport);
  assert.fail('the server should have asked the client to sign in');
} catch (error) {
  if (!(error instanceof UnauthorizedError)) throw error;
}
assert.ok(authorizationUrl, 'the client should have been sent to the authorization page');
assert.ok(saved.client?.client_id, 'the client should have registered itself');
console.log('1. client registered and was sent to', authorizationUrl.origin + authorizationUrl.pathname);

// Play the browser. Cookies are carried by hand; redirects are followed one hop at a time.
let cookie = '';
const hop = async (url: string | URL, init: RequestInit = {}) => {
  const response = await fetch(new URL(url, base), { redirect: 'manual', ...init, headers: { ...(cookie ? { cookie } : {}), ...init.headers } });
  const set = response.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  return response;
};
const toLogin = await hop(authorizationUrl);
assert.equal(toLogin.status, 302, await toLogin.text());
const toConsent = await hop(toLogin.headers.get('location')!);
assert.equal(toConsent.status, 302);
assert.ok(cookie, 'signing in should set a session cookie');
const consentPath = toConsent.headers.get('location')!;
const screen = await hop(consentPath);
assert.equal(screen.status, 200);
assert.match(await screen.text(), /OAuth interop check/);
console.log('2. signed in and reached the approval screen');

const answer = await hop('/api/oauth/consent', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded', origin: base },
  body: new URLSearchParams({ request: new URL(consentPath, base).searchParams.get('request')!, decision: 'allow' }),
});
assert.equal(answer.status, 303);
const callback = new URL(answer.headers.get('location')!);
assert.equal(callback.origin + callback.pathname, redirect);
await transport.finishAuth(callback.searchParams);
assert.ok(saved.tokens?.access_token, 'the client should now hold tokens');
console.log('3. approved; the client exchanged the code for tokens');

const client = new Client({ name: 'oauth-interop-check', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(new URL('/api/mcp', base), { authProvider: provider }));
const who = await client.callTool({ name: 'quest_whoami', arguments: {} });
assert.ok(!who.isError, JSON.stringify(who.content));
await client.close();
console.log(`4. connected with the token as ${(who.structuredContent as { login: string }).login}. OAuth works end to end.`);
