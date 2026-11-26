# The Dungeon Door

A tabletop-style Dungeons & Dragons game where the dungeon master is an AI. Players forge a hero
(described in their own words, painted by generative AI), gather in a party by door code, chat,
pick a dungeon master, and play through AI-written, AI-illustrated scenes. Each scene offers the
same three choices to everyone; every player votes (with a d20 roll), and the dungeon master weighs
all the votes, not just the majority, to decide what happens next.

## Layout

| Path | What |
| --- | --- |
| `ios/` | SwiftUI iPhone/iPad app (XcodeGen). Character forge, lobby, chat, scenes and voting. |
| `server/` | Vercel functions (TypeScript, AI SDK via Vercel AI Gateway). Game state, portraits, the DM. |
| `server/lib/dm/` | **The dungeon master seam.** Swap or add DM implementations here. See `docs/dungeon-master.md`. |
| `docs/api.md` | The API contract between the app and the server. Change it first, then both sides. |

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

## Ship to TestFlight

```bash
cd ios && ./ship.sh "What's new in this build"
```

Builds a clean copy of HEAD and uploads it with fastlane (certificates via match). Needs the
gitignored credentials in `ios/fastlane/` and `ios/Config/Secrets.xcconfig`.

## MVP shape

- **No sign-in.** Each device makes a random player id; heroes belong to it.
- **Polling, not sockets.** The app polls the game every 2 s. Good enough for turn-based play.
- **Swappable models.** Text and image models are AI Gateway ids set by env (`DD_TEXT_MODEL`,
  `DD_IMAGE_MODEL`), so Claude, Grok, etc. are a config change.
- **Later:** voice chat in your character's voice, DM narration voices (archetypes already carry a
  voice description), richer rules (stats, HP, inventory).

## Rules data and attribution

Open-licensed D&D 5e tables for a forthcoming rules engine live in [`server/data/srd/`](server/data/srd/). Prefer the `5.2/` folder (2024 rules). A rules digest is in [`docs/rules-digest.md`](docs/rules-digest.md). Full file lists, rebuild instructions, and license text are in [`server/data/srd/README.md`](server/data/srd/README.md).

This work includes material from the System Reference Document 5.2 and the System Reference Document 5.1 by Wizards of the Coast LLC, licensed under the [Creative Commons Attribution 4.0 International License](https://creativecommons.org/licenses/by/4.0/legalcode). Additional extras are CC-BY-4.0 (Level Up: Advanced 5th Edition and Old-School Essentials), OGL 1.0a (Pathfinder starting wealth; see [`server/data/srd/extras/OGL-LICENSE.md`](server/data/srd/extras/OGL-LICENSE.md)), or CC0 (original procedures for this game). Nothing was copied from the Dungeon Master's Guide or from 1e AD&D Appendix A.
