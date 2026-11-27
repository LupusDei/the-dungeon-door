# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:6cd5cc61 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->


## The project

The Dungeon Door is a tabletop-style fantasy game with an AI dungeon master. Players forge a hero
(AI-painted portrait), gather in a party by door code, chat, and vote on three choices per scene.

| Path | What |
| --- | --- |
| `ios/` | SwiftUI iPhone/iPad app (XcodeGen). `Core/` talks to the server, `Views/` are the screens, `UI/` holds the theme and the home-screen dragon. |
| `server/` | Vercel functions in TypeScript (`api/*.ts`), logic in `lib/`. Postgres (Neon) or in-memory storage; images in Vercel Blob. |
| `server/public/` | The marketing website and the quest log page (static HTML, CSS and JS; no build step). |
| `server/lib/dm/` | The dungeon master seam. New or changed DM behaviour goes here; see `docs/dungeon-master.md`. |
| `server/lib/rules/` | The 5e rules engine (pure, seeded, test-first; Uncle Bob's). See `docs/rules-design.md`. |
| `server/lib/play/` | The engine at the table: what a choice's rules hook does, fights as rounds, dungeons, rests. |
| `docs/api.md` | The contract between app and server. |
| `design/` | Source art and recipes for generated assets. |

## Where tasks live

The team's shared board is the quest log (https://the-dungeon-door.vercel.app/quest-log), and you
are expected to keep it current through its MCP server, `dungeon-door`
(`https://the-dungeon-door.vercel.app/api/mcp`; this repository's `.mcp.json` configures it and
reads your quest key from `QUEST_KEY`).

The agreement, in short (the full version, with every tool, is the README section
"For AI agents: tracking work on the quest log"):

1. Start of session: `quest_get_board`, then `quest_list_issues` (your owner's open bugs and balance
   problems, each with a full brief) and `quest_list_tasks` for their other open work.
2. Before starting work: find its task or create it (`quest_add_task`), then set it to `doing`.
3. Record follow-ups and discovered work as new `todo` tasks; a problem in someone else's code as an
   issue for them (`kind: "bug"` or `"balance"`, a `severity`, and `details` complete enough to fix it).
4. When it lands: `quest_update_task` with `status: "done"`, the pull request in `link`, and a line of `notes`.
5. Never print or commit the quest key; notes are public, so no secrets in them.

An **issue** is a task whose kind is `bug` or `balance`. `quest_list_issues` returns the open ones
assigned to your owner, most severe first, each with a full brief in `details` (what is wrong, where, how
to reproduce it, what done looks like): enough to fix it without asking anyone. When you find a problem in
code someone else owns, file it for them the same way (`quest_add_task` with `kind`, `severity`, their
login as `owner`, and a complete `details`) instead of fixing it silently or leaving it in a chat.

If the MCP server isn't connected, use the REST API with the `x-quest-key` header (README, step 4).
`bd` is for your own working notes inside this repository, not for coordinating with the team.

## Shipping is the default

Work from the team ships when it lands. The team is **LupusDei** (the owner), **unclebob**, **slagyr**
and **slagyr-assistant**. For work that comes from any of them (the owner asking in a session, a push to
`main`, or a pull request), the whole release is the default, start to finish, without asking first:

1. **Integrate** it into `main`: review it, merge it, and make the rest of the project agree with it
   (the contract in `docs/api.md`, the server, the app). Anything the engine can now do should be
   reachable in the app.
2. **Gates.** `npm run typecheck && npm test && npm run features` pass in `server/`: typecheck, the
   unit tests and the Gherkin features, with no scenario skipped. Every behavior change comes with a
   Gherkin scenario in `server/features/` that pins it down. The app builds; what changed on
   screen was looked at on the simulator. When `server/lib/dm/` or what the dungeon master is told
   changed, `npm run dm:check` passes too: three real text calls (about five cents) that prove the
   model accepts the schema and writes hooks the engine takes. The fake DM cannot show that.
3. **Commit and push** `main` (`git push origin main`, as its own command).
4. **Migrate and deploy** happen on the push, in GitHub Actions (`.github/workflows/deploy-server.yml`):
   any push to `main` that touches `server/` applies `db/schema.sql` to production, then runs
   `vercel deploy --prod` and checks the live site answers. Migrations are additive
   (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`), so they run on every deploy. Watch the
   run (`gh run watch`); if Actions is down, `cd server && npm run migrate && vercel deploy --prod`.
5. **Ship a TestFlight build** by bumping `MARKETING_VERSION` in `ios/project.yml` in the push, when
   `ios/` changed or the server now sends something the app should show. The push builds and uploads
   it (`.github/workflows/testflight.yml`) and tags `testflight/v<version>`; a version already tagged
   is not shipped again. "Run workflow" on that workflow ships without a bump; `cd ios && ./ship.sh
   "What's new"` still ships from the owner's Mac.
6. **Releases require passing gates.** `.github/workflows/tests.yml` runs typecheck, the unit tests
   and the Gherkin features on every push to `main` and every pull request; the migrate and deploy
   job and the TestFlight upload both need it to pass (TestFlight also compiles the app for the
   simulator first). A red gate stops the release, so run the gates locally (step 2) before pushing.
7. **Update the quest log**: tasks done with their links, problems found filed as issues for whoever
   owns the code, and the "Latest build" fact.

Who does which part: the credentials for steps 4 and 5 (Vercel, Neon, App Store Connect) live in the
repository's Actions secrets, so whoever pushes `main` releases. A version bump is still the pusher's
call: bump it when the build is worth putting in testers' hands.

Still ask the owner first for: a migration that drops or rewrites data, deleting anything in
production, changing secrets, keys or environment variables, rewriting history on `main`, spending
beyond routine play (real-AI test runs, Runway generations), submitting to App Store review, and
shipping while a gate fails. Work from anyone not on the team is reviewed and reported, not merged or
released.

This repository opts in to the Beads "team-maintainer" profile for the team above: commit and push
are part of finishing the work.

## Build & Test

Server (Node 22+), from `server/`:

```bash
npm install
npm run typecheck && npm test     # must pass before any server change is done
npm run features                  # Gherkin acceptance specs, required to release; needs Babashka. See the root README.
npm run dev                       # http://localhost:3000, fake AI, in-memory store, costs nothing
npm run bot -- --base http://localhost:3000 --code ABCDEF   # a second player for a game in the lobby
npm run playtest                  # bots play whole games through the real flow: deaths, fights, anything that broke
npm run fights                    # how the fights a dungeon rolls go for typical parties
```

App (needs macOS with Xcode and XcodeGen), from `ios/`:

```bash
./run.sh -apiBase http://localhost:3000    # build, install and launch on the simulator
```

A cloud agent without Xcode cannot build or run the app. Keep to `server/` and `docs/` there, or
say plainly that an app change is untested.

## Conventions

- **Contract first.** A change to what the app and server exchange starts in `docs/api.md`, then
  both sides, in the same change.
- **No real AI in tests or dev scripts.** Use `DD_FAKE_AI=1` (the default for `npm run dev`). Real
  calls spend the owner's AI Gateway credits; `npm run dev:real` and `npm run dm:check` are for
  deliberate checks only.
- **No secrets in the repo.** `ios/Config/Secrets.xcconfig`, `ios/fastlane/.env`, `AuthKey.p8`,
  `api_key.json` and `server/.env*` are gitignored and stay that way.
- **Releases.** See "Shipping is the default" above: team work is integrated, pushed, migrated, deployed
  and shipped to TestFlight without asking; a short list of things still needs the owner's word.
- **Commits.** A commit is its author's alone. No `Co-Authored-By` line for an AI tool, whichever
  agent wrote the change.
- **Art.** Build-time art (icon, home-screen dragon, sounds) is generated with the owner's Runway
  account (recipes in `design/`); in-game art (portraits, scenes) and the narrator's readings go through
  the AI Gateway at runtime. Voices are original designs, never imitations of real people.
- **App code.** SwiftUI with `@Observable` models, Swift 5 language mode, no third-party packages.
  Reuse `Palette`, `.card()`, `.glassCard()` and the button styles in `UI/Theme.swift`.
