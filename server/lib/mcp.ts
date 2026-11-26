import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import {
  PEOPLE, type Person, type QuestTask, addSectionItem, addTask, board, deleteSectionItem, editTask, progressOf,
  quests, removeTask, requireAdmin, saveMeta, updateSectionItem,
} from './quests.ts';

/**
 * The quest log as MCP tools, so an assistant can read and manage the team's board: tasks, the
 * levels (the project's milestones and objectives), workstreams and the headline.
 *
 * Vocabulary the tools share: a **level** is a milestone; the board's levels run in order, and
 * "where the party stands" is the first level with unfinished work. A **workstream** is an area
 * of the project. A task's **status** is todo, doing or done.
 */

const CHARACTER_LIMIT = 25_000;

const reply = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 1) }],
  structuredContent: data as Record<string, unknown>,
});

const statusEnum = z.enum(['todo', 'doing', 'done']);

/** Tasks as tools show them: the board's `milestone` field is called `level` here. */
const view = (t: QuestTask) => ({
  id: t.id, title: t.title, status: t.status, owner: t.owner || null, workstream: t.area || null, level: t.milestone || null,
  notes: t.notes || null, link: t.link || null, updated_at: t.updatedAt, updated_by: t.updatedBy, last_change: t.lastChange,
});

const taskFields = {
  title: z.string().min(1).max(140).describe('Short description of the work, e.g. "Character generation from the rules data"'),
  workstream: z.string().max(40).optional().describe('Workstream id from quest_get_board (e.g. "rules", "app"). Empty string for none'),
  level: z.string().max(40).optional().describe('Level (milestone) id from quest_get_board (e.g. "armory"). Empty string for none'),
  status: statusEnum.optional().describe('"todo" (default), "doing" for in progress, or "done"'),
  owner: z.string().max(40).optional().describe(`GitHub login of who owns it: ${PEOPLE.map((p) => p.id).join(', ')}. Empty string for unassigned`),
  notes: z.string().max(1200).optional().describe('Context, acceptance notes or the outcome. Plain text'),
  link: z.string().max(300).optional().describe('An https:// link, e.g. the pull request or issue'),
};

/** Tool arguments use `workstream` and `level`; the stored task uses `area` and `milestone`. */
function toBody(args: Record<string, unknown>): Record<string, unknown> {
  const { workstream, level, id: _id, ...rest } = args;
  return { ...rest, ...(workstream !== undefined ? { area: workstream } : {}), ...(level !== undefined ? { milestone: level } : {}) };
}

export function buildQuestServer(person: Person): McpServer {
  const server = new McpServer(
    { name: 'dungeon-door-quest-log', version: '1.0.0' },
    {
      instructions:
        'The Dungeon Door quest log: the team\'s shared progress board. Call quest_get_board first to learn the level and ' +
        'workstream ids. Keep the board truthful: when you start a task set its status to "doing", when it is finished set ' +
        '"done" and add a link to the pull request. Changes are recorded under the signed-in team member.',
    },
  );

  server.registerTool('quest_whoami', {
    title: 'Who am I',
    description: 'Report which team member this connection acts as, and whether they are an admin (admins can also change levels, workstreams and the board headline).',
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  }, async () => reply({ login: person.id, name: person.name, role: person.role, team: PEOPLE.map((p) => ({ login: p.id, name: p.name, role: p.role })) }));

  server.registerTool('quest_get_board', {
    title: 'Get the board',
    description:
      'Overview of the project: the headline, where the party stands (the current level), every level (milestone) and workstream with ' +
      'done/doing/todo counts, the team, and the ids to use in other tools. Does not list tasks: use quest_list_tasks for those. Call this first.',
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  }, async () => {
    const { meta, tasks } = await board();
    return reply({ summary: meta.summary, facts: meta.facts, ...progressOf(meta, tasks), team: PEOPLE.map((p) => ({ login: p.id, name: p.name, role: p.role })) });
  });

  server.registerTool('quest_list_tasks', {
    title: 'List tasks',
    description:
      'List tasks, optionally filtered. Examples: what is in progress (status "doing"); what Uncle Bob owns (owner "unclebob"); ' +
      'open work for the rules engine (workstream "rules", status "todo"); unassigned work (owner "unassigned"). Results are paged: ' +
      'when has_more is true, call again with offset = next_offset.',
    inputSchema: z.strictObject({
      status: statusEnum.optional().describe('Only tasks with this status'),
      workstream: z.string().optional().describe('Only this workstream id'),
      level: z.string().optional().describe('Only this level (milestone) id'),
      owner: z.string().optional().describe('Only tasks owned by this GitHub login, or "unassigned"'),
      search: z.string().max(100).optional().describe('Case-insensitive text to find in titles and notes'),
      limit: z.number().int().min(1).max(100).default(50).describe('Maximum tasks to return'),
      offset: z.number().int().min(0).default(0).describe('Tasks to skip, for paging'),
    }),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ status, workstream, level, owner, search, limit, offset }) => {
    const needle = search?.trim().toLowerCase();
    const order = { doing: 0, todo: 1, done: 2 } as const;
    const all = (await quests().list())
      .filter((t) => (!status || t.status === status) && (workstream === undefined || t.area === workstream) && (level === undefined || t.milestone === level))
      .filter((t) => owner === undefined || (owner === 'unassigned' ? !t.owner : t.owner.toLowerCase() === owner.toLowerCase()))
      .filter((t) => !needle || `${t.title} ${t.notes}`.toLowerCase().includes(needle))
      .sort((a, b) => order[a.status] - order[b.status] || (a.updatedAt < b.updatedAt ? 1 : -1));
    let tasks = all.slice(offset, offset + limit).map(view);
    const render = () => {
      const next = offset + tasks.length;
      return { total: all.length, count: tasks.length, offset, tasks, has_more: all.length > next, ...(all.length > next ? { next_offset: next } : {}) };
    };
    // Stay under the size cap by returning fewer tasks, never by cutting text.
    while (tasks.length > 1 && JSON.stringify(render(), null, 1).length > CHARACTER_LIMIT) tasks = tasks.slice(0, Math.ceil(tasks.length / 2));
    return reply(render());
  });

  server.registerTool('quest_get_task', {
    title: 'Get a task',
    description: 'One task in full, by id (ids come from quest_list_tasks).',
    inputSchema: z.strictObject({ id: z.string().min(1).max(80).describe('Task id, e.g. "character-generation"') }),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ id }) => {
    const task = await quests().get(id);
    if (!task) throw new Error(`No task with id "${id}". Use quest_list_tasks to find the right id.`);
    return reply({ ...view(task), created_at: task.createdAt, created_by: task.createdBy });
  });

  server.registerTool('quest_add_task', {
    title: 'Add a task',
    description: 'Add a task to the board, recorded under your name. Give it a workstream and a level when you can (ids from quest_get_board). Returns the new task with its id.',
    inputSchema: z.strictObject(taskFields),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (args) => reply(view(await addTask(person, toBody(args)))));

  server.registerTool('quest_update_task', {
    title: 'Update a task',
    description:
      'Change a task: only the fields you send are changed. Use it to move work along (status "doing" when you start, "done" when finished), ' +
      'to reassign it, to retitle it, or to attach a link or notes.',
    inputSchema: z.strictObject({
      id: z.string().min(1).max(80).describe('Task id from quest_list_tasks'),
      ...taskFields,
      title: taskFields.title.optional(),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args) => reply(view(await editTask(person, args.id, toBody(args)))));

  server.registerTool('quest_delete_task', {
    title: 'Delete a task',
    description: 'Remove a task from the board for everyone. This cannot be undone. Prefer marking a task done; delete only duplicates or mistakes.',
    inputSchema: z.strictObject({ id: z.string().min(1).max(80).describe('Task id from quest_list_tasks') }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ id }) => {
    await removeTask(id);
    return reply({ deleted: id });
  });

  // ---- shaping the board (admins) ----

  // Levels carry a one-line description; workstreams are just a name. The workstream schemas are the
  // same minus that field (strict, so sending one is refused), typed as the level schemas for brevity.
  const position = z.number().int().min(1).optional();
  const levelAdd = z.strictObject({
    name: z.string().min(1).max(60).describe('Name'),
    description: z.string().max(240).optional().describe('One line on what clearing this level means'),
    position: position.describe('1-based place in the order; the end when omitted'),
  });
  const levelUpdate = z.strictObject({
    id: z.string().min(1).max(40).describe('Id from quest_get_board'),
    name: z.string().min(1).max(60).optional().describe('New name'),
    description: z.string().max(240).optional().describe('New description'),
    position: position.describe('New 1-based place in the order'),
  });
  const workstreamAdd = z.strictObject({ name: levelAdd.shape.name, position: levelAdd.shape.position }) as unknown as typeof levelAdd;
  const workstreamUpdate = z.strictObject({ id: levelUpdate.shape.id, name: levelUpdate.shape.name, position: levelUpdate.shape.position }) as unknown as typeof levelUpdate;

  const sectionTools = (section: 'milestones' | 'areas', noun: 'level' | 'workstream', what: string) => {
    const isLevel = section === 'milestones';
    const shape = async () => progressOf(await quests().meta(), await quests().list())[isLevel ? 'levels' : 'workstreams'];
    server.registerTool(`quest_add_${noun}`, {
      title: `Add a ${noun}`,
      description: `Admin only. Add a ${noun} (${what}). Returns all ${noun}s with their ids.`,
      inputSchema: isLevel ? levelAdd : workstreamAdd,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    }, async (args) => {
      await addSectionItem(person, section, { name: args.name, blurb: args.description, position: args.position });
      return reply({ [`${noun}s`]: await shape() });
    });
    server.registerTool(`quest_update_${noun}`, {
      title: `Update a ${noun}`,
      description: `Admin only. Rename a ${noun}${isLevel ? ', change its description' : ''} or move it to another place in the order. Only the fields you send change.`,
      inputSchema: isLevel ? levelUpdate : workstreamUpdate,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async (args) => {
      await updateSectionItem(person, section, args.id, { name: args.name, blurb: args.description, position: args.position });
      return reply({ [`${noun}s`]: await shape() });
    });
    server.registerTool(`quest_delete_${noun}`, {
      title: `Delete a ${noun}`,
      description: `Admin only. Remove a ${noun}. Its tasks are kept but no longer belong to any ${noun}. This cannot be undone.`,
      inputSchema: z.strictObject({ id: z.string().min(1).max(40).describe(`${noun} id from quest_get_board`) }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    }, async ({ id }) => {
      await deleteSectionItem(person, section, id);
      return reply({ deleted: id, [`${noun}s`]: await shape() });
    });
  };
  sectionTools('milestones', 'level', 'a milestone or objective of the project; levels are cleared in order');
  sectionTools('areas', 'workstream', 'an area of the project that tasks are grouped by');

  server.registerTool('quest_update_board_info', {
    title: 'Update the board headline',
    description:
      'Admin only. Change the one-paragraph summary shown at the top of the quest log, and/or the facts beside it (for example "Latest build": "TestFlight 0.1 (4)"). ' +
      'Sending facts replaces the whole list, so include the ones you want to keep (quest_get_board shows the current list).',
    inputSchema: z.strictObject({
      summary: z.string().max(400).optional().describe('New summary paragraph'),
      facts: z.array(z.strictObject({
        label: z.string().min(1).max(40).describe('e.g. "Latest build"'),
        value: z.string().min(1).max(120).describe('e.g. "TestFlight 0.1 (4)"'),
        href: z.string().max(300).optional().describe('Optional https:// link'),
      })).max(8).optional().describe('The complete list of facts to show'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args) => {
    requireAdmin(person);
    const meta = await saveMeta(person, args);
    return reply({ summary: meta.summary, facts: meta.facts });
  });

  return server;
}
