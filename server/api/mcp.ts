import { createMcpHandler } from '@modelcontextprotocol/server';
import { identify, keyOf } from '../lib/identity.ts';
import { buildQuestServer } from '../lib/mcp.ts';
import { personByLogin } from '../lib/quests.ts';

/**
 * The quest log's MCP server (Streamable HTTP, stateless): https://<site>/api/mcp
 *
 * Every request carries a personal quest key as a bearer token (`Authorization: Bearer <key>`); the
 * `x-quest-key` header works too. The key says which team member the connection acts as. The tools
 * are in lib/mcp.ts; setup instructions are in the README.
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
  'access-control-max-age': '86400',
};

async function serve(request: Request): Promise<Response> {
  const person = identify(request);
  if (!person) {
    return Response.json(
      { error: 'unauthorized', message: 'Send your personal quest key as "Authorization: Bearer <key>". Ask the project owner for one.' },
      { status: 401, headers: { 'www-authenticate': 'Bearer realm="The Dungeon Door quest log"', ...CORS } },
    );
  }
  const response = await handler.fetch(request, {
    authInfo: { token: keyOf(request) ?? '', clientId: 'quest-key', scopes: ['quests'], extra: { login: person.id } },
  });
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS)) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS });
}

export { serve as GET, serve as POST, serve as DELETE };
