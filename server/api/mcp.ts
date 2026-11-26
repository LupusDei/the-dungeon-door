import {
  type AuthInfo, OAuthError, OAuthErrorCode, createMcpHandler, getOAuthProtectedResourceMetadataUrl, requireBearerAuth,
} from '@modelcontextprotocol/server';
import { accessGrant } from '../lib/identity.ts';
import { buildQuestServer } from '../lib/mcp.ts';
import { SCOPE, mcpUrl } from '../lib/oauth.ts';
import { personByLogin, personForKey } from '../lib/quests.ts';

/**
 * The quest log's MCP server (Streamable HTTP, stateless): https://<site>/api/mcp
 *
 * Every request needs a bearer token: an access token from this site's OAuth flow (MCP clients get
 * one by sending the team member through GitHub sign-in), or a personal quest key. A request without
 * one gets a 401 that points the client at the discovery document, which is how clients find the
 * sign-in. The tools are in lib/mcp.ts.
 */
const handler = createMcpHandler(({ authInfo }) => {
  const person = personByLogin(authInfo?.extra?.login as string | undefined);
  if (!person) throw new Error('This connection is not signed in as a team member.');
  return buildQuestServer(person);
}, { responseMode: 'json' });

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, accept, x-quest-key, mcp-protocol-version, mcp-session-id, mcp-method, mcp-name, last-event-id',
  'access-control-expose-headers': 'www-authenticate, mcp-session-id',
  'access-control-max-age': '86400',
};

async function verify(token: string, resource: URL): Promise<AuthInfo> {
  const keyed = personForKey(token);
  if (keyed) {
    return { token, clientId: 'quest-key', scopes: [SCOPE], expiresAt: Math.floor(Date.now() / 1000) + 3600, resource, extra: { login: keyed.id } };
  }
  const grant = await accessGrant(token);
  if (!grant || !personByLogin(grant.login)) throw new OAuthError(OAuthErrorCode.InvalidToken, 'Unknown or expired token. Sign in again.');
  return { token, clientId: grant.clientId, scopes: grant.scope.split(' '), expiresAt: grant.expiresAt, resource: new URL(grant.resource), extra: { login: grant.login } };
}

async function serve(request: Request): Promise<Response> {
  const resource = new URL(mcpUrl(request));
  // Scripts may send the quest key in its own header instead of as a bearer token.
  const questKey = request.headers.get('x-quest-key');
  if (questKey && !request.headers.get('authorization')) {
    const headers = new Headers(request.headers);
    headers.set('authorization', `Bearer ${questKey}`);
    request = new Request(request, { headers });
  }
  const gate = requireBearerAuth({
    verifier: { verifyAccessToken: (token) => verify(token, resource) },
    requiredScopes: [SCOPE],
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resource),
    expectedResource: resource,
  });
  const auth = await gate(request);
  const response = auth instanceof Response ? auth : await handler.fetch(request, { authInfo: auth });
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS)) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS });
}

export { serve as GET, serve as POST, serve as DELETE };
