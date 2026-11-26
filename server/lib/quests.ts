import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { badRequest, forbidden, notFound } from './http.ts';

/**
 * The quest log: the team's progress board, shown on the website at /quest-log and managed from
 * /admin, the REST API (api/quests.ts) and the MCP server (api/mcp.ts).
 *
 * Anyone can read it. Writing needs a personal quest key, one per team member, so every change
 * carries a name (see lib/identity.ts). Keys are listed in the QUEST_KEYS environment variable as
 * `{ "<sha256 of the key, hex>": "<person id>" }`, so the keys themselves are never stored. With no
 * QUEST_KEYS and no database (plain local dev) the key `dev-<person id>` works.
 */

export interface Person {
  /** GitHub login. */
  id: string;
  name: string;
  avatar: string;
  /** Admins can also reshape the board (levels, workstreams, headline); members manage tasks. */
  role: 'admin' | 'member';
}

/** The team. Ids are GitHub logins; avatars are their GitHub pictures. */
export const PEOPLE: Person[] = (
  [
    ['LupusDei', 'LupusDei', 'admin'],
    ['unclebob', 'Uncle Bob', 'admin'],
    ['slagyr', 'slagyr', 'admin'],
    ['slagyr-assistant', 'slagyr-assistant', 'member'],
  ] as const
).map(([id, name, role]) => ({ id, name, role, avatar: `https://github.com/${id}.png?size=96` }));

/** GitHub logins are case-insensitive; ours are stored in their canonical case. */
export const personByLogin = (login: string | null | undefined): Person | null =>
  PEOPLE.find((p) => p.id.toLowerCase() === (login ?? '').toLowerCase()) ?? null;

export const STATUSES = ['todo', 'doing', 'done'] as const;
export type QuestStatus = (typeof STATUSES)[number];

/** What a task is. An **issue** is a bug or a balance problem: something wrong with what is already built. */
export const KINDS = ['task', 'bug', 'balance'] as const;
export type QuestKind = (typeof KINDS)[number];
/** How much an issue matters; '' when nobody has said (and for ordinary tasks). */
export const SEVERITIES = ['', 'low', 'medium', 'high'] as const;
export type Severity = (typeof SEVERITIES)[number];
export const DETAILS_MAX = 12_000;

export interface QuestTask {
  id: string;
  title: string;
  area: string;
  milestone: string;
  status: QuestStatus;
  owner: string;
  /** A line or two for the card: context, or the outcome. */
  notes: string;
  link: string;
  kind: QuestKind;
  severity: Severity;
  /**
   * The full brief, for whoever picks the task up (a person or their assistant) with nothing else to go
   * on: what is wrong, where in the code, how to reproduce it, what done looks like. Plain text.
   */
  details: string;
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

export const isIssue = (task: Pick<QuestTask, 'kind'>): boolean => task.kind !== 'task';

/** A task as stored before issues existed has no kind, severity or details: it is an ordinary task. */
const whole = (task: QuestTask): QuestTask => ({ ...task, kind: task.kind ?? 'task', severity: task.severity ?? '', details: task.details ?? '' });

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
  return personByLogin(id);
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
  async list() { return [...this.tasks.values()].map(whole); }
  async get(id: string) { const task = this.tasks.get(id); return task ? whole(task) : null; }
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
    return rows.map((r) => whole(r.data as QuestTask));
  }
  async get(id: string) {
    const [row] = await this.q("SELECT data FROM quest_docs WHERE kind = 'task' AND id = $1", [id]);
    return row ? whole(row.data as QuestTask) : null;
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

type Fields = Pick<QuestTask, 'title' | 'area' | 'milestone' | 'status' | 'owner' | 'notes' | 'link' | 'kind' | 'severity' | 'details'>;

/** Validates the fields present in `body`; missing ones come from `base` (the task being edited). */
function fieldsFrom(body: Record<string, unknown>, meta: QuestMeta, base?: QuestTask): Fields {
  const pick = (key: keyof Fields) => (key in body ? body[key] : base?.[key]);
  const title = text(pick('title'), 140, 'title');
  if (!title) throw badRequest('title is required');
  const area = text(pick('area'), 40, 'area');
  if (area && !meta.areas.some((a) => a.id === area)) throw badRequest(`unknown workstream "${area}"; valid ids: ${meta.areas.map((a) => a.id).join(', ') || '(none yet)'}`);
  const milestone = text(pick('milestone'), 40, 'milestone');
  if (milestone && !meta.milestones.some((m) => m.id === milestone)) throw badRequest(`unknown level "${milestone}"; valid ids: ${meta.milestones.map((m) => m.id).join(', ') || '(none yet)'}`);
  const status = (pick('status') ?? 'todo') as QuestStatus;
  if (!STATUSES.includes(status)) throw badRequest('status must be todo, doing or done');
  const owner = text(pick('owner'), 40, 'owner');
  if (owner && !PEOPLE.some((p) => p.id === owner)) throw badRequest(`unknown owner "${owner}"; valid: ${PEOPLE.map((p) => p.id).join(', ')}`);
  const link = text(pick('link'), 300, 'link');
  if (link && !/^https:\/\//i.test(link)) throw badRequest('links must start with https://');
  const kind = (pick('kind') ?? 'task') as QuestKind;
  if (!KINDS.includes(kind)) throw badRequest('kind must be task, bug or balance');
  const severity = (pick('severity') ?? '') as Severity;
  if (!SEVERITIES.includes(severity)) throw badRequest('severity must be low, medium or high (or empty)');
  return { title, area, milestone, status, owner, notes: text(pick('notes'), 1200, 'notes'), link, kind, severity, details: text(pick('details'), DETAILS_MAX, 'details') };
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

// ---- reshaping the board (admins) ----

const slug = (name: string) =>
  name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'item';

function freshId(name: string, taken: Set<string>): string {
  const base = slug(name);
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

export function requireAdmin(person: Person): void {
  if (person.role !== 'admin') throw forbidden('Only an admin can change levels, workstreams or the board headline.');
}

/** Tasks pointing at a level or workstream that no longer exists lose that pointer. */
async function tidyTasks(meta: QuestMeta): Promise<number> {
  const store = quests();
  const levels = new Set(meta.milestones.map((m) => m.id));
  const areas = new Set(meta.areas.map((a) => a.id));
  let changed = 0;
  for (const task of await store.list()) {
    const milestone = task.milestone && !levels.has(task.milestone) ? '' : task.milestone;
    const area = task.area && !areas.has(task.area) ? '' : task.area;
    if (milestone !== task.milestone || area !== task.area) {
      await store.put({ ...task, milestone, area });
      changed++;
    }
  }
  return changed;
}

/**
 * Replaces the board's structure in one go (the admin portal edits it as a whole). Items keep their
 * id when one is sent; new items get an id made from their name. Order is the order sent.
 */
export async function saveMeta(person: Person, body: Record<string, unknown>): Promise<QuestMeta> {
  requireAdmin(person);
  const current = await quests().meta();
  const list = (value: unknown, field: string, max: number): Record<string, unknown>[] => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > max) throw badRequest(`${field} must be a list of at most ${max}`);
    return value.map((item) => {
      if (!item || typeof item !== 'object') throw badRequest(`${field} entries must be objects`);
      return item as Record<string, unknown>;
    });
  };
  const named = (items: Record<string, unknown>[], field: string) => {
    const taken = new Set<string>();
    for (const item of items) if (typeof item.id === 'string' && item.id) {
      if (!/^[a-z0-9-]{1,40}$/.test(item.id)) throw badRequest(`${field} ids use lowercase letters, digits and dashes`);
      if (taken.has(item.id)) throw badRequest(`two ${field} share the id "${item.id}"`);
      taken.add(item.id);
    }
    return items.map((item) => {
      const name = text(item.name, 60, `${field} name`);
      if (!name) throw badRequest(`every ${field} entry needs a name`);
      return { id: typeof item.id === 'string' && item.id ? item.id : freshId(name, taken), name, item };
    });
  };
  const meta: QuestMeta = {
    summary: 'summary' in body ? text(body.summary, 400, 'summary') : current.summary,
    milestones: 'milestones' in body
      ? named(list(body.milestones, 'levels', 24), 'levels').map(({ id, name, item }) => ({ id, name, blurb: text(item.blurb, 240, 'level description') }))
      : current.milestones,
    areas: 'areas' in body ? named(list(body.areas, 'workstreams', 24), 'workstreams').map(({ id, name }) => ({ id, name })) : current.areas,
    facts: 'facts' in body
      ? list(body.facts, 'facts', 8).map((item) => {
          const label = text(item.label, 40, 'fact label');
          const value = text(item.value, 120, 'fact value');
          const href = text(item.href, 300, 'fact link');
          if (!label || !value) throw badRequest('every fact needs a label and a value');
          if (href && !/^https:\/\//i.test(href)) throw badRequest('fact links must start with https://');
          return href ? { label, value, href } : { label, value };
        })
      : current.facts,
  };
  await quests().setMeta(meta);
  await tidyTasks(meta);
  return meta;
}

type Section = 'milestones' | 'areas';

/** Adds one level or workstream; `position` is 1-based, the end when omitted. */
export async function addSectionItem(person: Person, section: Section, fields: { name: string; blurb?: string; position?: number }): Promise<QuestMeta> {
  const meta = await quests().meta();
  const items = [...meta[section]] as Record<string, unknown>[];
  const at = Math.min(Math.max((fields.position ?? items.length + 1) - 1, 0), items.length);
  items.splice(at, 0, { name: fields.name, blurb: fields.blurb ?? '' });
  return saveMeta(person, { [section]: items });
}

export async function updateSectionItem(person: Person, section: Section, id: string, fields: { name?: string; blurb?: string; position?: number }): Promise<QuestMeta> {
  const meta = await quests().meta();
  const items = [...meta[section]] as Record<string, unknown>[];
  const from = items.findIndex((item) => item.id === id);
  if (from < 0) throw notFound(`no ${section === 'milestones' ? 'level' : 'workstream'} with id "${id}"`);
  const [item] = items.splice(from, 1);
  const next = { ...item, ...(fields.name !== undefined ? { name: fields.name } : {}), ...(fields.blurb !== undefined ? { blurb: fields.blurb } : {}) };
  const to = fields.position === undefined ? from : Math.min(Math.max(fields.position - 1, 0), items.length);
  items.splice(to, 0, next);
  return saveMeta(person, { [section]: items });
}

export async function deleteSectionItem(person: Person, section: Section, id: string): Promise<QuestMeta> {
  const meta = await quests().meta();
  if (!meta[section].some((item) => item.id === id)) throw notFound(`no ${section === 'milestones' ? 'level' : 'workstream'} with id "${id}"`);
  return saveMeta(person, { [section]: meta[section].filter((item) => item.id !== id) });
}

/** Counts used by every view of progress: per level, and which level the party stands on. */
export function progressOf(meta: QuestMeta, tasks: QuestTask[]) {
  const count = (list: QuestTask[]) => ({
    total: list.length,
    done: list.filter((t) => t.status === 'done').length,
    doing: list.filter((t) => t.status === 'doing').length,
    todo: list.filter((t) => t.status === 'todo').length,
  });
  const levels = meta.milestones.map((m, i) => ({ number: i + 1, ...m, ...count(tasks.filter((t) => t.milestone === m.id)) }));
  const here = levels.find((l) => l.total === 0 || l.done < l.total) ?? null;
  return {
    overall: count(tasks),
    currentLevel: here ? { id: here.id, number: here.number, name: here.name } : null,
    levels: levels.map((l) => ({ ...l, state: !here || l.number < here.number ? 'cleared' : l.number === here.number ? 'current' : 'ahead' })),
    workstreams: meta.areas.map((a) => ({ ...a, ...count(tasks.filter((t) => t.area === a.id)) })),
  };
}
