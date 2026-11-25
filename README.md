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

## MVP shape

- **No sign-in.** Each device makes a random player id; heroes belong to it.
- **Polling, not sockets.** The app polls the game every 2 s. Good enough for turn-based play.
- **Swappable models.** Text and image models are AI Gateway ids set by env (`DD_TEXT_MODEL`,
  `DD_IMAGE_MODEL`), so Claude, Grok, etc. are a config change.
- **Later:** voice chat in your character's voice, DM narration voices (archetypes already carry a
  voice description), richer rules (stats, HP, inventory).
