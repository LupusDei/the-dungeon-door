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
| `docs/api.md` | The contract between app and server. |
| `design/` | Source art and recipes for generated assets. |

## Where tasks live

The team's shared board is the quest log on the website: https://the-dungeon-door.vercel.app/quest-log
(API: `GET /api/quests`, and `POST`/`PATCH`/`DELETE` with the `x-quest-key` header; see the README).
When you start, finish or discover team-level work, update it there if you have been given a quest
key (it is in the `QUEST_KEY` environment variable when you have one; never print it or commit it).
`bd` is for your own working notes inside this repository, not for coordinating with the team.

## Build & Test

Server (Node 22+), from `server/`:

```bash
npm install
npm run typecheck && npm test     # must pass before any server change is done
npm run dev                       # http://localhost:3000, fake AI, in-memory store, costs nothing
npm run bot -- --base http://localhost:3000 --code ABCDEF   # a second player for a game in the lobby
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
  calls spend the owner's AI Gateway credits; `npm run dev:real` is for deliberate checks only.
- **No secrets in the repo.** `ios/Config/Secrets.xcconfig`, `ios/fastlane/.env`, `AuthKey.p8`,
  `api_key.json` and `server/.env*` are gitignored and stay that way.
- **Deploys and releases are the owner's.** Don't run `vercel deploy` or `ios/ship.sh` unless the owner asks you to.
- **Art.** Build-time art (icon, home-screen dragon, sounds) is generated with the owner's Runway
  account (recipes in `design/`); in-game art (portraits, scenes) goes through the AI Gateway at
  runtime. Voices are original designs, never imitations of real people.
- **App code.** SwiftUI with `@Observable` models, Swift 5 language mode, no third-party packages.
  Reuse `Palette`, `.card()`, `.glassCard()` and the button styles in `UI/Theme.swift`.
