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
  }],
  "narrators": [{ "id": "george-storyteller", "name": "George, the old storyteller", "description": "…" }],
  "defaultNarrator": "george-storyteller"
}
```
`symbol` is an SF Symbol name; `accent` a hex colour. Unknown ids are rejected by the endpoints below.
`races`, `classes` and `backgrounds` are exactly the SRD 5.2 (2024) species, classes and backgrounds.
A background's `abilities` are the three scores it can raise (the builder puts +2 and +1 on two of them).
`dungeons` are the kinds of game a host can start (the `dungeon` of `POST …/start`): `none`, `fixed`
and `explore`, in the order to show them.
`narrators` are the voices a scene can be read aloud in (the `voice` of `POST …/narration`), in the order
to show them; `defaultNarrator` is the one used when a request names none. New voices need no app release.

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
  bonus: number                   // added to the d20 to hit; 0 for a spell the target saves against, or
                                  // one that never misses (Magic Missile: save null too)
  damage: string                  // "2d6+3 slashing"; "3 × 1d4+1 force" for Magic Missile's darts
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
                                  // until revived (POST /api/characters/revive)
  revivalPenalty?: number         // 0–4: raised from the dead, this much off every D20 Test; −1 per Long Rest
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
- `POST /api/characters/revive` body `{ characterId, payerId? }` → `Character`. A temple's Raise Dead
  between adventures (SRD 5.2: a level-5 spellcasting service, 2,000 gp, plus the 500 gp diamond: 2,500
  gp). The dead hero's own purse pays, or another living hero of the same player (`payerId`). The hero
  comes back with 1 HP and `revivalPenalty: 4`. 409 if the hero is not dead, the payer is dead, or the
  payer has less than 2,500 gp (`error` says how much it has); 404 for someone else's hero or purse.

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
  voices: { [narratorId]: string }   // the readings of this scene made so far (audio files), by narrator id;
                                     // empty until a player asks for one: POST /api/games/{code}/narration
  voiceUrl: string | null            // the default narrator's reading: `voices[catalog.defaultNarrator]`, for
                                     // apps from before the voice picker
  choices: [{ id: "a"|"b"|"c", label: string, detail: string,
              rules: string | null }]  // e.g. "Athletics check, DC 12", "Fight: Goblin Warrior (weak) — low";
                                     // exactly 3; empty for the epilogue
  combat: boolean                    // true for a combat round: each vote is that player's own hero's action,
                                     // and `choices` are written for the caller's hero (see below)
  canAct: boolean                    // false when the caller's hero cannot act this round (down or dead):
                                     // nothing to choose, and the round does not wait for them
  isFinale: boolean                  // true for the epilogue scene (no choices, game ended)
  votes: [{ playerId, choiceId, roll: number /* d20 */,
            label?: string }]        // in a combat round: what that hero is doing, in their own choice's words
                                     // ("Attack with Longsword", "Cast Fire Bolt", "Break Free", "Help Ilsa", "Dodge")
  myVote: string | null              // choiceId of the caller
  outcome: string | null             // set once resolved: the DM's summary of what the party chose
}

ChronicleEntry {
  index: number; title: string; imageUrl: string | null
  voices: { [narratorId]: string }   // the readings of that scene that were made
  voiceUrl: string | null            // the default narrator's, as on a scene
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
    sight: "clear" | "dim" | "none"   // how the hero sees here: dim, Perception has Disadvantage; none,
                                      // Perception and Investigation fail and in a fight the hero is Blinded
    darkvision: number                // feet, from the species; 0 without
    resistances: string[]             // damage types the hero takes half of, from species traits: ["poison"]
    conditions: [{ condition: string; ends: string }]   // carried between scenes, each with how it ends:
                                      // { "poisoned", "40 minutes" }, { "restrained", "DC 13 Athletics to break free" },
                                      // "until a long rest", "DC 12 CON save to end"
    concentratingOn: string | null    // the spell the hero holds by concentration, by name ("Bless")
  }]
  combat: null | {
    round: number
    outcome: "ongoing"                // a settled fight is gone (combat: null); its end is in results
    band: "low" | "moderate" | "high" | "deadly"   // the fight against this party; deadly is above high.
                                      // The engine's word. Absent from servers older than toughness ratings.
    combatants: [{ id: string; name: string; side: "party" | "foes"; hp: number; maxHp: number;
                   status: "up" | "dying" | "stable" | "dead"; conditions: string[];
                   toughness: null | "weak" | "even" | "strong" | "deadly" }]   // initiative order;
                                      // a hero's id is its playerId; toughness is null for a hero, and the
                                      // foe's own rating against this party (absent from older servers)
  }
  dungeon: null | {
    mode: "fixed" | "explore"; kind: string
    at: string                        // area id the party is in
    level: number                     // the dungeon level reached, 1–20: it starts at the living heroes'
                                      // average level (rounded down) and may go one deeper through a door
    deepened: [{ at: string; level: number }]   // where it went deeper, oldest first
    areas: [{ id: string; name: string; purpose: string | null; cleared: boolean;
              exits: [{ id: string; connection: string; to: string | null }] }]   // visited areas only
    waiting: null | { foes: string; attitude: "hostile" | "indifferent" | "friendly";
                   band: "low" | "moderate" | "high" | "deadly";
                   monsters: [{ name: string; count: number; toughness: "weak" | "even" | "strong" | "deadly" }] }
                                      // "Boar ×3": foes the party is facing here. Hostile ones bar the way
                                      // (the scene's choices are Engage, Run and Parley). band and monsters
                                      // rate them against this party; absent from servers older than that
  }
  results: string[]                   // the engine's dice lines for the last resolved scene
  levelUps: [{ playerId: string; name: string; from: number; to: number }]   // who levelled up at the
                                      // quest's end (set with the epilogue; empty until then)
  time: { seconds: number; label: string }   // the adventure's clock, from 8 in the morning of day 1:
                                      // "Day 1, 08:40". A choice takes ten minutes, a rest its length.
  light: {
    level: "bright" | "dim" | "dark"  // what the party sees by here; bright wherever its own light burns
    source: null | { name: string; holder: string; minutesLeft: number }   // "Torch", "Bryn", 40
  }
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
- `POST /api/games/{code}/narration` with `{ sceneIndex, voice? }` → `{ sceneIndex, voice, status, voiceUrl }`.
  The scene read aloud, on demand: nothing is spoken until a player asks. `voice` is a catalog `narrators`
  id; left out, it is `defaultNarrator`. The answer names the narrator it is for.
  - `status: "ready"`: `voiceUrl` is the audio (MP3 or WAV, by the narrator's speech model; a public URL
    like `imageUrl`). Download it and play it.
  - `status: "making"`, `voiceUrl: null`: that narrator is speaking it now. The URL then appears on the
    scene itself (`scene.voices[voice]`, and `chronicle[].voices` once the scene is past), so the game poll
    delivers it to every player.
  - One reading per scene per narrator. The first request for a voice claims it and is held until the
    reading is made (about ten seconds for a full scene, at most 20): it answers "ready", or **502** if the
    reading failed. Requests for the same voice that arrive meanwhile get "making" at once. A failed
    reading gives the claim back, so asking again retries; a client waiting on "making" should ask again
    every 15 seconds or so in case the reading it was waiting for failed. Another voice of the same scene is
    its own reading, made the same way; those already made stay.
  - What is read is what the screen shows for that turn: what came of the scene before (its `outcome`),
    then the scene's `narration`. A combat round is its `narration` alone. Any scene of the game can be
    asked for, not only the current one.
  - 400 `sceneIndex` not a whole number, or `voice` not a narrator id; 403 not in this game; 404 no such
    game or scene; 502 the reading failed.

### The rules engine in play

Games started after the engine shipped carry `rules`. The DM proposes and narrates; the engine owns the
numbers (see docs/rules-design.md and docs/dungeon-master.md).

- **Choices with `rules`.** A choice may be a check ("Athletics check, DC 12"), a saving throw ("Dexterity
  save, DC 13"), a fight ("Fight: Goblin Warrior (weak) — low": each kind's toughness, then the fight's
  band, low / moderate / high / deadly), a rest ("Short rest", "Long rest") or, in a
  dungeon, a way on ("Through the locked door"). The party still goes with the most-voted choice. Ties go
  to the choice whose voters rolled highest. Every hero makes the check or save with their vote's d20
  (or a fresh one if they didn't vote) plus their own bonus. In 5.2 a natural 20 or 1 is not automatic on
  a check or save. The party succeeds if at least half the heroes do (5.2 group check). A failed save
  can deal damage. A check against a creature (sneaking past it, persuading it) takes its DC from the
  monster: its passive score, or the Influence DC (15 or its INT, whichever is higher). In "one hero with
  help" checks the best hero rolls and the others give Advantage (5.2 Help).
- **More choices.** Buying, selling and drinking a potion ("Buy Potion of Healing ×2", "Sell Gemstone",
  "Drink a Potion of Healing"; SRD prices, gear sells at half, gems and jewellery at full value); a trap
  ("Risk a trap": an SRD 5.2 example trap, found with passive scores, disarmed with thieves' tools, or
  sprung); a hazard ("Hazard: Falling (30 feet)"); "Parley" or "Parley with Goblin Warrior" (the best
  talker tries to sway them); "Raise the dead" (a temple: every dead hero is raised while the party's gold
  lasts).
- **Time and light.** The engine keeps a clock (`rules.time`) and the party's light (`rules.light`). Where
  the place is not bright, the standing hero with the best light lights it (the Light cantrip, a lantern or
  lamp with oil, a torch, a candle), and the next when it burns out. A dungeon's entrance is dim, most
  rooms and every corridor are dark; outdoors it is bright by day and dark by night. Each hero's `sight`
  follows from the light and their darkvision. `time` and `light` are absent from servers older than this.
- **Corridors and wanderers.** A way between two rooms may run through a corridor: it is an area in
  `rules.dungeon.areas` like any other (its `purpose` is null), passed in the same move, and it can be
  trapped. In a dungeon the engine rolls for wandering monsters every half hour of the clock (d6, a 1), and
  at once after noise (a fight that ended, a trap that went off: 1 or 2). Wanderers roll an attitude like
  any foes: the Hostile bar the way, the others go their way.
- **Dungeon levels.** A dungeon starts at the living heroes' average level (rounded down, at least 1), so
  new heroes start at 1. Each door into an area not yet seen has a 25% chance of leading a level deeper
  (seeded), and stairs in explore mode add one too. It never goes down and stops at 20. A line says "The
  way leads deeper: dungeon level N." Monsters, traps and treasure there are scaled to that level, for
  the living heroes as if each were at it. Fights the DM proposes are held to a high encounter at that
  level, with few foes at levels 1–2.
- **Treasure** is shared in whole gold among the living heroes. The odd pieces go one each to the first
  of them, and the dead get none ("Treasure: 5 gp in coin (2 each, and 1 more to Bryn)").
- **Levelling up at the quest's end.** When the next scene is the epilogue, each living hero levels up
  as far as its XP reaches (2024 thresholds, average hit points). The lines are in `rules.results` and
  the chat, `rules.levelUps` lists who levelled up, and the hero goes home at its new level.
- **Meeting monsters.** Foes in a dungeon room roll an attitude (2d6): 2–5 Hostile, 6–9 Indifferent,
  10–12 Friendly. They do not attack at once. Hostile ones bar the way (`rules.dungeon.waiting`, attitude
  `hostile`): the scene's three choices are Engage, Run and Parley, whatever the DM wrote. Run, before
  initiative, backs the party out the way it came; the room stays uncleared, with no loot and no XP.
  Indifferent or Friendly foes wait. Undead, constructs and oozes are always Hostile. A parley that works
  leaves the room to the party (their treasure stays theirs); one that fails sours them a step, and if they
  turn Hostile the party chooses again. Wanderers who are Hostile wait for the same choice; Run slips past
  them. Outside a dungeon, a parley the DM names starts Indifferent, and a failure that turns them Hostile
  does start the fight.
- **Toughness.** Wherever a foe is shown, the engine rates it against the current party, and rates the
  fight those foes make together. One monster is weak, even, strong or deadly as its XP falls on the
  party's low, moderate or high budget, or above high. The fight is low, moderate, high or deadly the same
  way. A fight choice reads "Fight: Goblin Warrior (weak) — low". A meeting lists each kind on
  `waiting.monsters` with `waiting.band`. A combat round puts `toughness` on each foe and `band` on the
  fight. The words are the engine's; they are always shown, with no check to uncover them. A fight the DM
  proposes is rated after it is held to a high encounter, which is the fight that will be fought. Engage
  rates the foes already standing.
- **Combat rounds** (`scene.combat`). The choices are always: (a) Attack: your best weapon against the
  most wounded foe; (b) Cast: your best attack cantrip or spell (Attack if you have none), or, while a friend is dying, a healer's healing spell on them ("Cast Cure Wounds", "Heals Corin, who is dying: 2d8+3 hit points."); (c) the third
  choice, which depends on the moment: **Break Free** (a hero Restrained or Grappled spends the action on
  its escape check), **Help _name_** (stabilize a dying friend: a Healer's Kit, or DC 10 Medicine), or
  **Dodge**. The id is always `c`; read its `label` and `detail`.
  Each player's vote is their own hero's action, and the vote's d20 is their attack roll. Monsters act
  by simple rules. Each round is a scene, so `sceneCount` grows by one for each round. When the foes all
  fall, the living heroes split the XP; they level up with it at the quest's end. If
  every hero is down, the next scene is the epilogue. A fight still going after 10 rounds ends with the
  foes fleeing.
  - **Monsters fight by their stat blocks.** Multiattack makes each listed attack (a hydra one per head);
    heroes with Extra Attack swing twice (three or four times at higher Fighter levels), later swings
    at the most wounded foe still up. A monster's save abilities (a dragon's breath, a gaze) are used
    when ready: Recharge 5–6 is rolled at the start of its turn ("Recharge" line), "1/Day" means once per
    fight; each caught hero saves, half on a success where the text says so, and a lasting effect
    (Poisoned, Paralyzed, Restrained…) sticks with its own way to end. Attack riders (a ghoul's paralyzing
    claws, a spider's web, a grapple) work the same way. A monster with no attack and no save ability
    (Shrieker Fungus, Seahorse, a vampire's mist form) Dodges, using its own action if it has one
    ("Shrieker Fungus uses Shriek, and dodges."). Rooms and wanderers are never stocked with these; only
    the DM can bring one. A monster that can Disengage as a Bonus Action
    flees without Opportunity Attacks. Monsters prefer a hero who isn't Dodging. Heroes skip a foe
    immune to their damage (Fire Bolt past a fire elemental) when another can be hurt.
  - **Conditions and concentration.** Conditions from saves, traps and riders stay on the hero after the
    fight (`party[].conditions`) until they end: by time, at a long rest, by a save at the end of each of
    the hero's turns, or by breaking free. A concentrating hero makes a CON save each time it is hit
    (DC 10 or half the damage) and loses the spell on a failure, at 0 HP or when Incapacitated; the spell
    ends with the fight. Species resistances halve damage of their types.
  - **Area spells** catch several foes, the most wounded first: 1 + radius/5 for a sphere, cylinder or
    emanation, 1 + size/10 for a cone or cube, 1 + length/30 for a line. Each makes its own save.
  - **Second Wind and potions.** A hero at half HP or less takes one Bonus Action to heal before their
    voted action: a fighter with Second Wind left uses it (1d10 + Fighter level), anyone else (or a fighter
    out of uses) drinks the least of their healing potions.
  - **Morale.** Foes are shaken by their first death, by losing half their total HP, or by their leader
    falling; they roll d20 + their best WIS save vs DC 10. Below 10 they flee and every standing hero with
    a melee weapon gets an Opportunity Attack; 5 or less and they surrender. Fleeing foes leave the XP of
    the slain only; a surrender is a victory worth them all.
  - **Death.** When the fight ends, a hero at 0 HP is stabilized by a friend (Spare the Dying, a Healer's
    Kit, or a DC 10 Medicine check) or rolls death saves. A slain hero is dead (`dead: true`) unless a
    standing party caster can cast Revivify and someone has 300 gp for the diamond. The same happens
    when a save, trap or hazard drops a hero outside a fight. Raise Dead (the `revive` choice) reaches
    only heroes dead 10 days or less by the game clock.
  - **Written for you.** In a combat round each caller gets their own `choices`: the same three ids, with
    `label` and `detail` saying what their hero will do ("Attack with Greatsword" / "+5 to hit, 2d6+3
    slashing, at Goblin Warrior 2"; "Cast Fire Bolt" / …). `rules` is null on them. An area spell names
    every foe it will catch ("3d6 fire, Dexterity save DC 12 for half, at Goblin Warrior 2 and Goblin
    Warrior 1."), and a hero about to use Second Wind or drink a potion is told so on all three (the
    detail ends " First uses Second Wind." or " First drinks a Potion of Healing.").
  - **What the others are doing.** The same id means different things for different heroes (one hero's `c`
    is Dodge, a held hero's is Break Free), so in a combat round every vote carries `label`: the label of
    that voter's own choice. Show it rather than the caller's label for the same id.
  - **Who must act.** A hero that is down or dead has no action: `scene.canAct` is false for its player,
    a vote from them is accepted and changes nothing, and the round resolves when every hero that can act has voted.
    If no hero can act the round resolves at once. The host can still `advance` with no votes in.
  - **One picture per fight.** The round that begins a fight is painted; later rounds of the same fight
    carry the same `imageUrl` (it may still be null for a moment while that painting finishes).
- **Food, water and gear.** Each morning on the clock (every 24 hours) every hero eats a Ration; without
  one they go hungry (5.2 malnutrition: exhaustion after a few days), and without a Waterskin they suffer
  dehydration. Starting packs (Dungeoneer's, Explorer's, …) are opened into their contents, so torches,
  oil and rations show in `inventory` and are used.
- **Rests.** Short rest: heroes spend hit dice until healed or out of dice, features recharge, and
  warlocks get pact slots back. Long rest: full HP, all hit dice, slots and features, and 1 exhaustion
  removed. A hero at 0 HP regains 1 HP first.
- **Dice in chat.** The engine posts its results as `system` messages ("Bryn: Athletics 14 + 5 = 19 vs DC
  12, success"), so the current app shows them without an update. The same lines are in `rules.results`.
- **When it ends.** The heroes' sheets (level, XP, features, gold and gear; HP and slots restored) are
  saved back to each player's character, so the next adventure starts where this one left off. A dead
  hero goes home dead.

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
