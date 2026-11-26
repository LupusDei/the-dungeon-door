import { oauthMetadataResponse } from '@modelcontextprotocol/server';
import { handle, originOf } from '../lib/http.ts';
import { CORS, OAuthProblem, SCOPE, authorize, consentPage, decideConsent, mcpUrl, registerClient, serverMetadata, token } from '../lib/oauth.ts';

/**
 * Sign-in for MCP clients (see lib/oauth.ts). vercel.json maps the public paths onto this function:
 *
 *   GET  /.well-known/oauth-protected-resource[/api/mcp]   what protects /api/mcp, and who issues its tokens
 *   GET  /.well-known/oauth-authorization-server           this server's endpoints
 *   POST /api/oauth/register                               a client registers itself
 *   GET  /api/oauth/authorize                              start signing in (→ GitHub → the approval screen)
 *   GET  /api/oauth/consent, POST /api/oauth/consent       the approval screen and its answer
 *   POST /api/oauth/token                                  swap a code (or refresh token) for tokens
 */
function actionOf(request: Request): string {
  const url = new URL(request.url);
  const named = url.searchParams.get('action');
  if (named) return named;
  if (url.pathname.includes('oauth-protected-resource')) return 'resource';
  if (url.pathname.includes('oauth-authorization-server')) return 'server';
  return url.pathname.match(/\/api\/oauth\/([a-z]+)/)?.[1] ?? '';
}

const safely = async (work: () => Promise<Response>): Promise<Response> => {
  try {
    return await work();
  } catch (error) {
    if (error instanceof OAuthProblem) return error.toResponse();
    throw error;
  }
};

function discovery(request: Request, action: string): Response {
  const origin = originOf(request);
  const path = action === 'server' ? '/.well-known/oauth-authorization-server' : '/.well-known/oauth-protected-resource/api/mcp';
  const response = oauthMetadataResponse(new Request(origin + path, { method: request.method, headers: request.headers }), {
    oauthMetadata: serverMetadata(request),
    resourceServerUrl: new URL(mcpUrl(request)),
    scopesSupported: [SCOPE],
    resourceName: 'The Dungeon Door quest log',
    dangerouslyAllowInsecureIssuerUrl: origin.startsWith('http://'), // local dev only; production is always https
  });
  return response ?? Response.json({ error: 'not found' }, { status: 404 });
}

export async function GET(request: Request): Promise<Response> {
  return handle(() => safely(async () => {
    const action = actionOf(request);
    if (action === 'resource' || action === 'server') return discovery(request, action);
    if (action === 'authorize') return authorize(request);
    if (action === 'consent') return consentPage(request);
    return Response.json({ error: 'not found' }, { status: 404 });
  }));
}

export async function POST(request: Request): Promise<Response> {
  return handle(() => safely(async () => {
    const action = actionOf(request);
    if (action === 'register') return registerClient(request);
    if (action === 'token') return token(request);
    if (action === 'consent') return decideConsent(request);
    return Response.json({ error: 'not found' }, { status: 404 });
  }));
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: { ...CORS, 'access-control-max-age': '86400' } });
}
