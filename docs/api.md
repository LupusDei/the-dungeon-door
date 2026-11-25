# The Dungeon Door — API contract (v1)

The iOS app talks to a Vercel deployment (`server/`). All bodies are JSON, all keys camelCase,
all timestamps ISO-8601 strings, all ids strings.

## Identity and headers

There is no sign-in in the MVP. The app makes a random player id (UUID) on first launch and keeps it.

| Header | Meaning |
| --- | --- |
| `x-dd-player` | The caller's player id (UUID). Required on every endpoint except `GET /api/catalog`. |
| `x-dd-key` | Shared app key (`DD_APP_KEY` on the server). Required when the server has one set. |

Errors are `{ "error": "message" }` with 400 (bad input), 401 (missing/wrong key or player),
403 (not allowed, e.g. not the host), 404 (no such game/character), 409 (wrong game state).

## Catalog

`GET /api/catalog` → the option lists the character forge and lobby show. Server-owned so the
DM team can add archetypes without an app release.

```json
{
  "races":        [{ "id": "elf", "name": "Elf", "blurb": "…" }],
  "classes":      [{ "id": "wizard", "name": "Wizard", "blurb": "…", "symbol": "wand.and.stars" }],
  "temperaments": [{ "id": "brave", "name": "Brave", "blurb": "…" }],
  "genders":      [{ "id": "female", "name": "Female" }],
  "alignments":   [{ "id": "chaotic-good", "name": "Chaotic Good" }],
  "dungeonMasters": [{
    "id": "chronicler", "name": "The Chronicler", "tagline": "…", "description": "…",
    "symbol": "book.closed", "accent": "#C9A227"
  }]
}
```
`symbol` is an SF Symbol name; `accent` a hex colour. Unknown ids are rejected by the endpoints below.

## Characters

```ts
Character {
  id: string            // client-generated UUID
  ownerId: string       // player id
  name: string          // 1–40 chars
  race: string; characterClass: string; gender: string; temperament: string; alignment: string
  backstory: string     // 0–600 chars, player-written
  description: string   // 0–600 chars, player-written look ("scar over left eye, red braid")
  appearance: string | null   // DM-embellished visual description, reused in scene art
  portraitUrl: string | null
  createdAt: string; updatedAt: string
}
```

- `POST /api/portrait` body `{ character: Character-ish (no ids needed), previousAppearance?: string, note?: string }`
  → `{ appearance: string, portraitUrl: string }`. Embellishes the player's description with the
  house art style and the character's race/class/etc., generates a portrait, stores it in Blob.
  `note` is an optional tweak ("make the armour darker") applied on top of `previousAppearance`
  for re-rolls. Slow (10–40 s); the app shows a forging animation.
- `PUT /api/characters` body `Character` (ownerId is ignored, taken from `x-dd-player`) → `Character`.
  Upsert by id; only the owner can update.
- `GET /api/characters` → `{ characters: Character[] }` (mine, newest first).
- `DELETE /api/characters?id=…` → `{ ok: true }`.

## Games

A game is addressed by a 6-letter join code (uppercase, no 0/O/1/I).

```ts
GameState {
  code: string
  hostId: string
  status: "lobby" | "preparing" | "voting" | "resolving" | "ended"
  dungeonMaster: string              // catalog dungeonMasters id
  title: string | null               // DM-named adventure title, set when the game starts
  sceneCount: number                 // scenes planned (default 4, including the finale)
  players: [{ playerId, character: Character, isHost: boolean, joinedAt }]
  scene: Scene | null                // the current scene (null in lobby)
  chronicle: ChronicleEntry[]        // resolved scenes, oldest first (the story so far)
  messages: Message[]                // newest last; only those after `since` when given
  updatedAt: string
}

Scene {
  index: number                      // 0-based
  title: string
  narration: string                  // 2–4 short paragraphs
  imageUrl: string | null            // null while the art is still painting
  choices: [{ id: "a"|"b"|"c", label: string, detail: string }]   // exactly 3; empty for the epilogue
  isFinale: boolean                  // true for the epilogue scene (no choices, game ended)
  votes: [{ playerId, choiceId, roll: number /* d20 */ }]
  myVote: string | null              // choiceId of the caller
  outcome: string | null             // set once resolved: the DM's summary of what the party chose
}

ChronicleEntry {
  index: number; title: string; imageUrl: string | null
  choiceLabel: string                // the label of the most-voted choice (ties: the DM's pick)
  outcome: string                    // what happened, as the DM resolved it
}

Message {
  id: number                         // monotonically increasing per game
  kind: "chat" | "system" | "dm"
  playerId: string | null
  characterName: string | null
  text: string                       // 1–500 chars
  createdAt: string
}
```

- `POST /api/games` body `{ characterId, dungeonMaster? }` → `GameState`. Caller becomes host.
- `GET /api/games/{code}?since={messageId}` → `GameState`. The app polls this every ~2 s.
  Caller must be a player in the game (403 otherwise).
- `POST /api/games/{code}/join` body `{ characterId }` → `GameState`. Lobby only (409 after start).
  Re-joining with a different character swaps the character. Max 6 players.
- `POST /api/games/{code}/leave` → `{ ok: true }`. If the host leaves, the earliest remaining player becomes host.
- `POST /api/games/{code}/messages` body `{ text }` → `Message`.
- `POST /api/games/{code}/dungeon-master` body `{ dungeonMaster }` → `GameState`. Host only, lobby only.
- `POST /api/games/{code}/start` body `{ sceneCount? }` (2–8) → `GameState` with status `preparing`.
  Host only. The DM writes scene 0 in the background; status becomes `voting` when it's ready.
- `POST /api/games/{code}/vote` body `{ sceneIndex, choiceId }` → `GameState`.
  Voting status only; you can change your vote until the scene resolves. The server rolls a d20
  for each vote (kept when you change your vote). When every player has voted the scene resolves:
  status `resolving`, the DM weighs all votes and rolls, writes `outcome` on the old scene and the
  next scene (or the finale) in the background, then status returns to `voting` (or `ended`).
- `POST /api/games/{code}/advance` → `GameState`. Host only: resolve now with the votes that are in
  (for an AFK player). Needs at least one vote.

Images may arrive after their text: a scene can be `voting` with `imageUrl: null`; keep polling.

## Background work and failures

Long DM/image work runs after the response (`waitUntil`). If the DM call fails, the game drops back
to the previous status and a `system` message explains; the host can retry (`start` / `advance`).
