import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { HttpError, badRequest, notFound } from './http.ts';

/**
 * The quest log: the team's progress board, shown on the website at /quest-log.
 *
 * Anyone can read it. Writing needs a personal quest key (`x-quest-key`), one per team member, so
 * every change carries a name. The key list is the QUEST_KEYS environment variable: a JSON object of
 * `{ "<sha256 of the key, hex>": "<person id>" }`, so the keys themselves are never stored.
 * With no QUEST_KEYS and no database (plain local dev) the key `dev-<person id>` works.
 */

export interface Person {
  /** GitHub login. */
  id: string;
  name: string;
  avatar: string;
}

/** The people who can submit. Ids are GitHub logins; avatars are their GitHub pictures. */
export const PEOPLE: Person[] = ['LupusDei', 'unclebob', 'slagyr', 'slagyr-assistant'].map((id) => ({
  id,
  name: id === 'unclebob' ? 'Uncle Bob' : id,
  avatar: `https://github.com/${id}.png?size=96`,
}));

export const STATUSES = ['todo', 'doing', 'done'] as const;
export type QuestStatus = (typeof STATUSES)[number];

export interface QuestTask {
  id: string;
  title: string;
  area: string;
  milestone: string;
  status: QuestStatus;
  owner: string;
  notes: string;
  link: string;
  createdAt: string;
  updatedAt: string;
  lastChange: 'added' | 'started' | 'finished' | 'reopened' | 'edited';
  createdBy: string;
  updatedBy: string;
}

export interface QuestMeta {
  summary: string;
  milestones: { id: string; name: string; blurb: string }[];
  areas: { id: string; name: string }[];
  facts: { label: string; value: string; href?: string }[];
}

const EMPTY_META: QuestMeta = { summary: '', milestones: [], areas: [], facts: [] };

// ---- who is asking ----

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

function keyTable(): Record<string, string> | null {
  const raw = process.env.QUEST_KEYS;
  if (!raw) return null;
  try {
    const table = JSON.parse(raw);
    return table && typeof table === 'object' ? (table as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** The person a quest key belongs to, or null. */
export function personForKey(key: string | null): Person | null {
  if (!key) return null;
  const table = keyTable();
  let id: string | undefined;
  if (table) {
    const given = Buffer.from(sha256(key));
    for (const [hash, person] of Object.entries(table)) {
      const known = Buffer.from(hash);
      if (known.length === given.length && timingSafeEqual(known, given)) id = person;
    }
  } else if (!process.env.DATABASE_URL && key.startsWith('dev-')) {
    id = key.slice(4);
  }
  return PEOPLE.find((p) => p.id === id) ?? null;
}

export function requirePerson(request: Request): Person {
  const person = personForKey(request.headers.get('x-quest-key'));
  if (!person) throw new HttpError(401, 'A valid quest key is needed to change the quest log.');
  return person;
}

// ---- storage ----

interface QuestStore {
  meta(): Promise<QuestMeta>;
  setMeta(meta: QuestMeta): Promise<void>;
  list(): Promise<QuestTask[]>;
  get(id: string): Promise<QuestTask | null>;
  put(task: QuestTask): Promise<void>;
  remove(id: string): Promise<boolean>;
}

class MemoryQuests implements QuestStore {
  private tasks = new Map<string, QuestTask>();
  private m: QuestMeta = EMPTY_META;
  async meta() { return this.m; }
  async setMeta(meta: QuestMeta) { this.m = meta; }
  async list() { return [...this.tasks.values()]; }
  async get(id: string) { return this.tasks.get(id) ?? null; }
  async put(task: QuestTask) { this.tasks.set(task.id, task); }
  async remove(id: string) { return this.tasks.delete(id); }
}

/** One table of JSON documents: kind 'task' or 'meta'. Each call is a single statement. */
class PostgresQuests implements QuestStore {
  private sql: NeonQueryFunction<false, false>;
  constructor(url: string) { this.sql = neon(url); }
  private q(text: string, params: unknown[] = []) {
    return this.sql.query(text, params) as Promise<Record<string, any>[]>;
  }
  async meta() {
    const [row] = await this.q("SELECT data FROM quest_docs WHERE kind = 'meta' AND id = 'board'");
    return row ? (row.data as QuestMeta) : EMPTY_META;
  }
  async setMeta(meta: QuestMeta) {
    await this.q(
      "INSERT INTO quest_docs (kind, id, data) VALUES ('meta', 'board', $1) ON CONFLICT (kind, id) DO UPDATE SET data = $1, updated_at = now()",
      [JSON.stringify(meta)],
    );
  }
  async list() {
    const rows = await this.q("SELECT data FROM quest_docs WHERE kind = 'task'");
    return rows.map((r) => r.data as QuestTask);
  }
  async get(id: string) {
    const [row] = await this.q("SELECT data FROM quest_docs WHERE kind = 'task' AND id = $1", [id]);
    return row ? (row.data as QuestTask) : null;
  }
  async put(task: QuestTask) {
    await this.q(
      "INSERT INTO quest_docs (kind, id, data) VALUES ('task', $1, $2) ON CONFLICT (kind, id) DO UPDATE SET data = $2, updated_at = now()",
      [task.id, JSON.stringify(task)],
    );
  }
  async remove(id: string) {
    const rows = await this.q("DELETE FROM quest_docs WHERE kind = 'task' AND id = $1 RETURNING id", [id]);
    return rows.length > 0;
  }
}

const g = globalThis as typeof globalThis & { __ddQuests?: QuestStore };

export function quests(): QuestStore {
  if (!g.__ddQuests) {
    const url = process.env.DATABASE_URL;
    g.__ddQuests = url ? new PostgresQuests(url) : new MemoryQuests();
  }
  return g.__ddQuests;
}

/** Tests: start from an empty in-memory board. */
export function resetQuests(): void {
  g.__ddQuests = new MemoryQuests();
}

// ---- rules for what a task may hold ----

const text = (value: unknown, max: number, field: string): string => {
  if (value == null) return '';
  if (typeof value !== 'string') throw badRequest(`${field} must be text`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw badRequest(`${field} is too long (max ${max} characters)`);
  return trimmed;
};

type Fields = Pick<QuestTask, 'title' | 'area' | 'milestone' | 'status' | 'owner' | 'notes' | 'link'>;

/** Validates the fields present in `body`; missing ones come from `base` (the task being edited). */
function fieldsFrom(body: Record<string, unknown>, meta: QuestMeta, base?: QuestTask): Fields {
  const pick = (key: keyof Fields) => (key in body ? body[key] : base?.[key]);
  const title = text(pick('title'), 140, 'title');
  if (!title) throw badRequest('title is required');
  const area = text(pick('area'), 40, 'area');
  if (area && !meta.areas.some((a) => a.id === area)) throw badRequest('unknown workstream');
  const milestone = text(pick('milestone'), 40, 'milestone');
  if (milestone && !meta.milestones.some((m) => m.id === milestone)) throw badRequest('unknown level');
  const status = (pick('status') ?? 'todo') as QuestStatus;
  if (!STATUSES.includes(status)) throw badRequest('status must be todo, doing or done');
  const owner = text(pick('owner'), 40, 'owner');
  if (owner && !PEOPLE.some((p) => p.id === owner)) throw badRequest('unknown owner');
  const link = text(pick('link'), 300, 'link');
  if (link && !/^https:\/\//i.test(link)) throw badRequest('links must start with https://');
  return { title, area, milestone, status, owner, notes: text(pick('notes'), 1200, 'notes'), link };
}

const changeFor = (from: QuestStatus, to: QuestStatus): QuestTask['lastChange'] =>
  from === to ? 'edited' : to === 'done' ? 'finished' : to === 'doing' ? 'started' : 'reopened';

export async function board() {
  const store = quests();
  const [meta, tasks] = await Promise.all([store.meta(), store.list()]);
  return { meta, people: PEOPLE, tasks };
}

export async function addTask(person: Person, body: Record<string, unknown>): Promise<QuestTask> {
  const store = quests();
  const fields = fieldsFrom(body, await store.meta());
  const now = new Date().toISOString();
  const task: QuestTask = {
    id: `q-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`,
    ...fields,
    createdAt: now,
    updatedAt: now,
    lastChange: 'added',
    createdBy: person.id,
    updatedBy: person.id,
  };
  await store.put(task);
  return task;
}

export async function editTask(person: Person, id: string, body: Record<string, unknown>): Promise<QuestTask> {
  const store = quests();
  const existing = await store.get(id);
  if (!existing) throw notFound('no such task');
  const fields = fieldsFrom(body, await store.meta(), existing);
  const task: QuestTask = {
    ...existing,
    ...fields,
    updatedAt: new Date().toISOString(),
    lastChange: changeFor(existing.status, fields.status),
    updatedBy: person.id,
  };
  await store.put(task);
  return task;
}

export async function removeTask(id: string): Promise<void> {
  if (!(await quests().remove(id))) throw notFound('no such task');
}
