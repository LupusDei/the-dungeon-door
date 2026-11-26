import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import * as mcp from '../api/mcp.ts';
import { quests, resetQuests } from './quests.ts';

const SITE = 'https://quest.test';

/** The site, as far as an MCP client can see it: requests go straight to the function handler. */
const site: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  const handler = (mcp as unknown as Record<string, (r: Request) => Promise<Response>>)[request.method];
  return handler ? handler(request) : new Response(null, { status: 405 });
};

async function connect(key: string): Promise<Client> {
  const client = new Client({ name: 'quest-log-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${SITE}/api/mcp`), { fetch: site, authProvider: { token: async () => key } }));
  return client;
}

const data = (result: { structuredContent?: unknown }) => result.structuredContent as Record<string, any>;
const errorText = (result: any) => (result.isError ? String(result.content?.[0]?.text) : '');

beforeEach(async () => {
  delete process.env.DATABASE_URL;
  delete process.env.QUEST_KEYS;
  resetQuests();
  await quests().setMeta({
    summary: 'A test board', facts: [{ label: 'Latest build', value: 'TestFlight 0.1 (3)' }],
    milestones: [{ id: 'door', name: 'The Door', blurb: 'first' }, { id: 'armory', name: 'The Armory', blurb: 'rules' }],
    areas: [{ id: 'rules', name: 'Rules engine' }, { id: 'app', name: 'iOS app' }],
  });
  await quests().put({ id: 'srd', title: 'Rules data', area: 'rules', milestone: 'door', status: 'done', owner: 'unclebob', notes: '', link: '', kind: 'task', severity: '', details: '',
    createdAt: '2026-11-25T00:00:00Z', updatedAt: '2026-11-25T00:00:00Z', lastChange: 'finished', createdBy: 'unclebob', updatedBy: 'unclebob' });
});

test('without a valid quest key the server answers 401 and says what to send', async () => {
  const post = (headers: Record<string, string>) => site(`${SITE}/api/mcp`, {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
  const none = await post({});
  assert.equal(none.status, 401);
  assert.match((await none.json()).message, /Authorization: Bearer/);
  assert.match(none.headers.get('www-authenticate') ?? '', /^Bearer /);
  assert.equal((await post({ authorization: 'Bearer nope' })).status, 401);
  assert.equal((await post({ authorization: 'Bearer dev-mallory' })).status, 401, 'a key for someone not on the team is no key');
  assert.notEqual((await post({ 'x-quest-key': 'dev-slagyr' })).status, 401, 'the x-quest-key header works too');
});

test('a real MCP client can read the board and manage tasks', async () => {
  const client = await connect('dev-unclebob');
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    'quest_add_level', 'quest_add_task', 'quest_add_workstream', 'quest_delete_level', 'quest_delete_task', 'quest_delete_workstream',
    'quest_get_board', 'quest_get_task', 'quest_list_issues', 'quest_list_tasks', 'quest_update_board_info', 'quest_update_level', 'quest_update_task',
    'quest_update_workstream', 'quest_whoami',
  ]);
  assert.ok(tools.every((t) => t.description && t.annotations), 'every tool is described and annotated');

  assert.equal(data(await client.callTool({ name: 'quest_whoami', arguments: {} })).login, 'unclebob');

  const board = data(await client.callTool({ name: 'quest_get_board', arguments: {} }));
  assert.equal(board.currentLevel.id, 'armory', 'the first level is cleared, so the party stands on the second');
  assert.deepEqual(board.levels.map((l: any) => [l.id, l.state]), [['door', 'cleared'], ['armory', 'current']]);

  const added = data(await client.callTool({ name: 'quest_add_task', arguments: { title: 'Character generation', workstream: 'rules', level: 'armory', owner: 'unclebob' } }));
  assert.equal(added.status, 'todo');
  assert.equal(added.updated_by, 'unclebob');

  const started = data(await client.callTool({ name: 'quest_update_task', arguments: { id: added.id, status: 'doing' } }));
  assert.equal(started.last_change, 'started');
  assert.equal(started.title, 'Character generation', 'fields not sent are kept');

  const doing = data(await client.callTool({ name: 'quest_list_tasks', arguments: { status: 'doing' } }));
  assert.deepEqual(doing.tasks.map((t: any) => t.id), [added.id]);
  assert.equal(doing.has_more, false);
  const paged = data(await client.callTool({ name: 'quest_list_tasks', arguments: { limit: 1 } }));
  assert.equal(paged.total, 2);
  assert.equal(paged.next_offset, 1);

  assert.equal(data(await client.callTool({ name: 'quest_delete_task', arguments: { id: added.id } })).deleted, added.id);

  // Mistakes come back as readable tool errors that say how to recover.
  assert.match(errorText(await client.callTool({ name: 'quest_add_task', arguments: { title: 'x', workstream: 'nope' } })), /valid ids: rules, app/);
  assert.match(errorText(await client.callTool({ name: 'quest_get_task', arguments: { id: 'missing' } })), /quest_list_tasks/);
  assert.equal((await client.callTool({ name: 'quest_add_task', arguments: { title: 'x', bogus: true } })).isError, true);
  await client.close();
});

test('admins can reshape the board through tools; members cannot', async () => {
  const admin = await connect('dev-LupusDei');
  const levels = data(await admin.callTool({ name: 'quest_add_level', arguments: { name: 'The Hall of Voices', description: 'Voice chat', position: 2 } })).levels;
  assert.deepEqual(levels.map((l: any) => l.id), ['door', 'the-hall-of-voices', 'armory']);
  const moved = data(await admin.callTool({ name: 'quest_update_level', arguments: { id: 'the-hall-of-voices', name: 'Voices', position: 3 } })).levels;
  assert.deepEqual(moved.map((l: any) => l.name), ['The Door', 'The Armory', 'Voices']);
  assert.equal(data(await admin.callTool({ name: 'quest_delete_level', arguments: { id: 'the-hall-of-voices' } })).levels.length, 2);
  assert.equal(data(await admin.callTool({ name: 'quest_add_workstream', arguments: { name: 'Voice & sound' } })).workstreams.at(-1).id, 'voice-sound');
  assert.equal((await admin.callTool({ name: 'quest_add_workstream', arguments: { name: 'x', description: 'not a workstream field' } })).isError, true);
  const info = data(await admin.callTool({ name: 'quest_update_board_info', arguments: { facts: [{ label: 'Latest build', value: 'TestFlight 0.1 (4)' }] } }));
  assert.equal(info.facts[0].value, 'TestFlight 0.1 (4)');
  assert.equal(info.summary, 'A test board', 'the summary was not sent, so it stays');
  await admin.close();

  const member = await connect('dev-slagyr-assistant');
  assert.equal(data(await member.callTool({ name: 'quest_whoami', arguments: {} })).role, 'member');
  assert.match(errorText(await member.callTool({ name: 'quest_add_level', arguments: { name: 'Sneaky' } })), /admin/i);
  assert.match(errorText(await member.callTool({ name: 'quest_update_board_info', arguments: { summary: 'Sneaky' } })), /admin/i);
  assert.equal(data(await member.callTool({ name: 'quest_add_task', arguments: { title: 'Members manage tasks' } })).updated_by, 'slagyr-assistant');
  await member.close();
});

test('an assistant can ask for its owner’s open issues and get each one’s full brief', async () => {
  const lupus = await connect('dev-LupusDei');
  const add = async (args: Record<string, unknown>) => data(await lupus.callTool({ name: 'quest_add_task', arguments: args }));
  const crash = await add({ title: 'A monster with no attack crashes its turn', kind: 'bug', severity: 'high', owner: 'unclebob', workstream: 'rules', details: 'Reproduce: …\nFix: …' });
  const deadly = await add({ title: 'Level-1 heroes die too often', kind: 'balance', severity: 'medium', owner: 'unclebob', details: 'Numbers: …' });
  const typo = await add({ title: 'Treasure line prints a long fraction', kind: 'bug', severity: 'low', owner: 'unclebob', details: 'Where: …' });
  const fixed = await add({ title: 'Rats deal no damage', kind: 'bug', severity: 'high', owner: 'unclebob', status: 'done', details: 'Fixed.' });
  const mine = await add({ title: 'App crash on the map', kind: 'bug', severity: 'high', owner: 'LupusDei' });
  await add({ title: 'Write the docs', owner: 'unclebob' });
  assert.deepEqual([crash.kind, crash.severity, crash.has_details], ['bug', 'high', true]);
  assert.equal('details' in crash, false, 'lists and edits stay small: the brief comes from quest_get_task and quest_list_issues');

  const bob = await connect('dev-unclebob');
  assert.ok((await bob.listTools()).tools.some((t) => t.name === 'quest_list_issues'));
  const issues = data(await bob.callTool({ name: 'quest_list_issues', arguments: {} }));
  assert.equal(issues.owner, 'unclebob', 'yours by default');
  assert.deepEqual(issues.issues.map((i: any) => i.id), [crash.id, deadly.id, typo.id], 'open ones only, the most severe first');
  assert.deepEqual(issues.issues.map((i: any) => i.details), ['Reproduce: …\nFix: …', 'Numbers: …', 'Where: …']);
  assert.deepEqual([issues.total, issues.has_more], [3, false]);
  assert.deepEqual(issues.overview.map((i: any) => [i.id, i.kind, i.severity]), [[crash.id, 'bug', 'high'], [deadly.id, 'balance', 'medium'], [typo.id, 'bug', 'low']]);
  assert.match(issues.how_to, /doing.*done/s, 'it says how to work one');
  const page = data(await bob.callTool({ name: 'quest_list_issues', arguments: { limit: 1, offset: 1 } }));
  assert.deepEqual([page.issues.map((i: any) => i.id), page.overview.length, page.has_more, page.next_offset], [[deadly.id], 3, true, 2], 'a page of briefs, the whole list in overview');

  const everyone = data(await bob.callTool({ name: 'quest_list_issues', arguments: { owner: 'anyone' } }));
  assert.deepEqual(everyone.issues.map((i: any) => i.id).sort(), [crash.id, deadly.id, typo.id, mine.id].sort());
  const bugs = data(await bob.callTool({ name: 'quest_list_issues', arguments: { kind: 'bug' } }));
  assert.deepEqual(bugs.issues.map((i: any) => i.id), [crash.id, typo.id]);
  const closed = data(await bob.callTool({ name: 'quest_list_issues', arguments: { include_done: true } }));
  assert.ok(closed.issues.some((i: any) => i.id === fixed.id));

  // The ordinary tools know about issues too.
  const listed = data(await bob.callTool({ name: 'quest_list_tasks', arguments: { kind: 'issue', owner: 'unclebob', status: 'todo' } }));
  assert.deepEqual(listed.tasks.map((t: any) => t.id).sort(), [crash.id, deadly.id, typo.id].sort());
  assert.equal(data(await bob.callTool({ name: 'quest_get_task', arguments: { id: deadly.id } })).details, 'Numbers: …');
  const board = data(await bob.callTool({ name: 'quest_get_board', arguments: {} }));
  assert.deepEqual(board.open_issues, { total: 4, bugs: 3, balance: 1, yours: 3, by_owner: { unclebob: 3, LupusDei: 1 } });

  const done = data(await bob.callTool({ name: 'quest_update_task', arguments: { id: typo.id, status: 'done', link: 'https://github.com/LupusDei/the-dungeon-door/pull/9', notes: 'Rounded to copper.' } }));
  assert.equal(done.status, 'done');
  assert.equal(data(await bob.callTool({ name: 'quest_list_issues', arguments: {} })).total, 2);
  await lupus.close();
  await bob.close();
});
