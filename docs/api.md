# The Dungeon Door — API contract (v1)

The iOS app talks to a Vercel deployment (`server/`). All bodies are JSON, all keys camelCase,
all timestamps ISO-8601 strings, all ids strings.

## Identity and headers

There is no sign-in in the MVP. The app makes a random player id (UUID) on first launch and keeps it.

| Header | Meaning |
| --- | --- |
| `x-dd-player` | The caller's player id (UUID). Required on every endpoint except `GET /api/catalog`. |
| `x-dd-key` | Shared app key (`DD_APP_KEY` on the server). Required when the server has one set. |
| `x-dd-app-version` | The caller's app version, sent on every request. `marketing+build` (for example `0.2+47`), where `build` is `CFBundleVersion`. A bare build (`47`) or `0.2 (47)` is also accepted. |

Errors are `{ "error": "message" }` with 400 (bad input), 401 (missing/wrong key or player),
403 (not allowed, e.g. not the host), 404 (no such game/character), 409 (wrong game state),
426 (this install is too old to play). A 426 also carries `"code": "update_required"`. An old build
does not read `code`; it already shows `error` as the message of a failed action. The game poll
stays 200 so that build does not turn the lobby into "Reconnecting…".
503 with a message to show the player means the account that pays for the AI is out of credit: a
portrait or a reading cannot be made until its owner tops it up, and asking again will not help.
The dungeon master's own work happens after the request has answered, so a game that cannot open or
go on for that reason says so in a `system` message instead (and goes back to the lobby, or reopens
the votes).

## App versions

The oldest build that may begin a tale or a dungeon is `MIN_APP_BUILD` in `server/lib/app-version.ts`.
Override it without a code change by setting `DD_MIN_APP_VERSION` to a build number, or to
`marketing+build`. A client with no header, no build number, or a build below that minimum is out of date.

Each seat remembers the last header from that player (`players[].appVersion`, null when they have
never sent one). `players[].outdated` is true when that version is below the minimum, so the host
can see who is holding the door.

`POST …/start` does not begin while anyone is outdated:

- the caller themselves is outdated or sent no version → 426 `update_required`,
  `"Update the app to keep playing. This version of The Dungeon Door is no longer supported."`
- the caller is current and someone else is not → 409 `"code": "party_outdated"` and
  `"Ilsa needs to update the app before the adventure can begin."` (several names joined with "and")

The same 426 is returned when an outdated or versionless client votes, writes an action, speaks in
character, or advances the scene. Chat, the poll, joining and the forge stay open, so a current host
still sees who has to update and an old build is not told the connection dropped.

Bump the minimum when a TestFlight build must be installed before a party can start. `ios/fastlane`
(`bump_build`) sets `CFBundleVersion` to one past the newest TestFlight build at upload time, in the
temporary worktree, and does not write it back. `ios/project.yml` keeps `CURRENT_PROJECT_VERSION`
(today `"1"`) for local Xcode builds. `MARKETING_VERSION` (today `"0.2"`) is not bumped by the ship
script. After the build is on TestFlight, set `MIN_APP_BUILD` to that build's number and deploy, or
set `DD_MIN_APP_VERSION` to the same number. Setting the constant in the same commit as the app races
the number fastlane assigns.

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
  "defaultNarrator": "george-storyteller",
  "push": false
}
```
`symbol` is an SF Symbol name; `accent` a hex colour. Unknown ids are rejected by the endpoints below.
`races`, `classes` and `backgrounds` are exactly the SRD 5.2 (2024) species, classes and backgrounds.
A background's `abilities` are the three scores it can raise. The player puts +2 on one and +1 on
another, or +1 on each (SRD 5.2; no score above 20).
`dungeons` are the kinds of game a host can start (the `dungeon` of `POST …/start`): `none`, `fixed`
and `explore`, in the order to show them.
`narrators` are the voices a scene can be read aloud in (the `voice` of `POST …/narration`), in the order
to show them; `defaultNarrator` is the one used when a request names none. New voices need no app release.
`push` is true when this server sends push notifications (it holds the push key; see docs/push.md). The app
asks leave to notify only then, the first time it opens.

## Pushes, companions and invitations

The server pushes to a player's devices when it is their turn (a new scene, or a combat round their hero
can act in), when someone else in their party chats, and when a companion invites them. How often, and
what waits, is in docs/push.md. A push carries `kind` ("turn", "combat", "chat" or "invite") and `code`
(the game) beside the alert, and the app opens that game, or the way in for an invitation.

- `POST /api/devices` body `{ token, environment }` → `{ ok: true }`. `token` is the APNs device token as
  hex; `environment` is `"sandbox"` (a build run from Xcode) or `"production"` (TestFlight, the App Store).
  The token then takes this player's pushes; a token belongs to the last player to register it. Send it at
  each launch. 400 for a token that is not hex or another environment.
- `DELETE /api/devices` body `{ token }` → `{ ok: true }`. The device takes no more pushes.
- `GET /api/companions` → `{ companions: [{ playerId, name, lastPlayedAt }] }`: the players the caller has
  shared a game with, most recent first, each by the hero they last played beside the caller. There are no
  accounts or friend lists; these are the people a player can invite.
- `POST /api/games/{code}/invites` body `{ playerId }` → `{ ok: true, alreadyInvited: boolean }`. Anyone in a
  party still in its lobby invites one of their companions. The invited player gets a push (once per game)
  and the invitation. 403 for someone who is not the caller's companion, or a caller not in the game; 409 once
  the adventure has begun, or for someone already in the party.
- `GET /api/invites` → `{ invites: [{ code, fromPlayerId, fromName, createdAt, party: string[] }] }`: the
  caller's invitations to parties still in the lobby that they have not joined, newest first. `party` names
  the heroes already there. Joining with the code (`POST /api/games/{code}/join`) uses the invitation up.
- `DELETE /api/invites?code=` → `{ ok: true }`. Declines one.

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
  bonusesOpen: boolean            // the forge placed the background's ability increases, and the scores
                                  // are still exactly those, so the player may place them once
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
  neverMisses: boolean            // spells only: no roll to hit and no save, every strike lands (Magic Missile).
                                  // Show this instead of the bonus, which is 0 and means nothing here
}

CharacterSheet {                  // SRD 5.2 (2024 rules); server-owned, see server/lib/rules/sheet.ts
  version: 1
  name: string; level: number /* 1–20 */; xp: number
  classId: string; speciesId: string; backgroundId: string; subclassId: string | null
  size: string; speed: number     // feet: the hero's own, before exhaustion (rules.party[].speed is what it moves at)
  abilityScores: { str, dex, con, int, wis, cha: number }
  abilityBoost?: AbilityBoost    // the player's placement of the background's increases; absent when the
                                  // server placed them (see bonusesOpen)
  proficiencyBonus: number
  maxHp: number; hp: number; armorClass: number
  hitDiceSpent: number            // of one per level; all come back on a Long Rest
  exhaustion: number              // 0–6 (5.2: −2 per level to d20 tests, −5 ft speed per level; 6 = dead)
  savingThrows: string[]; saveBonuses: { str, dex, …: number }
  skills: string[]; skillBonuses: { [skillId]: number }; passivePerception: number // as it stands: −2 per exhaustion level (and a revival's ordeal), the same as rules.party
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

AbilityBoost {                   // SRD 5.2 background ability increases, after the base scores
  { kind: "twoOne", plusTwo: "str", plusOne: "dex" }   // +2 and +1, two different abilities of the background
  | { kind: "oneOneOne" }                               // +1 to each of the background's three abilities
}
```

The increases come from the background, not the species (2024 rules). They are applied after the base
scores, whichever way those were got. The forge's base scores are the standard array, best-first to the
class's primary abilities and then Constitution. Point buy and 4d6-drop-lowest take the same increase
when a sheet is built that way; the app asks only for the increase. No score goes above 20.

The app never sends the sheet or the attacks: the server builds them with the rules engine and keeps
the sheet. `attacks` lists the hero's weapons (an Unarmed Strike if it carries none), then every cantrip
and prepared spell that deals damage. The ids on a sheet (`skills`, `traits`, `feat`, `feats`, spell ids)
are explained by `GET /api/reference`.

- `POST /api/portrait` body `{ character: Character-ish (no ids needed), previousAppearance?: string, note?: string }`
  → `{ appearance: string, portraitUrl: string }`. Embellishes the player's description with the
  house art style and the character's race/class/etc., generates a portrait, stores it in Blob.
  `note` is an optional tweak ("make the armour darker") applied on top of `previousAppearance`
  for re-rolls. Slow (10–40 s); the app shows a forging animation.
- `PUT /api/characters` body `Character` plus optional `backgroundId` and optional `boost` (`AbilityBoost`;
  ownerId and `sheet` are ignored; ownerId is taken from `x-dd-player`) → `Character`. Upsert by id; only
  the owner can update. `boost` may be null, which is the same as leaving it out.
  - A new hero gets a level-1 sheet from the engine: its species (`race`), class and background
    (`backgroundId`, or one picked for it), standard array scores best-first to the class's primary
    abilities and then Constitution, then the background's ability increases, starting gear and spells,
    plus one Potion of Greater Healing (`potion-of-greater-healing`) that every new hero is forged with
    (also on a level-1 rebuild and in `POST /api/sheet`; heroes already saved are not given one). The
    same id always builds the same hero. A hero stored before sheets were kept is still rebuilt
    best-first to the class's saving throws, so those numbers never change.
  - `boost` is where the player puts the increases: +2 and +1 on two of that background's three
    abilities, or +1 on all three. It is kept on the sheet as `abilityBoost`. Left out, the server
    places +2 and +1 itself (on the class's primary abilities where the background allows) and the hero
    comes back with `bonusesOpen: true`.
  - Saving again keeps the sheet (level, XP, HP…). Renaming renames the sheet. Changing race, class or
    background rebuilds it, but only at level 1: a levelled hero gets 400. Sending a different `boost`
    at level 1 moves the increases and leaves gear, level and experience; the numbers that follow from
    the scores (hit points, AC, saves, skills, spell DC) are worked out again. Above level 1, a new
    `boost` is accepted only while `bonusesOpen` is true.
  - A choice the rules forbid is 400: an ability the background does not raise, +2 and +1 on the same
    ability, or a score that would pass 20.
  - Old ids still accepted and mapped: `half-orc` → `orc`, `half-elf` → `elf` (SRD 5.2 has neither).
- `POST /api/sheet` body `{ id, name, race, characterClass, backgroundId?, boost? }` → `{ sheet, attacks }`:
  the level-1 sheet `PUT /api/characters` would build for that hero, without saving anything. The forge
  shows it while the player picks a background and places the increases. Same validation as the save;
  `id` seeds the build, so the preview is the hero that will be saved.
- `POST /api/characters/ability-boost` body `{ characterId, boost }` → `Character`. Places the background's
  increases on a hero whose `bonusesOpen` is true (the forge placed them, and the scores are still exactly
  that). The player's placement replaces the forge's; gear, level and experience stay, and hit points, AC,
  saves, skills and spell DC are worked out again. 409 when the bonuses were already chosen, or the scores
  have since changed (a later Ability Score Improvement, for example). 400 for a boost the rules forbid.
  404 for someone else's hero. A game already in progress keeps the copy of the sheet it started with and
  writes that copy home at the end, so this is for between adventures. No new column: `abilityBoost` lives
  in the character JSON.
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
  players: [{ playerId, character: Character, isHost: boolean, joinedAt,
              appVersion: string | null, outdated: boolean }]
                                     // in a rules game `character.sheet` and `.attacks` are the hero as it
                                     // stands in this game: live HP, level, slots, gear.
                                     // `appVersion` is the last `x-dd-app-version` from that player
                                     // (null when their client never sent one). `outdated` is true when
                                     // that version is below the server's minimum, which blocks start.
  scene: Scene | null                // the current scene (null in lobby)
  chronicle: ChronicleEntry[]        // resolved scenes, oldest first (the story so far)
  messages: Message[]                // newest last; only those after `since` when given. A whisper is
                                     // left out unless the caller sent it or was named in it. The same
                                     // rule applies to messageUpdates, a quoted reply, and a push
  messageUpdates: Message[]          // lines already delivered (id ≤ `since`) whose reactions changed;
                                     // empty when `since` is omitted, because those lines are in `messages`.
                                     // A whisper the caller cannot see is never in this list
  typing: [{ playerId, name }]       // heroes whose players are composing a line, other than the caller
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
                                     // two or three; empty for the epilogue. Still the letters a vote may name.
  actions: LegalAction[]             // this caller's hero, this turn. Weapons, spells they know or have
                                     // prepared, usable items, each skill (kind "skill", id "skill:athletics"),
                                     // class features with uses, and the common
                                     // actions, plus the scene's choices. One they cannot take is listed
                                     // with `reason` rather than left out. Empty for the epilogue and once
                                     // the scene has resolved. A kind the app has not seen (a later "move")
                                     // is still one of these, with the same fields.
  combat: boolean                    // true for a combat round: each vote is that player's own hero's action,
                                     // and `choices` are written for the caller's hero (see below)
  battlefield: null | {              // the fight's map, or null outside combat. 5-foot squares, origin at the
                                     // north-west. A room is 10 by 8; a road fight is 16 by 6 so 60 feet fits.
    width: number; height: number; squareFeet: 5
    walls: [{ x: number; y: number }]          // squares nothing can enter. Empty on open ground.
    cover?: [{ x: number; y: number }]         // squares of cover, when the room has any. Omitted when there are none.
  }
  canAct: boolean                    // false when the caller's hero cannot act this round (down or dead):
                                     // nothing to choose, and the round does not wait for them
  isFinale: boolean                  // true for the epilogue scene (no choices, game ended)
  votes: [{ playerId, choiceId, roll: number | null /* d20, null until thrown */,
            pending?: boolean, formula?: string, total?: number | null,
            label?: string, actionId?: string, targets?: string[], intent?: string,
            move?: { x: number; y: number; dash?: boolean; disengage?: boolean }
                 | { to: "engaged" | "near" | "far", engage?: string[], dash?: boolean, disengage?: boolean } }]
                                     // in a combat round, `label` is what that hero is doing ("Attack with
                                     // Longsword", "Cast Fire Bolt", "Dash", "Move to near"). `actionId` and
                                     // `targets` are set when the vote named an action from `actions` rather
                                     // than a letter. `move` is a combat move taken with the vote (see the
                                     // vote endpoint): a destination square, or the older band move.
                                     // A written check is not listed here; it is in `freeforms`
  myVote: string | null              // choiceId of the caller; a letter vote is still "a", "b" or "c".
                                     // Null when they wrote a check or have not acted
  myAction: null | { id: string; targets: string[] }
                                     // the caller's vote as an action. A letter vote is "choice:a"
                                     // (and "choice:b", "choice:c"). Null until they vote, and null for a written check
  freeforms: [{ playerId, text, roll: number | null, pending?: boolean }]
                                     // written checks this scene. `roll` is null until that player throws.
                                     // Each of these players has acted. Absent on servers from before written actions
  myDie: null | { sides: 20, modifier: number, formula: string, purpose: string }
                                     // the d20 the caller still has to throw. The face is not here.
                                     // Null once thrown, or when the action needs no throw. Absent on older servers
  myFreeform: { text, roll: number | null, pending?: boolean } | null
                                     // the caller's written check. `roll` is null until they throw. Absent on older servers
  outcome: string | null             // set once resolved: the DM's summary of what the party chose
  roleplay: [{ playerId: string; characterName: string; text: string }]
                                     // in-character lines and deeds this turn, oldest first. No roll.
                                     // Empty until someone speaks. Omitted by servers from before this.
}

LegalAction {
  id: string                         // stable: "attack:greatsword", "spell:fire-bolt", "item:potion-of-healing",
                                     // "feature:second-wind", "common:dash", "choice:a", "skill:athletics",
                                     // "ability:str"
  label: string                      // "Attack with Greatsword", "Cast Fire Bolt", "Dash", "Engage"
  kind: string                       // "attack", "spell", "item", "feature", "common", "choice", "move",
                                     // "skill" or "ability".
  detail: string
  targets: [{ id: string; name: string }]   // who or what a vote may name; empty when it needs no target
  picks: "none" | "one" | "many"     // how many of `targets` the vote names
  limit?: number                     // for "many": at most this many (an area, or a spell's darts)
  squares?: [{ x: number; y: number }]  // a move: every square this action can end on this turn.
                                     // Walls block the path. A square someone stands on (unless they are
                                     // dead) cannot be the end, and an enemy's square cannot be crossed.
                                     // Speed is the budget; a Dash lists the squares at double speed and
                                     // spends the action. Absent on any other kind.
  rangeFeet?: { normal: number; long: number | null } | null
                                     // an attack or a spell. Feet, from the SRD. `long` is null when there
                                     // is no long range (a spell, or a ranged weapon with one range).
                                     // Null for a melee attack or a touch spell. Absent on other kinds.
  reachFeet?: number | null          // a melee attack or a melee/touch spell: 5, or 10 for a Reach weapon,
                                     // or a monster's listed reach when that is what is being swung.
                                     // Null for a ranged attack or spell. Absent on other kinds.
  available: boolean
  reason: string | null              // why not, when available is false; null when it can be taken
}

ChronicleEntry {
  index: number; title: string; imageUrl: string | null
  voices: { [narratorId]: string }   // the readings of that scene that were made
  voiceUrl: string | null            // the default narrator's, as on a scene
  choiceLabel: string                // the label of the most-voted choice (ties: the DM's pick); "" for a combat round
  outcome: string                    // what happened, as the DM resolved it
  combat: boolean                    // a combat round: every hero took their own action
  roleplay: [{ playerId: string; characterName: string; text: string }]
                                     // what the heroes said and did in character that turn. Omitted by older servers.
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
    speed: number                     // feet it moves now: sheet speed − 5 per exhaustion level (min 0), 5 at most while dragging
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
    combatants: [{ id: string; name: string; side: "party" | "foes";
                   hp?: number; maxHp?: number      // a hero's hit points; absent for a foe
                   wound?: string; fill?: number    // a foe's instead: its hit points are hidden
                   status: "up" | "dying" | "stable" | "dead"; conditions: string[];
                   toughness: null | "puny" | "weak" | "even" | "strong" | "deadly";
                   position: "engaged" | "near" | "far";   // derived from the squares (see Positions):
                                      // engaged within melee reach, near at 30 ft or less, far beyond.
                                      // A room starts near; a road starts far. Kept for older apps.
                   engagedWith: string[]      // ids within melee reach; empty unless engaged. Symmetric.
                   square: { x: number; y: number } | null   // where they stand. Null when the fight has no grid
                                      // (a fight stored before grids, until it is mended on read).
                   speedFeet?: number }]      // a hero only: feet they can move this turn. The species' speed
                                      // (30 when it is the usual one), less 5 ft a level of exhaustion,
                                      // and 5 ft at most while dragging. Initiative order.
                                      // a hero's id is its playerId; toughness is null for a hero, and the
                                      // foe's own rating against this party (absent from older servers).
                                      // wound: how hurt the foe looks, by the share of hit points left:
                                      // "Unhurt" (full), "Scratched" (over 3/4), "Bleeding" (over 1/2),
                                      // "Bloodied" (1/2 or less, the 2024 term), "Staggering" (over 1/10),
                                      // "Gasping", "Dead" (0). Undead: Whole, Torn, Gouged, Crumbling, Falling
                                      // apart, Coming undone, Destroyed. Constructs: Intact, Scuffed, Dented,
                                      // Cracked, Breaking, Failing, Destroyed. Oozes: Whole, Rippling, Seeping,
                                      // Shrinking, Sloughing, Dissolving, Destroyed. fill: how full the foe's
                                      // gauge looks, 0 to 1 (three decimals), fuzzy: inside its wound's band,
                                      // never rising as it is hurt, stable for the same state, not its exact
                                      // share. Servers before this sent vigor (6 unhurt to 0) instead, and
                                      // servers before wounds a foe's hp and maxHp. Round lines tell hits
                                      // on a foe without damage numbers ("hit."); a hero's keep them.
  }
  trek: null | {                      // the road from the tavern, while the party is on it (any kind of game)
    stretch: number; of: number       // stretch 1 of 2 (each a scene)
    leadsTo: "door" | "tale"          // to the dungeon door, or (a tale told) to where the tale begins
    terrain: string                   // "a forest road under old oaks"
    event: "bandits" | "varmints" | "band" | "vendor" | "quiet"
    wares: [{ id: string; name: string; cost: number }]   // a wandering vendor's goods (gp); else []
    waiting: null | { ... }           // foes met on this stretch, as dungeon.waiting
  }                                   // absent from older servers
  dungeon: null | {                   // null on the road: the dungeon begins at its door
    mode: "fixed" | "explore"; kind: string
    at: string                        // area id the party is in
    level: number                     // the dungeon level reached, 1–20: it starts at the living heroes'
                                      // average level (rounded down) and may go one deeper through a door
    deepened: [{ at: string; level: number }]   // where it went deeper, oldest first
    areas: [{ id: string; name: string; purpose: string | null; cleared: boolean;
              exits: [{ id: string; connection: string; to: string | null }] }]   // visited areas only
    waiting: null | { foes: string; attitude: "hostile" | "indifferent" | "friendly";
                   band: "low" | "moderate" | "high" | "deadly";
                   monsters: [{ name: string; count: number; toughness: "puny" | "weak" | "even" | "strong" | "deadly" }] }
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
  id: number                         // monotonically increasing per game, and stable: a reaction edits this
                                     // line in place and never mints a new id. A later change can hang a
                                     // group-action proposal on a line; reactions already name who marked it,
                                     // so agreement can be counted without renumbering the log
  kind: "chat" | "system" | "dm"
  playerId: string | null
  characterName: string | null       // the hero's name when a player spoke; the speaker's name for a dm line
  text: string                       // 1–500 chars
  voice: "in" | "out" | null         // "in": the hero speaks (name and portrait). "out": the player, out of
                                     // character. null for system and dm lines. A chat line from before this
                                     // field reads as "in". Stored, and copied onto the DM's recentChat so
                                     // in-character lines are visible in that data. A whisper is never
                                     // in-character for the narrator, even when voice is "in"
  replyTo: number | null             // the id of the line this one answers
  reply: MessageQuote | null         // that line, quoted, so the preview survives even if it has scrolled
                                     // out of the poll window. A reply to a whisper stays inside that whisper
  mentions: Mention[]                // heroes and players named in the text; empty when it names nobody
  reactions: Reaction[]              // emoji on this line, in the order they were first used; empty when
                                     // nobody has reacted. Tap the same emoji again to leave it
  emote: boolean                     // true: a third-person deed, shown as "*Mira draws her sword*".
                                     // false on lines from before emotes. An in-character emote is a deed
                                     // the narrator must keep. An out-of-character emote is table talk
  whisperTo: Mention[] | null        // who else may read this, besides the sender. null: the whole party.
                                     // A whisper is never returned to anyone else, on any poll or view,
                                     // and is never given to the narrator. Absent on a server from before whispers
  createdAt: string
}

MessageQuote {
  id: number
  kind: "chat" | "system" | "dm"
  playerId: string | null
  characterName: string | null
  text: string
  voice: "in" | "out" | null
  emote?: boolean                    // true when the quoted line was an emote. Absent on older quotes
}

Mention {
  playerId: string
  name: string                       // the hero's name, as the party knows it. There is no separate
                                     // account name: a player is addressed by the hero they play
  target: "hero" | "player"          // "hero": @Name addresses the character. "player": @player:Name
                                     // addresses the person who plays them. The same shape names who
                                     // a whisper is for
}

Reaction {
  emoji: string                      // one emoji: 👍 👎 😂 😮 ❤️ 💀 are the quick set; any other single
                                     // emoji is allowed, for the picker
  count: number                      // how many players currently have it; equals playerIds.length
  playerIds: string[]                // who reacted, in the order they first did
}
```

- `POST /api/games` body `{ characterId, dungeonMaster? }` → `GameState`. Caller becomes host.
- `GET /api/games/{code}?since={messageId}` → `GameState`. The app polls this every ~2 s.
  Caller must be a player in the game (403 otherwise).
- `POST /api/games/{code}/join` body `{ characterId }` → `GameState`. Lobby only (409 after start).
  Re-joining with a different character swaps the character. Max 6 players.
- `POST /api/games/{code}/leave` → `{ ok: true }`. If the host leaves, the earliest remaining player becomes host.
- `POST /api/games/{code}/messages` body `{ text, voice?, replyTo?, emote?, whisperTo? }` → `Message`.
  `voice` is `"in"` (the default: the hero speaks) or `"out"` (the player, out of character). `"in"` is
  the same kind of player-voice input as `POST …/speak`: those words are the hero's, and the narrator
  must answer them and must not rewrite them. `"out"` is table talk. It is not what the hero said, and
  it is never an instruction to the dungeon master. `emote: true` is a third-person deed (`/me draws her
  sword` is the same thing, and the stored `text` is what follows the command). An in-character emote
  reaches the narrator as something the hero does (`*draws her sword*`). An out-of-character emote does
  not. `whisperTo` is `[{ playerId, target? }]`, the characters (`"hero"`, the default) or players
  (`"player"`) who may hear it besides the sender. `/w Name …` and `/whisper Name …` do the same from
  `text`: a comma or `and` separates names, `player:Name` names the player, and the longest name at the
  table wins, so spaces stay inside the name. A colon may sit between the names and the words. A whisper
  is never in-character speech and is never sent to the narrator, whatever `voice` is. It is returned
  only to the sender and the players it names: every poll, every other view, every reaction update, and
  every push. A reply to a whisper stays inside that whisper (a reply that names someone who did not
  hear it is 400). Replying to a whisper you cannot see is 400, the same as a missing line. Reacting to
  one you cannot see is 404. `replyTo` is a message id in this game; 400 when it isn't. Names in the
  text become `mentions`: `@Ilsa` is the hero, `@player:Ilsa` is the player of that hero (the name the
  table has for that person; there is no separate account name). The longest hero name that fits is
  used, and a name that isn't at the table is left as text. 400 when `text` isn't 1–500 characters,
  `voice` isn't `"in"` or `"out"`, `emote` isn't a boolean, `whisperTo` names nobody at the table or
  only the sender, or a slash whisper names nobody or has no words.
- `POST /api/games/{code}/reactions` body `{ messageId, emoji }` → `Message`. Toggles the caller's reaction
  on that line (any kind of line the caller can see): the first tap adds it, the next removes it. The
  returned line has the same `id`. `emoji` is a single emoji. 400 when it isn't; 404 when the line isn't
  in this game, or is a whisper the caller cannot see.
- `POST /api/games/{code}/typing` body `{ typing? }` → `{ ok: true }`. `typing: true` (the default) says the
  caller is composing; the next poll shows them in `typing` for about five seconds, to everyone else.
  `typing: false` clears it at once.
- `POST /api/games/{code}/speak` body `{ text }` → `GameState`.
  An in-character line or deed, 1–500 characters: what the hero says or does, with no roll and nothing for
  the rules engine to adjudicate. Voting only (409 otherwise). It is appended to the current scene's
  `roleplay`, which is the turn's log, and stays on that chronicle entry once the scene resolves. The
  dungeon master's next narration, and the NPCs in it, answer these words. A player may send several.
  This is not a freeform action. An in-character chat line (`voice: "in"`) is the same promise: the
  narrator keeps those words, and an in-character emote is kept as a deed. Out-of-character chat is not.
  A whisper is not, even when its voice is `"in"`.
- `POST /api/games/{code}/dungeon-master` body `{ dungeonMaster }` → `GameState`. Host only, lobby only.
- `POST /api/games/{code}/start` body `{ sceneCount?, dungeon? }` → `GameState` with status `preparing`.
  Host only. Refused while any seated player is outdated (see App versions): 426 when the caller
  themselves must update, 409 `party_outdated` naming the others when the caller is current. The game
  stays in the lobby. `sceneCount` 2–8. `dungeon`: `"none"` (default: the DM's story, no map), `"fixed"` (a whole
  map of 5–9 rooms built from a seed) or `"explore"` (rooms are rolled as the party opens each door).
  The engine copies each hero's sheet into the game. The DM writes scene 0 in the background; status
  becomes `voting` when it's ready. Every game opens with two scenes on the road from the tavern
  (`rules.trek`), to the dungeon door (`rules.dungeon` is null until the door) or, in a tale told, to
  where the tale begins, so its `sceneCount` is two more than asked for. Foes on the road who bar the way
  give Engage, Run and Parley, as in a room.
- `POST /api/games/{code}/vote` body `{ sceneIndex, choiceId, move?, text? }` or `{ sceneIndex, actionId, targets?, move?, text? }` → `GameState`.
  `choiceId` is still `"a"`, `"b"` or `"c"`. `actionId` is an id from `scene.actions`, and `targets` are ids
  from that action (omit them when `picks` is `"none"`; one id when `"one"`; one or more, up to `limit`,
  when `"many"`). `"choice:a"` is the same vote as `choiceId` `"a"`. A move action (`kind` `"move"`) is named
  the same way; its id is the move. When both a letter and `actionId` are sent, `actionId` is the
  vote.   `text` (also accepted as `intent`), 1–280 characters, is optional words beside that action
  ("I aim the bolt at the chandelier"). It is stored with the vote and does not replace it. A skill
  (`kind` `"skill"`, id `skill:<skill id>`) or an ability (`kind` `"ability"`, id `ability:str`) is a
  medium check (DC 15, no extra effect). `text` is what the hero is attempting (the name when `text` is
  omitted), and it does not add to which plot choice the party picked. Typing the skill's or ability's
  name in `POST …/action` maps onto that same check.
  When the action needs the player's d20 (a skill, an ability, an attack, an attack spell, or a written
  check), the server rolls the face then and does not send it. `scene.myDie` is the formula
  (`"d20+5"`). `POST /api/games/{code}/roll` `{ sceneIndex }` reveals that face. Throwing again returns
  the same one. If the choice window (`turn.deadline`) ends first, the next poll reveals it. The scene
  waits for that throw. A letter vote that is not one of those actions still carries its d20 at once.
  The server checks the action is one this hero can take and the targets are among its `targets`;
  otherwise 400, and `error` says why (`"No level 1 spell slot or higher left"`, `"that is not a valid target"`).
  Voting status only; you can change your vote until the scene resolves. The server rolls a d20
  for each vote (kept when you change your vote). `move`, only in a fight, is either a destination
  square `{ x, y, dash?: boolean, disengage?: boolean }` or the older band move
  `{ to: "engaged" | "near" | "far", engage?: string[], dash?: boolean, disengage?: boolean }`.
  A square is one this hero's speed can reach (a move action's `squares`); it happens before the
  choice. `x` and `y` are whole numbers on the battlefield. When `dash` is omitted, a square past
  the hero's speed and within double speed is a Dash. `dash: true` spends the action (the choice is
  not taken) and is refused when a normal move already reaches that square. `disengage: true` leaves
  an enemy's reach without opportunity attacks, and is refused when the step leaves no one's reach.
  A square sent with a move action as `actionId` (what a tap on the app's map sends: the move action
  that lists the square, and the square) is that one move: the hero ends on the square and takes no
  other action, and the band the action names is not walked as well.
  The older band move still works: one band before the choice, two when `dash` is true. `engage` names
  who you close with, and is required when `to` is `"engaged"`. On a grid the band is carried out by
  stepping to a square that puts the hero there. An illegal move is a 400. When every player has voted the scene resolves:
  status `resolving`, the DM weighs all votes and rolls, writes `outcome` on the old scene and the
  next scene (or the finale) in the background, then status returns to `voting` (or `ended`).
  Voting again replaces a written action (below) and keeps the same d20.
- `POST /api/games/{code}/action` body `{ sceneIndex, text }` → `GameState` with `action`.
  Voting status only. `text` is the player's own action, 1–280 characters ("I kick the brazier onto
  the goblins"). The dungeon master classifies it; the engine checks that classification and owns
  every number (docs/rules-design.md, "Freeform turns").
  - `action.ruling` is `"known"`, `"check"` or `"impossible"`. `action.spent` is false only for
    `"impossible"` (a bad classification counts as impossible): the turn is not used, `narration`
    says why, and the player may still vote or write another action. A system message carries the
    same refusal.
  - `"known"` maps onto an id from this hero's `scene.actions` and is stored as that vote
    (`action.choiceId` is the letter that id plays as: an attack is `"a"`, a spell `"b"`, anything
    else `"c"`, and `choice:a` is `"a"`). One that needs no target is stored with that `actionId`.
    One that needs a target is stored as the letter: the classification does not name who. The d20
    is rolled the same way a vote's is, and kept if the player rewrites the action or switches to a vote.
  - `"check"` is an ability check. The dungeon master names a skill or ability, a tier (easy,
    medium, hard) and an effect category; the engine sets the DC (10, 15, 20), the damage dice and
    the save. It is stored on the vote as `freeform` and counts as having acted, but it does not
    count toward which choice the party picked. The d20 is in the dice log when the scene resolves,
    the same lines as any other roll.
  - `action.roll` is that d20 when the turn was spent, otherwise null.
  - 400 `sceneIndex` not a whole number, or `text` empty or longer than 280 characters; 403 not in
    this game; 409 the game is not voting on that scene. A hero that cannot act gets `spent: false`
    and nothing is stored.
- `POST /api/games/{code}/advance` → `GameState`. Host only: resolve now with the votes that are in
  (for an AFK player). Needs at least one vote or written action. A combat round needs neither.
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
  save, DC 13"), a fight ("Fight: Goblin Warrior (weak) — low" or "Fight: Rat (puny) — low": each kind's
  toughness, then the fight's band, low / moderate / high / deadly), a rest ("Short rest", "Long rest") or, in a
  dungeon, a way on, named by how it is closed and, once the party has been there, where it leads ("Go on
  (locked door)", "Back to Narthex (open passage)"; ways alike are told apart: "Go on (second open
  passage)"). It never shows an exit id, and it is fixed when the choice is offered. The party still goes with the most-voted choice. Ties go
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
  fight those foes make together. One monster is puny, weak, even, strong or deadly. Puny is strictly
  under half the party's low budget (`xp * 2 < low`): a nuisance that would not fill half an easy fight.
  At half that line through low it is weak, through moderate even, through high strong, and above high
  deadly. A goblin at exactly half the low line stays weak; a rat under it is puny. The fight itself is
  low, moderate, high or deadly, with no puny step, so several puny foes can still be a real fight. A
  fight choice reads "Fight: Goblin Warrior (weak) — low" or "Fight: Rat (puny) — low". A meeting lists each kind on
  `waiting.monsters` with `waiting.band`. A combat round puts `toughness` on each foe and `band` on the
  fight. The words are the engine's; they are always shown, with no check to uncover them. A fight the DM
  proposes is rated after it is held to a high encounter, which is the fight that will be fought. Engage
  rates the foes already standing.
- **Combat rounds** (`scene.combat`). The choices are always: (a) Attack: your best weapon against the
  most wounded foe; (b) Cast: your best attack cantrip or spell (Attack if you have none), or, while a friend is dying, a healer's healing spell on them ("Cast Cure Wounds", "Heals Corin, who is dying: 2d8+3 hit points."); (c) the third
  choice, which depends on the moment: **Break Free** (a hero Restrained or Grappled spends the action on
  its escape check), **Help _name_** (stabilize a dying friend: a Healer's Kit, or DC 10 Medicine), or
  **Dodge**. The id is always `c`; read its `label` and `detail`.
  - **Legal actions** (`scene.actions`). The same turn, as a list a sheet can tap: each weapon, each cantrip
    and prepared spell (one with no slot is still listed, with the reason), each usable item (a potion, a
    healer's kit), each skill (`kind` `"skill"`), each class feature that has uses, and the common actions Attack, Dash, Disengage, Dodge,
    Help, Hide, Ready and Use an Object. A vote may name one (`actionId`, and `targets` when it needs them)
    instead of a choice letter; the letter votes keep working, and the d20 on the vote is still the die the
    engine uses. The list is the same shape out of a fight, where the scene's own choices (a way on, Engage,
    Run, Parley, a rest) are included as `choice:a` and so on, and a weapon or a spell says why it cannot be
    used yet. In a fight the list also offers each legal move (`kind` `"move"`: one band, or a Dash of two).
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
  - **Positions.** The fight is a grid of 5-foot squares (`scene.battlefield`). Each combatant has a
    `square`. Distance in feet is 5 times the Chebyshev distance (a diagonal costs the same as a step
    orthogonally). The range band is read off that distance, and `position` and `engagedWith` stay on
    the combatant for older apps. Two creatures are engaged when the distance is within the longer
    melee reach: 5 feet, 10 with a Reach weapon, or a monster's listed reach when that is longer.
    Otherwise near is 30 feet or less and far is beyond. A room starts with the heroes on the west
    edge and the monsters opposite, 30 feet apart (near). A road starts 60 feet apart (far), on a
    longer map. One side surprising the other begins adjacent, in melee; a hero who is down stays
    back at the band. A hero's `speedFeet` is how far they can move. A move action lists every square
    reachable this turn (`squares`); Dash lists double and spends the action. Leaving an enemy's reach
    (theirs, not yours) provokes an opportunity attack unless you Disengage. A melee attack reaches
    `reachFeet`. A ranged weapon or spell carries `rangeFeet`: within normal range as usual, between
    normal and long at disadvantage, past long range not at all. A target is listed when the attack or
    spell can hit them from where the hero stands or from a square they can reach without Dashing, so
    a vote can move and strike together; long range is still a legal target. A ranged attack while
    engaged has disadvantage. A vote may carry `move` (above). The choice text says when the hero will
    step in as part of Attack or Cast. Monsters use the same squares: a melee foe closes in, a ranged
    foe steps out of reach and keeps its distance.
  - **Area spells** catch by feet on the grid. A cone, line, emanation or an area of range Self
    reaches from the caster (a 15-foot cone catches whoever is within 15 feet, after they step in).
    A sphere, cylinder or cube with a range is placed on a foe and catches whoever is within its size
    of that foe. Each makes its own save. A fight stored with bands and no squares still catches by band.
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
  A written check is one of those lines, quoting what the player wrote.
- **Written actions** (`POST …/action`, `play/actions.ts`). A player may write what they do instead of
  picking a choice, in or out of a fight. The dungeon master classifies the words; the engine keeps the
  numbers. A known action is an id from this hero's `scene.actions`. A skill the words name is a medium
  check (DC 15), the same as voting that `skill:` action. Any other check uses the tier's DC and, on
  a success, the effect category's damage or a save for its condition. Impossible, and a classification
  the engine cannot read, is a narrated no and does not spend the turn. A written check is `scene.freeforms`,
  not a vote for a plot choice. Words sent as `text` on a vote that is not a skill stay with that action.
- **When it ends.** The heroes' sheets (level, XP, features, gold and gear; HP and slots restored) are
  saved back to each player's character, so the next adventure starts where this one left off. A dead
  hero goes home dead.

- **Older games and apps.** A game started before the engine has `rules: null`, choices with `rules:
  null` and `combat: false`, and plays as it always did (the DM breaks ties). Its `scene.actions` are the
  three choices (`choice:a` and so on). The current app decodes `GameState` and ignores the new keys, so it
  keeps working; dice show up as system messages. A vote that still sends `choiceId` is unchanged.

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
