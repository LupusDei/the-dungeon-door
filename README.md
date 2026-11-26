# The Dungeon Door

A tabletop-style Dungeons & Dragons game where the dungeon master is an AI. Players forge a hero
(described in their own words, painted by generative AI), gather in a party by door code, chat,
pick a dungeon master, and play through AI-written, AI-illustrated scenes. Each scene offers the
same three choices to everyone; every player votes (with a d20 roll), and the dungeon master
narrates what the party's choice leads to.

Under the story runs a real fifth-edition rules engine (SRD 5.2). Every hero has a character sheet
(abilities, skills, hit points, attacks, spells, gear) and levels up from one adventure to the next.
A choice can be a skill check, a saving throw, a fight, a rest or a door in a mapped dungeon; the
engine rolls and keeps the numbers, the dungeon master tells the tale. Fights run in rounds where each
player picks their own hero's action.

## Layout

| Path | What |
| --- | --- |
| `ios/` | SwiftUI iPhone/iPad app (XcodeGen). Character forge, lobby, chat, scenes and voting. |
| `server/` | Vercel functions (TypeScript, AI SDK via Vercel AI Gateway). Game state, portraits, the DM. |
| `server/lib/dm/` | **The dungeon master seam.** Swap or add DM implementations here. See `docs/dungeon-master.md`. |
| `docs/api.md` | The API contract between the app and the server. Change it first, then both sides. |
| `docs/quest-log.md` | The team's progress board: admin portal, MCP server, sign-in. |

## Run it

Server (local, no AI spend; see `server/README.md` for details):

```bash
cd server && npm install && DD_FAKE_AI=1 npm run dev
```

App on the simulator, pointed at the local server:

```bash
cd ios && ./run.sh -apiBase http://localhost:3000
```

A second player for testing, from another terminal (use the door code shown in the lobby):

```bash
cd server && npm run bot -- --base http://localhost:3000 --code ABCDEF
```

The deployed server is https://the-dungeon-door.vercel.app (Vercel project `the-dungeon-door`:
Neon Postgres, Vercel Blob, AI Gateway). It requires the shared app key, which builds read from
`ios/Config/Secrets.xcconfig` (gitignored: `DD_APP_KEY = …`, ask the owner).

## Website and quest log

The marketing site is static files in `server/public/`, served from the same Vercel project as the
API: https://the-dungeon-door.vercel.app. On it:

- `/quest-log`: the team's progress board (milestones as levels of the dungeon, workstreams, tasks). Public to read.
- `/admin`: the admin portal for tasks, levels, workstreams and the headline.
- `/api/mcp`: an MCP server, so AI agents can track their work on the same board.

Sign-in is a personal **quest key**, one per team member (LupusDei, unclebob, slagyr,
slagyr-assistant). The owner hands them out. People paste theirs into "Team sign-in" on the site;
agents send it as a bearer token. This is a development-stage shortcut; a stronger sign-in will
replace it. More detail: [`docs/quest-log.md`](docs/quest-log.md).

## For AI agents: tracking work on the quest log

If you are an AI agent working on this project, the quest log is where the team (people and
agents) sees what is being worked on. Keep it truthful: it should always say what you are doing now.

### 1. Connect

You need the quest key of the team member you are working for, in the `QUEST_KEY` environment
variable. Never print it, paste it into a chat, or commit it.

- **Claude Code, inside this repository:** nothing to do. `.mcp.json` already points at the
  server and reads `QUEST_KEY` from the environment. Approve the `dungeon-door` server when asked.
- **Claude Code, anywhere else:**

  ```bash
  claude mcp add --transport http dungeon-door https://the-dungeon-door.vercel.app/api/mcp \
    --header "Authorization: Bearer $QUEST_KEY"
  ```

- **Cursor and other MCP clients:** add a streamable HTTP server with one header.

  ```json
  {
    "mcpServers": {
      "dungeon-door": {
        "type": "http",
        "url": "https://the-dungeon-door.vercel.app/api/mcp",
        "headers": { "Authorization": "Bearer YOUR_QUEST_KEY" }
      }
    }
  }
  ```

- **No MCP support:** use the REST API in step 4 with the same key.

Check the connection by calling `quest_whoami`: it says which team member you are acting as.

### 2. The working agreement

1. **Orient at the start of a session.** Call `quest_get_board` (where the project stands, the ids
   of the levels and workstreams, and how many issues are open and yours), then `quest_list_issues`
   for your owner's open bugs and balance problems, and `quest_list_tasks` for their other open work
   (`owner: "<their GitHub login>"`, `status: "todo"` or `"doing"`).
2. **Before you start a piece of work, claim it.** Find its task with `quest_list_tasks`
   (`search: "…"`). If there is none, create it with `quest_add_task`: a short title, the
   workstream, the level, and `owner` set to the GitHub login you are working for. Then set it to
   `status: "doing"` with `quest_update_task`. One task per piece of work someone would recognise;
   not one per file or per commit.
3. **While you work, record what you discover.** Follow-up work and open questions that belong to the
   team go on the board as new `todo` tasks (leave `owner` empty if nobody has taken them). A problem
   in something already built goes on as an **issue** for whoever owns that code (see "Issues" below).
4. **When you finish, close it.** `quest_update_task` with `status: "done"`, the pull request URL in
   `link`, and one or two sentences in `notes` on what landed and anything left out. A task is
   done when its work is merged or otherwise finished; while a pull request is open it stays
   `doing`, with the link attached.
5. **If you stop without finishing,** set the task back to `todo` and say in `notes` where it stands.

### Issues: bugs and balance problems

A task has a `kind`: `task` (the default), `bug` (something built behaves wrongly) or `balance`
(it works as written but plays badly: too deadly, too slow, too costly, too weak). Bugs and balance
problems are **issues**. On the website they carry a badge, lead the To do column, and are counted in
a strip above the board; `quest_get_board` reports them as `open_issues`.

- **Working your issues.** `quest_list_issues` returns the open issues assigned to you (or
  `owner: "anyone"`), most severe first, with each one's full brief in `details`. Take one, set it to
  `doing`, reproduce it with the command or test in its brief, fix it test-first, and close it as in
  step 4. If you think an issue is wrong, say why in `notes` and leave it open for its reporter.
- **Filing an issue for someone else.** Don't fix another person's code silently and don't leave the
  finding in a chat. `quest_add_task` with `kind`, a `severity` (`high`: breaks or strands a game or
  loses data; `medium`: wrong results players will notice; `low`: cosmetic or unlikely), their login as
  `owner`, one line in `notes`, and a `details` brief that stands on its own:

  ```text
  WHAT IS WRONG      what happens, in a sentence or two, and why it matters to a player or the owner
  WHERE              files and functions
  REPRODUCE          a command to run or a test to paste, with the output you got
  EXPECTED           what should happen instead
  SUGGESTED FIX      a direction, and anything you tried; the owner of the code decides
  DONE WHEN          checks that would show it is fixed (a test, a number from `npm run fights`, …)
  ```

  Measure before you call something a balance problem: `npm run playtest` and `npm run fights` (in
  `server/`) play real games and fights with bots and cost nothing.

Ground rules:

- Change your own tasks freely; change someone else's only to add information, never to reassign
  or close it without being asked.
- Don't delete tasks to tidy up. Deleting is for duplicates and mistakes; finished work is `done`.
- Levels, workstreams and the headline (`quest_add_level`, `quest_update_board_info`, …) are the
  owner's to shape. Use those tools only when asked. They work only for admins.
- Notes are public on the website: no secrets, keys or private details.
- Keep the board and reality in step: if the code says a task is finished, so should the board.

### 3. Tools

| Tool | Use it to |
| --- | --- |
| `quest_whoami` | See which team member you act as, and your role |
| `quest_get_board` | Get the headline, the current level, every level and workstream with counts, and their ids |
| `quest_list_issues` | List open bugs and balance problems with their full briefs; yours by default, `owner: "anyone"` for all |
| `quest_list_tasks` | List tasks, filtered by `status`, `owner` (or `"unassigned"`), `workstream`, `level`, `kind`, `search`; paged |
| `quest_get_task` | Read one task in full, including its `details` brief |
| `quest_add_task` | Add a task: `title`, and optionally `workstream`, `level`, `status`, `owner`, `notes`, `link`, `kind`, `severity`, `details` |
| `quest_update_task` | Change a task; only the fields you send change (`status`, `owner`, `notes`, `link`, …) |
| `quest_delete_task` | Remove a duplicate or a mistake |
| `quest_add_level`, `quest_update_level`, `quest_delete_level` | Admins: shape the milestones |
| `quest_add_workstream`, `quest_update_workstream`, `quest_delete_workstream` | Admins: shape the workstreams |
| `quest_update_board_info` | Admins: change the summary and the facts (for example the latest build) |

A level is a milestone; levels are cleared in order, and "where the party stands" is the first one
with unfinished work. Statuses are `todo`, `doing` and `done`. Owners are GitHub logins.

A typical session:

```text
quest_get_board                                   → levels: door, gatehouse, perch, armory, …; workstreams: app, server, rules, …
quest_list_tasks { owner: "unclebob", status: "todo" }
quest_update_task { id: "character-generation", status: "doing" }
…do the work, open a pull request…
quest_update_task { id: "character-generation", link: "https://github.com/LupusDei/the-dungeon-door/pull/2" }
quest_add_task { title: "Starting gear tables for the artificer", workstream: "rules", level: "armory" }
…the pull request merges…
quest_update_task { id: "character-generation", status: "done", notes: "Abilities, class, race and gear from the SRD tables. Multiclassing left out." }
```

### 4. Without MCP

The same key works with the REST API:

```bash
curl https://the-dungeon-door.vercel.app/api/quests                  # the whole board; no key needed
curl -X POST https://the-dungeon-door.vercel.app/api/quests \
  -H "x-quest-key: $QUEST_KEY" -H "content-type: application/json" \
  -d '{"title": "What needs doing", "area": "rules", "milestone": "armory", "owner": "unclebob"}'
curl -X PATCH "https://the-dungeon-door.vercel.app/api/quests?id=TASK_ID" \
  -H "x-quest-key: $QUEST_KEY" -H "content-type: application/json" -d '{"status": "done"}'
```

(The API calls a workstream `area` and a level `milestone`; the MCP tools call them `workstream` and `level`.)

## Shipping

Work from the team (LupusDei, unclebob, slagyr, slagyr-assistant) ships when it lands: it is
integrated into `main`, pushed, migrated, deployed and sent to TestFlight by default, without anyone
asking. The steps, the gates and the short list of things that still need the owner's word are in
`AGENTS.md` under "Shipping is the default". The commands, from the owner's machine:

```bash
cd server && npm run typecheck && npm test      # gates
cd server && npm run dm:check                   # when the dungeon master's prompt or schema changed (real model, ~5 cents)
git push origin main
cd server && npm run migrate                    # only when db/schema.sql changed
cd server && vercel deploy --prod
cd ios && ./ship.sh "What's new in this build"  # builds a clean copy of HEAD, uploads with fastlane
```

`ship.sh` needs the gitignored credentials in `ios/fastlane/` and `ios/Config/Secrets.xcconfig`.

## MVP shape

- **No sign-in.** Each device makes a random player id; heroes belong to it.
- **Polling, not sockets.** The app polls the game every 2 s. Good enough for turn-based play.
- **Swappable models.** Text and image models are AI Gateway ids set by env (`DD_TEXT_MODEL`,
  `DD_IMAGE_MODEL`), so Claude, Grok, etc. are a config change.
- **Rules.** The engine in `server/lib/rules/` (pure, seeded, test-first) owns every number; the
  dungeon master proposes and narrates. See `docs/rules-design.md`.
- **Later:** voice chat in your character's voice, DM narration voices (archetypes already carry a
  voice description).

## Rules data and attribution

The open-licensed fifth-edition tables the rules engine reads live in [`server/data/srd/`](server/data/srd/). Prefer the `5.2/` folder (2024 rules). A rules digest is in [`docs/rules-digest.md`](docs/rules-digest.md). Full file lists, rebuild instructions, and license text are in [`server/data/srd/README.md`](server/data/srd/README.md).

This work includes material from the System Reference Document 5.2 and the System Reference Document 5.1 by Wizards of the Coast LLC, licensed under the [Creative Commons Attribution 4.0 International License](https://creativecommons.org/licenses/by/4.0/legalcode). Additional extras are CC-BY-4.0 (Level Up: Advanced 5th Edition and Old-School Essentials), OGL 1.0a (Pathfinder starting wealth; see [`server/data/srd/extras/OGL-LICENSE.md`](server/data/srd/extras/OGL-LICENSE.md)), or CC0 (original procedures for this game). Nothing was copied from the Dungeon Master's Guide or from 1e AD&D Appendix A.
