# The quest log: board, admin portal and MCP server

The quest log is the team's progress board. It lives on the website and can be managed three ways:
in the browser, through the REST API, and by AI agents through an MCP server. How agents are
expected to use it is in the README ("For AI agents: tracking work on the quest log").

| What | Where |
| --- | --- |
| The board (public, read-only until you sign in) | https://the-dungeon-door.vercel.app/quest-log |
| Admin portal (tasks, levels, workstreams, headline) | https://the-dungeon-door.vercel.app/admin |
| MCP server (Streamable HTTP, stateless) | https://the-dungeon-door.vercel.app/api/mcp |
| REST API | `/api/quests`, `/api/quest-meta`, `/api/quest-me` |

Vocabulary: a **level** is a milestone (levels are cleared in order, and "where the party stands"
is the first level with unfinished work); a **workstream** is an area of the project; a task's
**status** is `todo`, `doing` or `done`.

## Who can change it

The team is four GitHub accounts, listed in `server/lib/quests.ts`:

| Account | Role |
| --- | --- |
| LupusDei, unclebob, slagyr | admin: tasks, plus levels, workstreams and the headline |
| slagyr-assistant | member: tasks |

Sign-in is a personal **quest key** per account (`server/lib/identity.ts`), sent as
`Authorization: Bearer <key>` or in the `x-quest-key` header. On the website, "Team sign-in" asks
for it once and keeps it in that browser. The server stores only the keys' SHA-256 hashes, in the
`QUEST_KEYS` environment variable (`{ "<hash>": "<login>" }`); the owner keeps the keys themselves
and hands them out.

This is a development-stage arrangement: a key is a long-lived shared secret, anyone holding it acts
as its owner, and there is no expiry. Replacing it with a proper sign-in is on the board.

To issue a new key or replace one: generate a random string, add its hash to `QUEST_KEYS` on the
Vercel project (removing the old hash), and redeploy.

## REST API

```bash
curl https://the-dungeon-door.vercel.app/api/quests                 # the whole board, public
curl -X POST https://the-dungeon-door.vercel.app/api/quests \
  -H "x-quest-key: $QUEST_KEY" -H "content-type: application/json" \
  -d '{"title": "What needs doing", "area": "rules", "milestone": "armory", "owner": "unclebob"}'
```

- `GET /api/quests`: `{ meta, people, tasks }`. `meta` holds `summary`, `milestones` (the levels), `areas` (the workstreams) and `facts`.
- `POST /api/quests`: add a task. `PATCH /api/quests?id=…`: change the fields you send. `DELETE /api/quests?id=…`.
- `PUT /api/quest-meta` (admins): replace any of `summary`, `milestones`, `areas`, `facts`. Lists keep the order sent; an entry without an `id` is new; tasks that pointed at a removed level or workstream are kept, unassigned from it.
- `GET /api/quest-me`: which team member a key belongs to.

## MCP server

`server/api/mcp.ts` serves the tools defined in `server/lib/mcp.ts` with the official SDK
(`@modelcontextprotocol/server`), statelessly: every request is answered on its own, so it scales
like any other function. The tools and the setup for each client are in the README.

Check a running server the way a client would:

```bash
cd server && npm run mcp:smoke                                         # local dev server
cd server && QUEST_KEY=… npm run mcp:smoke -- https://the-dungeon-door.vercel.app
```

## Working on it locally

```bash
cd server && npm run dev        # site + API + MCP on http://localhost:3000, with a seeded board
```

Locally the quest key `dev-<GitHub login>` works (for example `dev-unclebob`). Data lives in the
`quest_docs` table in production and in memory locally (seeded from `server/db/quest-seed.json`).
Tests: `npm test` (`lib/quests.test.ts`, `lib/mcp.test.ts`).
