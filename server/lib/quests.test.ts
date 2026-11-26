import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { PUT as PUT_META } from '../api/quest-meta.ts';
import { GET, POST, PATCH, DELETE } from '../api/quests.ts';
import { GET as ME } from '../api/quest-me.ts';
import { quests, resetQuests } from './quests.ts';

const base = 'http://localhost/api/quests';
const as = (person: string) => ({ 'x-quest-key': `dev-${person}`, 'content-type': 'application/json' });
const post = (headers: Record<string, string>, body: unknown) =>
  POST(new Request(base, { method: 'POST', headers, body: JSON.stringify(body) }));

beforeEach(async () => {
  delete process.env.QUEST_KEYS;
  delete process.env.DATABASE_URL;
  resetQuests();
  await quests().setMeta({
    summary: 'test', facts: [],
    milestones: [{ id: 'armory', name: 'The Armory', blurb: '' }],
    areas: [{ id: 'rules', name: 'Rules engine' }],
  });
});

test('anyone can read the board; it lists the four people', async () => {
  const body = await (await GET()).json();
  assert.equal(body.tasks.length, 0);
  assert.deepEqual(body.people.map((p: { id: string }) => p.id), ['LupusDei', 'unclebob', 'slagyr', 'slagyr-assistant']);
});

test('writing needs a quest key that belongs to one of the four', async () => {
  assert.equal((await post({ 'content-type': 'application/json' }, { title: 'x' })).status, 401);
  assert.equal((await post(as('mallory'), { title: 'x' })).status, 401);
  assert.equal((await ME(new Request('http://localhost/api/quest-me', { headers: as('slagyr-assistant') }))).status, 200);
});

test('add, move, edit and delete a task, each stamped with who did it', async () => {
  const created = await post(as('unclebob'), { title: ' Character generation ', area: 'rules', milestone: 'armory' });
  assert.equal(created.status, 201);
  const task = await created.json();
  assert.equal(task.title, 'Character generation');
  assert.equal(task.status, 'todo');
  assert.equal(task.createdBy, 'unclebob');

  const moved = await (await PATCH(new Request(`${base}?id=${task.id}`, { method: 'PATCH', headers: as('slagyr'), body: JSON.stringify({ status: 'doing' }) }))).json();
  assert.equal(moved.status, 'doing');
  assert.equal(moved.lastChange, 'started');
  assert.equal(moved.updatedBy, 'slagyr');
  assert.equal(moved.title, 'Character generation', 'fields not sent are kept');

  const done = await (await PATCH(new Request(`${base}?id=${task.id}`, { method: 'PATCH', headers: as('unclebob'), body: JSON.stringify({ status: 'done', owner: 'unclebob' }) }))).json();
  assert.equal(done.lastChange, 'finished');

  assert.equal((await DELETE(new Request(`${base}?id=${task.id}`, { method: 'DELETE', headers: as('LupusDei') }))).status, 200);
  assert.equal((await DELETE(new Request(`${base}?id=${task.id}`, { method: 'DELETE', headers: as('LupusDei') }))).status, 404);
});

test('bad fields are refused', async () => {
  for (const body of [{}, { title: '' }, { title: 'x', status: 'someday' }, { title: 'x', area: 'nope' },
    { title: 'x', owner: 'mallory' }, { title: 'x', link: 'http://insecure.example' }, { title: 'x'.repeat(141) }]) {
    assert.equal((await post(as('LupusDei'), body)).status, 400, JSON.stringify(body));
  }
});

test('with QUEST_KEYS set, only hashed keys from the table work', async () => {
  const { createHash } = await import('node:crypto');
  process.env.QUEST_KEYS = JSON.stringify({ [createHash('sha256').update('s3cret').digest('hex')]: 'slagyr' });
  assert.equal((await post(as('slagyr'), { title: 'x' })).status, 401, 'dev keys stop working');
  const ok = await post({ 'x-quest-key': 's3cret', 'content-type': 'application/json' }, { title: 'x' });
  assert.equal((await ok.json()).createdBy, 'slagyr');
});

test('a key works as a bearer token as well as in its own header', async () => {
  const bearer = await POST(new Request(base, { method: 'POST', headers: { authorization: 'Bearer dev-unclebob', 'content-type': 'application/json' }, body: '{"title":"x"}' }));
  assert.equal((await bearer.json()).createdBy, 'unclebob');
});

test('admins reshape the board; members cannot; removing a level frees its tasks', async () => {
  const put = (person: string, body: unknown) => PUT_META(new Request('http://localhost/api/quest-meta', { method: 'PUT', headers: as(person), body: JSON.stringify(body) }));
  assert.equal((await put('slagyr-assistant', { summary: 'nope' })).status, 403);

  const task = await (await post(as('unclebob'), { title: 'In the armory', area: 'rules', milestone: 'armory' })).json();
  const saved = await put('LupusDei', {
    summary: 'New headline',
    milestones: [{ name: 'The Hall of Voices', blurb: 'new' }],
    facts: [{ label: 'Latest build', value: 'TestFlight 0.1 (4)' }],
  });
  assert.equal(saved.status, 200);
  const board = await saved.json();
  assert.deepEqual(board.meta.milestones.map((m: { id: string }) => m.id), ['the-hall-of-voices']);
  assert.equal(board.meta.areas.length, 1, 'sections not sent are left alone');
  const moved = board.tasks.find((t: { id: string }) => t.id === task.id);
  assert.equal(moved.milestone, '', 'the removed level no longer holds the task');
  assert.equal(moved.area, 'rules');

  assert.equal((await put('LupusDei', { facts: [{ label: 'x', value: 'y', href: 'http://insecure' }] })).status, 400);
});
