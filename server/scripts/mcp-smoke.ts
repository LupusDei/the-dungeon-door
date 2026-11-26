/**
 * Checks a running quest-log MCP server the way a real client would: connect, list the tools, and
 * call the read-only ones. Exits non-zero on any failure.
 *
 *   npm run mcp:smoke                                         # http://localhost:3000, key dev-LupusDei
 *   QUEST_KEY=… npm run mcp:smoke -- https://the-dungeon-door.vercel.app
 */
import { strict as assert } from 'node:assert';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const base = process.argv[2] ?? 'http://localhost:3000';
const key = process.env.QUEST_KEY ?? 'dev-LupusDei';

const client = new Client({ name: 'quest-log-smoke', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(new URL('/api/mcp', base), { authProvider: { token: async () => key } }));

const { tools } = await client.listTools();
assert.ok(tools.length >= 14, `expected the full tool set, got ${tools.length}`);

const who = await client.callTool({ name: 'quest_whoami', arguments: {} });
assert.ok(!who.isError, JSON.stringify(who.content));
const me = who.structuredContent as { login: string; role: string };

const board = await client.callTool({ name: 'quest_get_board', arguments: {} });
assert.ok(!board.isError, JSON.stringify(board.content));
const b = board.structuredContent as { overall: { total: number; done: number }; currentLevel: { name: string } | null; levels: unknown[] };

const list = await client.callTool({ name: 'quest_list_tasks', arguments: { status: 'todo', limit: 3 } });
assert.ok(!list.isError, JSON.stringify(list.content));

const invalid = await client.callTool({ name: 'quest_get_task', arguments: { id: 'definitely-not-a-task' } });
assert.equal(invalid.isError, true, 'a missing task should come back as a readable tool error');

await client.close();
console.log(`MCP ok at ${base}: ${tools.length} tools, signed in as ${me.login} (${me.role}); ` +
  `${b.overall.done} of ${b.overall.total} tasks done across ${b.levels.length} levels, standing at ${b.currentLevel?.name ?? 'the end'}.`);
