# The quest log: board, admin portal and MCP server

The quest log is the team's progress board. It lives on the website and can be managed three ways:
in the browser, through the REST API, and by assistants through an MCP server.

| What | Where |
| --- | --- |
| The board (public, read-only until you sign in) | https://the-dungeon-door.vercel.app/quest-log |
| Admin portal (tasks, levels, workstreams, headline) | https://the-dungeon-door.vercel.app/admin |
| MCP server (Streamable HTTP) | https://the-dungeon-door.vercel.app/api/mcp |
| REST API | `/api/quests`, `/api/quest-meta` |

Vocabulary: a **level** is a milestone (the board's levels are cleared in order, and "where the
party stands" is the first level with unfinished work); a **workstream** is an area of the project;
a task's **status** is `todo`, `doing` or `done`.

## Who can change it

The team is four GitHub accounts, listed in `server/lib/quests.ts`:

| Account | Role |
| --- | --- |
| LupusDei, unclebob, slagyr | admin: tasks, plus levels, workstreams and the headline |
| slagyr-assistant | member: tasks |

Three ways to prove you are one of them (`server/lib/identity.ts`):

1. **GitHub sign-in** on the website (a session cookie). Needs the GitHub OAuth app below.
2. **An MCP access token**, which an MCP client gets by sending you through that same GitHub
   sign-in and an approval screen. Tokens last an hour and refresh themselves.
3. **A personal quest key**, for scripts and for assistants without a browser: the `x-quest-key`
   header, or `Authorization: Bearer <key>`. Keys are handed out by the owner; only their hashes
   are stored (the `QUEST_KEYS` environment variable).

## Connecting an assistant (MCP)

```bash
claude mcp add --transport http dungeon-door https://the-dungeon-door.vercel.app/api/mcp
```

Then run `/mcp` in Claude Code, pick `dungeon-door` and sign in with GitHub. Other clients take the
same URL as a "streamable HTTP" server. Without a browser, pass a quest key instead:

```bash
claude mcp add --transport http dungeon-door https://the-dungeon-door.vercel.app/api/mcp \
  --header "Authorization: Bearer $QUEST_KEY"
```

Tools (all prefixed `quest_`): `whoami`, `get_board`, `list_tasks`, `get_task`, `add_task`,
`update_task`, `delete_task`, and for admins `add_level`, `update_level`, `delete_level`,
`add_workstream`, `update_workstream`, `delete_workstream`, `update_board_info`. Start with
`quest_get_board`: it returns the level and workstream ids the other tools take.

Check a running server the way a client would:

```bash
cd server && npm run mcp:smoke                                         # local dev server
cd server && QUEST_KEY=… npm run mcp:smoke -- https://the-dungeon-door.vercel.app
```

## Setting up GitHub sign-in (once, by the owner)

1. On GitHub: Settings → Developer settings → OAuth Apps → New OAuth App.
   - Homepage URL: `https://the-dungeon-door.vercel.app`
   - Authorization callback URL: `https://the-dungeon-door.vercel.app/api/auth/callback`
2. Copy the client ID, generate a client secret, and add both to the Vercel project:

   ```bash
   cd server
   vercel env add GITHUB_CLIENT_ID production
   vercel env add GITHUB_CLIENT_SECRET production
   vercel deploy --prod
   ```

`SESSION_SECRET` (which signs the session cookie) is already set on the project. Until the two
GitHub values exist, the site says GitHub sign-in isn't set up and quest keys are the way in.

## How sign-in for MCP clients works

GitHub can't be an MCP client's authorization server directly: it has no discovery document, no
client registration and no tokens bound to a particular server. So the site runs a small OAuth 2.1
authorization server of its own (`server/lib/oauth.ts`) that uses GitHub only to learn who you are:

1. The client calls `/api/mcp` without a token and gets a `401` pointing at
   `/.well-known/oauth-protected-resource/api/mcp`, which names this site as the authorization server.
2. It registers itself (`POST /api/oauth/register`) and opens `/api/oauth/authorize` in your browser.
3. You sign in with GitHub, then see an approval screen naming the client. Nothing is approved silently.
4. The client swaps the resulting one-time code for tokens (`POST /api/oauth/token`).

Deliberately narrow: public clients only, PKCE (S256) required, exact redirect matching (any port on
localhost), single-use codes, rotating refresh tokens, tokens valid only for this site's `/api/mcp`,
and codes and tokens stored only as hashes (`auth_docs` table). Browser sessions that change data
must send `x-requested-with`, so another site can't act through a signed-in visitor.

## REST API

```bash
curl https://the-dungeon-door.vercel.app/api/quests                 # the whole board, public
curl -X POST https://the-dungeon-door.vercel.app/api/quests \
  -H "x-quest-key: $QUEST_KEY" -H "content-type: application/json" \
  -d '{"title": "What needs doing", "area": "rules", "milestone": "armory", "owner": "unclebob"}'
```

`PATCH /api/quests?id=…` changes the fields you send, `DELETE /api/quests?id=…` removes a task, and
`PUT /api/quest-meta` (admins) replaces any of `summary`, `milestones`, `areas`, `facts`.

## Working on it locally

```bash
cd server && npm run dev                              # site + API + MCP on http://localhost:3000, seeded board
cd server && DD_FAKE_GITHUB_LOGIN=unclebob npm run dev   # also lets "Sign in with GitHub" work, as that account
```

Locally the quest key `dev-<GitHub login>` works. `scripts/mcp-oauth-check.ts` drives a real MCP
client through the whole sign-in flow against the local server. Tests: `npm test`
(`lib/quests.test.ts`, `lib/signin.test.ts`, `lib/mcp.test.ts`).
