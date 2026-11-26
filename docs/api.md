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
  "backgrounds":  [{ "id": "sage", "name": "Sage", "blurb": "…", "abilities": ["con", "int", "wis"] }],
  "dungeons":     [{ "id": "none", "name": "A tale told", "blurb": "…", "symbol": "book.pages.fill" }],
  "dungeonMasters": [{
    "id": "chronicler", "name": "The Chronicler", "tagline": "…", "description": "…",
    "symbol": "book.closed", "accent": "#C9A227"
  }]
}
```
`symbol` is an SF Symbol name; `accent` a hex colour. Unknown ids are rejected by the endpoints below.
`races`, `classes` and `backgrounds` are exactly the SRD 5.2 (2024) species, classes and backgrounds.
A background's `abilities` are the three scores it can raise (the builder puts +2 and +1 on two of them).
`dungeons` are the kinds of game a host can start (the `dungeon` of `POST …/start`): `none`, `fixed`
and `explore`, in the order to show them.

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
  sheet: CharacterSheet           // the rules engine's numbers; always set in responses (see below)
  attacks: Attack[]               // what the hero can attack with, worked out from the sheet; always set
  createdAt: string; updatedAt: string
}

Attack {
  name: string                    // "Greatsword", "Fire Bolt"
  bonus: number                   // added to the d20 to hit; 0 for a spell the target saves against
  damage: string                  // "2d6+3 slashing"
  ranged: boolean
  kind: "weapon" | "spell"
  save: string | null             // spells only: the save the target makes instead ("dex"), with the hero's spell save DC
}

CharacterSheet {                  // SRD 5.2 (2024 rules); server-owned, see server/lib/rules/sheet.ts
  version: 1
  name: string; level: number /* 1–20 */; xp: number
  classId: string; speciesId: string; backgroundId: string; subclassId: string | null
  size: string; speed: number     // feet
  abilityScores: { str, dex, con, int, wis, cha: number }
  proficiencyBonus: number
  maxHp: number; hp: number; armorClass: number
  hitDiceSpent: number            // of one per level; all come back on a Long Rest
  exhaustion: number              // 0–6 (5.2: −2 per level to d20 tests, −5 ft speed per level; 6 = dead)
  savingThrows: string[]; saveBonuses: { str, dex, …: number }
  skills: string[]; skillBonuses: { [skillId]: number }; passivePerception: number
  equipment: [{ id, name, count }]; gp: number
  traits: string[]; feat: string; feats: string[]; features: string[]
  resourcesUsed: { [resourceId]: number }     // Rage, Second Wind, … spent since their rest
  dead?: boolean                  // the hero died and stays dead: it cannot create or join a game (409)
  spellcasting: null | {
    ability: string; saveDc: number; attackBonus: number
    slots: number[9]; expended: number[9]; cantrips: string[]; prepared: string[]
    concentratingOn: string | null
  }
  … plus a few bookkeeping fields (abilityRolls, hpRolls, otherProficiencies, pendingChoices)
}
```

The app never sends the sheet or the attacks: the server builds them with the rules engine and keeps
the sheet. `attacks` lists the hero's weapons (an Unarmed Strike if it carries none), then every cantrip
and prepared spell that deals damage. The ids on a sheet (`skills`, `traits`, `feat`, `feats`, spell ids)
are explained by `GET /api/reference`.

- `POST /api/portrait` body `{ character: Character-ish (no ids needed), previousAppearance?: string, note?: string }`
  → `{ appearance: string, portraitUrl: string }`. Embellishes the player's description with the
  house art style and the character's race/class/etc., generates a portrait, stores it in Blob.
  `note` is an optional tweak ("make the armour darker") applied on top of `previousAppearance`
  for re-rolls. Slow (10–40 s); the app shows a forging animation.
- `PUT /api/characters` body `Character` plus optional `backgroundId` (ownerId and `sheet` are ignored;
  ownerId is taken from `x-dd-player`) → `Character`. Upsert by id; only the owner can update.
  - A new hero gets a level-1 sheet from the engine: its species (`race`), class and background
    (`backgroundId`, or one picked for it), standard array scores best-first to the class's saving
    throws, the background's +2/+1, starting gear and spells. The same id always builds the same hero.
  - Saving again keeps the sheet (level, XP, HP…). Renaming renames the sheet. Changing race, class or
    background rebuilds it, but only at level 1: a levelled hero gets 400.
  - Old ids still accepted and mapped: `half-orc` → `orc`, `half-elf` → `elf` (SRD 5.2 has neither).
- `POST /api/sheet` body `{ id, name, race, characterClass, backgroundId? }` → `{ sheet, attacks }`: the
  level-1 sheet `PUT /api/characters` would build for that hero, without saving anything. The forge shows
  it while the player picks a background. Same validation as the save; `id` seeds the build, so the
  preview is the hero that will be saved.
- `GET /api/characters` → `{ characters: Character[] }` (mine, newest first). Heroes saved before the
  rules engine come back upgraded on read (half-orc → orc, half-elf → elf, a sheet built as above);
  the upgrade is stored the next time the hero is saved.
- `DELETE /api/characters?id=…` → `{ ok: true }`.

## Rules reference

`GET /api/reference` → the SRD 5.2 text behind the ids on a sheet, so the app can name a thing and
explain it on a tap. Static (it changes only with a deploy); the app fetches it once and caches it. Needs
the app key, not a player id.

```ts
Reference {
  spells:     { [id]: { name, description, level /* 0 = cantrip */, school, castingTime, range, duration,
                        components /* "V, S, M" */, concentration: boolean, ritual: boolean } }
  traits:     { [id]: { name, description } }      // species traits
  feats:      { [id]: { name, description } }      // sheet.feat is a feat's name: match on `name`
  features:   { [classId]: { [featureName]: { name, description } } }   // class and subclass features,
                                                   // by the names in sheet.features
  skills:     { [id]: { name, description, ability /* "dex" */ } }
  conditions: { [id]: { name, description } }
  attribution: string                              // the SRD's CC-BY-4.0 notice; show it with the text
}
```

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
                                     // in a rules game `character.sheet` and `.attacks` are the hero as it
                                     // stands in this game: live HP, level, slots, gear
  scene: Scene | null                // the current scene (null in lobby)
  chronicle: ChronicleEntry[]        // resolved scenes, oldest first (the story so far)
  messages: Message[]                // newest last; only those after `since` when given
  rules: RulesView | null            // the rules engine's numbers; null for games started before it
  updatedAt: string
}

Scene {
  index: number                      // 0-based
  title: string
  narration: string                  // 2–4 short paragraphs
  imageUrl: string | null            // null while the art is still painting
  choices: [{ id: "a"|"b"|"c", label: string, detail: string,
              rules: string | null }]  // e.g. "Athletics check, DC 12"; exactly 3; empty for the epilogue
  combat: boolean                    // true for a combat round: each vote is that player's own hero's action,
                                     // and `choices` are written for the caller's hero (see below)
  canAct: boolean                    // false when the caller's hero cannot act this round (down or dead):
                                     // nothing to choose, and the round does not wait for them
  isFinale: boolean                  // true for the epilogue scene (no choices, game ended)
  votes: [{ playerId, choiceId, roll: number /* d20 */ }]
  myVote: string | null              // choiceId of the caller
  outcome: string | null             // set once resolved: the DM's summary of what the party chose
}

ChronicleEntry {
  index: number; title: string; imageUrl: string | null
  choiceLabel: string                // the label of the most-voted choice (ties: the DM's pick); "" for a combat round
  outcome: string                    // what happened, as the DM resolved it
  combat: boolean                    // a combat round: every hero took their own action
}

RulesView {                          // SRD 5.2 (2024 rules)
  party: [{
    playerId: string; name: string; level: number; xp: number
    hp: number; maxHp: number; armorClass: number
    exhaustion: number                // 0–6
    hitDiceLeft: number
    slotsLeft: number[]               // 9 entries, spell levels 1–9; all 0 for non-casters
    resources: [{ id: string; name: string; left: number; max: number }]   // Rage, Second Wind, …
    down: boolean                     // at 0 HP
    dead: boolean                     // slain: stays dead after the adventure
    passivePerception: number; passiveInsight: number
    gp: number                        // coins, as gold (can be fractional)
    inventory: [{ id: string; name: string; count: number }]
    carried: number; capacity: number; dragLimit: number   // pounds; over capacity the hero is dragging
    dragging: boolean                 // Speed 5 ft
  }]
  combat: null | {
    round: number
    outcome: "ongoing"                // a settled fight is gone (combat: null); its end is in results
    combatants: [{ id: string; name: string; side: "party" | "foes"; hp: number; maxHp: number;
                   status: "up" | "dying" | "stable" | "dead"; conditions: string[] }]   // initiative order;
                                      // a hero's id is its playerId
  }
  dungeon: null | {
    mode: "fixed" | "explore"; kind: string
    at: string                        // area id the party is in
    areas: [{ id: string; name: string; purpose: string | null; cleared: boolean;
              exits: [{ id: string; connection: string; to: string | null }] }]   // visited areas only
  }
  results: string[]                   // the engine's dice lines for the last resolved scene
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
- `POST /api/games/{code}/start` body `{ sceneCount?, dungeon? }` → `GameState` with status `preparing`.
  Host only. `sceneCount` 2–8. `dungeon`: `"none"` (default: the DM's story, no map), `"fixed"` (a whole
  map of 5–9 rooms built from a seed) or `"explore"` (rooms are rolled as the party opens each door).
  The engine copies each hero's sheet into the game. The DM writes scene 0 in the background; status
  becomes `voting` when it's ready.
- `POST /api/games/{code}/vote` body `{ sceneIndex, choiceId }` → `GameState`.
  Voting status only; you can change your vote until the scene resolves. The server rolls a d20
  for each vote (kept when you change your vote). When every player has voted the scene resolves:
  status `resolving`, the DM weighs all votes and rolls, writes `outcome` on the old scene and the
  next scene (or the finale) in the background, then status returns to `voting` (or `ended`).
- `POST /api/games/{code}/advance` → `GameState`. Host only: resolve now with the votes that are in
  (for an AFK player). Needs at least one vote.

### The rules engine in play

Games started after the engine shipped carry `rules`. The DM proposes and narrates; the engine owns the
numbers (see docs/rules-design.md and docs/dungeon-master.md).

- **Choices with `rules`.** A choice may be a check ("Athletics check, DC 12"), a saving throw ("Dexterity
  save, DC 13"), a fight ("Fight: 2 Goblin Warriors"), a rest ("Short rest", "Long rest") or, in a
  dungeon, a way on ("Through the locked door"). The party still goes with the most-voted choice. Ties go
  to the choice whose voters rolled highest. Every hero makes the check or save with their vote's d20
  (or a fresh one if they didn't vote) plus their own bonus. In 5.2 a natural 20 or 1 is not automatic on
  a check or save. The party succeeds if at least half the heroes do (5.2 group check). A failed save
  can deal damage.
- **Combat rounds** (`scene.combat`). The choices are always: (a) Attack: your best weapon against the
  most wounded foe; (b) Cast: your best attack cantrip or spell (Attack if you have none); (c) Dodge.
  Each player's vote is their own hero's action, and the vote's d20 is their attack roll. Monsters act
  by simple rules. Each round is a scene, so `sceneCount` grows by one for each round. When the foes all
  fall, the living heroes split the XP and level up on the spot (average hit points; 5.2 thresholds). If
  every hero is down, the next scene is the epilogue. A fight still going after 10 rounds ends with the
  foes fleeing (no XP).
  - **Written for you.** In a combat round each caller gets their own `choices`: the same three ids, with
    `label` and `detail` saying what their hero will do ("Attack with Greatsword" / "+5 to hit, 2d6+3
    slashing, at Goblin Warrior 2"; "Cast Fire Bolt" / …). `rules` is null on them.
  - **Who must act.** A hero that is down or dead has no action: `scene.canAct` is false for its player,
    a vote from them is accepted and changes nothing, and the round resolves when every hero that can act has voted.
    If no hero can act the round resolves at once. The host can still `advance` with no votes in.
  - **One picture per fight.** The round that begins a fight is painted; later rounds of the same fight
    carry the same `imageUrl` (it may still be null for a moment while that painting finishes).
- **Rests.** Short rest: heroes spend hit dice until healed or out of dice, features recharge, and
  warlocks get pact slots back. Long rest: full HP, all hit dice, slots and features, and 1 exhaustion
  removed. A hero at 0 HP regains 1 HP first.
- **Dice in chat.** The engine posts its results as `system` messages ("Bryn: Athletics 14 + 5 = 19 vs DC
  12, success"), so the current app shows them without an update. The same lines are in `rules.results`.
- **When it ends.** The heroes' sheets (level, XP, features; HP and slots restored) are saved back to
  each player's character, so the next adventure starts where this one left off.

- **Older games and apps.** A game started before the engine has `rules: null`, choices with `rules:
  null` and `combat: false`, and plays as it always did (the DM breaks ties). The current app decodes
  `GameState` and ignores the new keys, so it keeps working; dice show up as system messages.

### In the app

The app (0.2 and later) shows all of the above: the hero's sheet (`Character.sheet`, `attacks`, the
reference text) on the hero page and during a game with live numbers from `rules.party`; the rules label
under each choice; the fight (combatants in initiative order, the round's dice from `rules.results`, your
hero's three actions); the dungeon map from `rules.dungeon.areas`; a background picker with a sheet
preview in the forge; and the kind of game on the start screen. Every new key is optional to the app's
decoder, so it also runs against a server from before them.

Images may arrive after their text: a scene can be `voting` with `imageUrl: null`; keep polling.

## Background work and failures

Long DM/image work runs after the response (`waitUntil`). If the DM call fails, the game drops back
to the previous status and a `system` message explains; the host can retry (`start` / `advance`).

If the rules engine itself throws while resolving a scene, the table is not left in `resolving`: the
scene resolves without it (a fight under way breaks off, a choice is settled without dice), a `system`
line says "The rules engine stumbled: …", and the error is logged on the server.
