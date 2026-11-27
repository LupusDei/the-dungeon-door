# Proposal: initiative combat

Status: **design only, for Micah's approval.** Nothing here is built. Quest log task
`q-mwz27sq0-351714`. It works alongside the combat HUD (`q-mwz231ft-ba7ef7`), which is being built
now.

Mockups: `initiative-combat-your-turn.png` (your turn) and `initiative-combat-moment.png` (someone
else's turn, with a picture at a big moment). Their HTML is in `initiative-combat-mockups/`; render
it with `google-chrome --headless --window-size=390,844 --force-device-scale-factor=2 --screenshot
<file>`.

## In one paragraph

A fight stops being a run of scenes. It becomes one scene with a **combat log**, a scroll that
grows one entry at a time. Heroes and monsters take turns in initiative order. On a hero's turn
only that player chooses. They pick an action, throw their d20, and the engine resolves it on the
spot, so the next player sees the new state. Monster turns run by themselves, a beat each. The
engine's line comes first ("Goblin 2 is bloodied"). The dungeon master adds one or two sentences
of colour a moment later, and never holds up the next turn. A new picture or a short summary
appears only at a moment that matters: the fight opening, a second wave, the boss bloodied, a hero
falling, the foes breaking. The engine finds those moments, the DM decides which deserve a picture,
and a budget keeps pictures to a few per fight. Outside combat nothing changes.

The engine already works this way. `rules/scene.ts` has `currentActor(state)` and
`act(state, action)`, and `fightRound` in `play/fight.ts` loops `act` until the round number
changes. Most of this work is the shell around the engine (storage, the API, the clock, the DM
call, the app). The rules barely change.

---

## 1. The player experience

### Entering combat

1. The party picks Engage (or a fight choice, or foes attack on the road), as now. The DM writes
   the opening as now: a title, a short narration and one picture. That is the fight's **opening
   card**, the first entry on the scroll.
2. The Story tab becomes the **Fight** tab: the HUD pinned at the top, the scroll under it, and a
   turn panel pinned at the bottom. Map, Sheet and Chat stay where they are. The Map tab keeps its
   ember dot.

### Rolling initiative

3. A **"Roll for initiative"** die appears for every player, with their bonus ("d20+3"). As in
   today's `myDie`, the server rolled the face when the fight began, and a throw reveals it.
   Monsters' initiative is shown at once.
4. **The fight does not wait for these throws.** The order was fixed when the fight began, so the
   first turn starts at once and the HUD shows the order immediately. A hero's number shows when
   their player throws, or at that hero's first turn, whichever comes first. A first actor who has
   not thrown simply starts their turn; their number appears with it. The throw is theatre, and
   players like throwing.
5. The HUD shows the order as a row of portraits and foe tokens. The current actor is ringed, and a
   small marker shows who is next.

### Whose turn it is

6. A **turn divider** opens each turn on the scroll: "Round 2 · Bryn's turn". Everyone's strip
   says whose turn it is. On a hero's turn the clock bar drains for everyone (section 2).

### What the current actor sees

7. The turn panel rises: **Your turn** with the clock, a short list of actions, and the d20.
   - At the top are the three quick actions written for this hero, as today (Attack with
     Longsword at Goblin 2, Cast Fire Bolt, Dodge or Help or Break Free). Under them, "More" opens
     the full legal list (`scene.actions`), the same list the Sheet and Map tabs already vote from.
   - A tap on a token on the Map, or a gold square, works as it does now: one submission is the
     whole turn, a move plus an action.
   - "In your own words" (`/action`) and "In character" (`/speak`) stay, under the actions.
8. A tap that needs a d20 locks the choice and **the die comes up**: "Throw for Attack with
   Longsword · d20+5". The player flicks it. Until they throw, they may change the action and keep
   the same face, as now.
9. On the throw the die lands, and within about half a second the **resolution line** is on the
   scroll for everyone. "Bryn attacks Goblin 2 with Longsword: 17 + 5 = 22 vs AC 15, hit. Goblin 2
   is bloodied." A crit gets a gold flash and a natural 1 an ember one. The HUD changes at the same
   moment: the goblin's wound chip becomes Bloodied.
10. An action with no d20 (Dodge, Dash, a potion, a spell the target saves against) resolves on the
    tap. A spell's saves are thrown by the engine and shown on the line.

### What everyone else sees

11. Others see the same scroll and HUD. Their turn panel is a slim bar: "Bryn is choosing… 0:31",
    with Bryn's portrait. When Bryn locks in, it becomes "Bryn: Attack with Longsword · throwing…",
    and a small die tumbles until the line lands.
12. Chat and in-character lines stay open to everyone at all times. An in-character line during a
    fight goes on the scroll as a speech entry, and it never spends a turn. Players can plan
    ("Corin, hit the one I bloodied") while one of them acts.
13. The Sheet and Map tabs stay readable off-turn. Their buttons are greyed with "Not your turn",
    the way the app already greys what the table is not offering.

### Monsters' turns

14. When a monster's turn comes up, it acts at once by its stat block, as today. Its entries come
    onto the scroll **one beat apart (about 1.2 seconds)**. Each is a compact line with a small
    token: "Goblin 1 attacks Corin with Scimitar: 9 vs AC 16, miss." Damage to a hero shows its
    number. Damage to a foe never does.
15. Several monsters in a row are one run. The DM narrates the whole run with a single sentence or
    two, which lands under the run.
16. Opportunity attacks, recharges ("Fire Breath is ready again"), death saves and morale breaks
    are their own small lines inside whichever turn caused them.

### The DM's line

17. Under each hero's resolution line, **one or two sentences of DM colour** fade in, usually
    within one to three seconds: "Your blade bites deep; the goblin staggers back, clutching its
    ribs." A small shimmer holds the space until it arrives. If it never arrives (the DM failed or
    was slow), the shimmer goes away. The engine line already told what happened.

### When pictures and summaries appear

18. A **moment card** is a wide entry with a painting, a heading and two or three sentences:
    "The Ogre Roars". It appears only at a significant moment (section 4). The text appears first.
    The painting fades in when it is ready, 10 to 20 seconds later, and nothing waits for it. The
    newest picture also becomes the fight's current picture: the backdrop of the Fight tab's
    header and the one the chronicle keeps.
19. A **summary card** is a moment card with no painting: a short recap after a long stretch with
    no big moment, for example at the start of round 4 or when someone comes back from away.

### Leaving combat

20. The fight's end is the last entry: "Victory! 150 XP, 75 each", then each fallen hero's fate
    (stabilized, death saves, Revivify), as today's lines.
21. The DM writes the next scene from the fight's summary. That is one ordinary scene call,
    painted as now. The app shows it as an ordinary scene again, and the Fight tab turns back
    into Story.
22. The fight goes into the chronicle as one entry: its opening picture, its title, the DM's
    outcome sentence and "Read the fight" to open the whole log. `sceneCount` grows by one for the
    whole fight, not one per round, so "Scene 3 of 6" stops jumping during fights.
23. Defeat, with every hero down, goes to the epilogue as now.

---

## 2. Timing

| What | Proposal |
| --- | --- |
| Initiative throw | never waited for: the first turn starts at once, and an unthrown number shows at that hero's first turn |
| A hero's turn | **45 s** from the turn's start (today a whole round is 90 s for everyone) |
| Away hero (two missed turns in a row) | 10 s, until that player acts or opens the game again |
| Classifying a written action | the clock stops while the DM classifies it (2 to 4 s) |
| A monster's turn on screen | 1.2 s per entry, 6 s at most for a whole run of monsters |
| Engine resolution | well under 100 ms, inside the request that threw the die |
| DM line | 1 to 3 s after the engine line, asynchronous |
| Moment picture | 10 to 20 s, asynchronous |

### Turns never wait for other players' input

This is a rule of the design, not a default. **A turn waits only for its own actor, and only until
that actor's clock runs out.** It never waits for anyone else:
- no "anyone want to help?" or "react?" pause after an action. Help is declared ahead, on the
  helper's own turn (section 5);
- no reaction prompts. Opportunity attacks and anything later that works like them are resolved by
  the engine from what was declared ahead (question 3);
- no wait for initiative throws (section 1, step 4), confirmations, or the DM's line or picture;
- no wait for a classification of someone else's words. Only the actor's own written action stops
  their own clock while it is classified.

As soon as an action resolves, the next combatant's turn begins in the same request. The only
pause between turns is the monster beat on screen (1.2 s per entry), and the clock is not running
during it. A feature pins this: "The next turn begins as soon as an action resolves".

### The clock

**An idle hero takes the Dodge action** when the clock runs out. That is what the engine does
today for a hero with no vote (`turnAction` in `play/fight.ts`), and it is the kind default: the
hero stays alive and nobody waits. The log says "Bryn hesitates and keeps her guard up (Dodge)."
An action chosen but whose die was not thrown is thrown by the server, as `settleDice` does today,
and resolves as chosen. Skipping the turn would be worse: nobody gains, and the hero is still a
target.

**Away.** After two clock-outs in a row, the hero is marked away (a moon on the HUD portrait). Its
next turns use a 10 s clock. The first poll or action from that player clears it. The host can also
skip the current hero at once (`/advance`, a Dodge).

**What makes the clock fire.** As with `settleDice` today, any request (mostly the polls every
2 s) checks whether the current turn is past its deadline and settles it. A table that is all
looking at the game therefore moves within 2 s of the deadline. A table where nobody is looking
waits, which is fine: there is nobody to show it to. The push for the turn tells them (section 3).

**Why monster beats are paced on the server.** The server resolves a run of monsters in one go,
but gives each log entry a `showAt` time 1.2 s after the one before. It starts the next hero's
clock at the last `showAt`. Every phone then sees the same rhythm, and the next player's 45
seconds do not start while the monsters are still playing out on their screen.

---

## 3. Data model and API

### Where things live

| Thing | Where | Migration |
| --- | --- | --- |
| The fight (combatants, order, round, current turn, seed) | `games.combat` (jsonb), as now. `CombatState` gains the fields below | none |
| The declared action and hidden die of the current turn | `games.combat.declared` | none |
| The turn counter, for compare-and-set | `games.combat_turn int NOT NULL DEFAULT 0` | additive |
| Which kind of combat a game plays | `games.combat_mode text NOT NULL DEFAULT 'rounds'` | additive |
| The log | new table `combat_log` | additive |

```sql
ALTER TABLE games ADD COLUMN IF NOT EXISTS combat_mode text NOT NULL DEFAULT 'rounds';
ALTER TABLE games ADD COLUMN IF NOT EXISTS combat_turn int NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS combat_log (
  game_code   text NOT NULL REFERENCES games(code) ON DELETE CASCADE,
  seq         int  NOT NULL,          -- per game, increasing; the poll's logSince
  fight       int  NOT NULL,          -- the scene index that opened the fight
  round       int  NOT NULL,
  turn        int  NOT NULL,          -- combat_turn when it was written
  kind        text NOT NULL,
  actor_id    text,
  entry       jsonb NOT NULL,         -- the CombatLogEntry below, less what has its own column
  narration   text,                   -- the DM's line, filled in later
  moment      jsonb,                  -- { reason, title, summary, imageUrl }, filled in later
  audience    jsonb,                  -- who could perceive it; null is everyone (see "Future", below)
  show_at     timestamptz NOT NULL,
  revised_at  timestamptz,            -- set when narration or moment lands: the poll's logUpdates
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_code, seq)
);
CREATE INDEX IF NOT EXISTS combat_log_revised ON combat_log (game_code, revised_at);
```

The memory store gets the same: an array per game.

`audience` is always null for now, and it is never sent to the app. Its shape is in section 9.

`CombatState` (in `rules/scene.ts`, still version 1, every new field optional):

```ts
turnStartedAt?: string;   // ISO, when this turn's clock began (the last showAt of the monsters before)
turnSeconds?: number;     // 45, or 10 for an away hero
away?: string[];          // heroes whose players missed two turns in a row
missed?: Record<string, number>;
declared?: { actor: string; actionId?: string; choiceId?: ChoiceId; targets?: string[];
             move?: Move; text?: string; freeform?: CheckRuling;
             roll: number; die: PlayerDie | null; revealed: boolean };
initiativeThrown?: string[]; // heroes who have thrown initiative (display only)
moments?: { turn: number; reason: MomentReason }[]; // pictures already spent this fight
```

### What the app is sent

`GameState` gains one key, `fight`, which is null outside an initiative fight. The HUD keeps reading
`rules.combat` (combatants, hp, wounds, conditions, `toughness`, `band`). `fight` adds the turn and
the log, and does not repeat the combatants.

```ts
status: … | "fighting"            // an initiative fight is on. "voting" is never used during one.

Fight {
  sceneIndex: number              // the scene that opened it (its title, picture and narration)
  round: number
  order: string[]                 // combatant ids in initiative order (rules.combat.combatants has the rest)
  initiative: { [id]: number | null }  // null: a hero who has not thrown yet (the face is hidden)
  turn: {
    seq: number                   // combat_turn; every turn call names it
    actorId: string
    playerId: string | null       // the hero's player; null for a monster
    phase: "choosing" | "throwing" | "monsters"
    startedAt: string; deadline: string; seconds: number; now: string
    away: boolean
    declared: null | { label: string; formula: string | null }   // what the actor locked in, for everyone
  }
  next: string | null             // who acts after this one
  mine: null | {                  // only for the current actor's player
    choices: Choice[]             // the three quick actions, as today's combat choices
    actions: LegalAction[]        // the full legal list, as scene.actions
    die: PlayerDie | null         // the d20 to throw, once an action needing one is locked
  }
  pictureUrl: string | null       // the newest moment's picture, else the opening's
  log: CombatLogEntry[]           // entries after logSince (all of this fight when it is omitted)
  logUpdates: CombatLogEntry[]    // entries at or before logSince whose narration or moment changed
}

CombatLogEntry {
  seq: number; round: number; turn: number
  kind: "opening" | "initiative" | "turn" | "action" | "monster" | "reaction" | "condition"
      | "death-save" | "morale" | "speech" | "moment" | "summary" | "end" | "system"
  actorId: string | null; actorName: string | null; side: "party" | "foes" | null
  declared: string | null         // "Attack with Longsword at Goblin 2"; a written action quotes the words
  die: null | {                   // the actor's own throw, when there was one
    natural: number; modifier: number; total: number
    versus: string | null         // "AC 15", "DC 13"
    result: "hit" | "miss" | "critical" | "fumble" | "success" | "failure"
  }
  lines: string[]                 // the engine's words, as rules.results today: foes' HP never appear
  changes: [{ id: string; hp?: number; wound?: string; status?: string;
              gained?: string[]; lost?: string[] }]   // hp for heroes only; wound for foes
  narration: string | null        // the DM's line; null until it lands, and may stay null
  moment: null | { reason: string; title: string; summary: string; imageUrl: string | null }
  showAt: string                  // don't draw it before this (the monster beat); the server's clock
}
```

`changes` lets the scroll show "Goblin 2 → Bloodied" chips, and lets the HUD flash the row that
just changed, without reading two polls against each other. A foe's change carries its `wound`
word, never its hit points (docs/api.md, Wounds).

`scene.combat` stays true on the fight's scene, and `scene.choices` and `scene.actions` stay
filled for the current actor, so the Sheet and Map tabs keep their vote code paths. They just send
to the new endpoint.

Three rules for the client, so a per-player feed (section 9) needs no app rewrite later:
- `seq` only grows. **It may have gaps**, and the app must not assume entries are contiguous or
  count them. `logSince` is the highest `seq` seen.
- `fight` is the caller's fight, built per caller (as `mine` already is). The app never assumes
  everyone at the table sees the same `fight`.
- The HUD draws the combatants it is given in `rules.combat.combatants`, and never assumes that is
  the whole party.

### Endpoints

| Call | What it does |
| --- | --- |
| `POST /api/games/{code}/turn` `{ turn, actionId \| choiceId, targets?, move?, text? }` | The current actor's action, with the same body as `/vote` plus `turn` (`fight.turn.seq`). No d20 needed: it resolves now, and the response carries the new entries. A d20 needed: the face is rolled and hidden, `fight.mine.die` is set, and calling again before the throw changes the action and keeps the face. 409 `not_your_turn`, 409 `stale_turn` (the turn moved on), 400 for an illegal action (same messages as `/vote`). |
| `POST /api/games/{code}/roll` `{ turn }` | Throws the hidden die: the turn resolves at once, then the monsters after it, all in this request. With `turn` it is a fight throw. With `sceneIndex` it is today's throw. `{ initiative: true }` reveals the caller's initiative; it changes no turn and is refused once that hero's first turn has begun (their number is already shown). |
| `POST /api/games/{code}/action` `{ turn, text }` | A written action in a fight, on your own turn. The DM classifies, the clock stops meanwhile, then it plays like `/turn`. Off your turn: 409 `not_your_turn`. |
| `POST /api/games/{code}/speak` `{ text }` | Unchanged for the player. During a fight the line also goes onto the log as `speech`. Anyone, at any time. |
| `POST /api/games/{code}/advance` | Host only: the current hero Dodges now. (Today it resolves the whole round.) |
| `GET /api/games/{code}?since=&logSince=` | The poll. `fight.log` holds the entries after `logSince`, and `fight.logUpdates` the late narration and pictures. It also settles an expired turn first, as it settles dice today. |
| `GET /api/games/{code}/fights/{sceneIndex}` | A past fight's whole log, for "Read the fight" in the chronicle. |

`/vote` during an initiative fight is 409 `use_turn`. `/ending` during a fight still marks the
fight's scene as the last, as now.

### Exactly once

Every write to a turn is a compare-and-set on `games.combat_turn`. Declaring writes `declared`
only where `combat_turn = turn`. Resolving writes the new `combat`, increments `combat_turn` and
inserts the log rows in one transaction, again only where `combat_turn = turn`. A throw racing
the poll that times the same turn out is settled by whichever commits first. The other gets 409
`stale_turn` (the app ignores it and shows the poll). The memory store does the same under its
lock.

### One gate for what a player perceives

Every path that hands log entries, combatants or a moment's picture to a player goes through one
function, `lib/play/perceive.ts`: `perceives(audience, playerId, game)`. That covers the poll
(`log` and `logUpdates`), `/turn` and `/roll` responses, the past-fight endpoint, the turn push and
the HUD's `rules.combat.combatants`. It is the same pattern as `canSee` for whispers. For now it
returns true for every entry, since `audience` is null. The beat's `recent` lines for the DM are
picked by the same function, so the DM is never told what the group it narrates for could not
know.

### Polling and pushes

- The app keeps polling every 2 s. While a fight is on and the caller is not the actor, that is
  enough. The engine line lands within 2 s of the throw. The thrower gets the entries in the
  `/roll` response itself, so their own result is instant.
- The app draws an entry when the clock passes `showAt`, counted against `turn.now` as the choice
  window is counted today. A late joiner sees past entries at once.
- The "Live updates instead of checking every 2 seconds" task (SSE) would make the others instant
  too. It is not required for this.
- **Push** (docs/push.md): kind `"combat"`, to the actor's player only, when a hero's turn starts
  and they have not polled in the last 4 s: "Your turn, Bryn: Goblin 2 is bloodied." With a 45 s
  clock the usual eight-second hold is shortened to 4 s for this push. The throttle rules stay.

### Rollout and older apps

A game's `combat_mode` is set when it starts. It is `initiative` when `DD_INITIATIVE=1` and every
seated player is on a build that knows `fighting` (`INITIATIVE_MIN_BUILD`, next to `MIN_APP_BUILD`);
otherwise it is `rounds`, and that game fights exactly as today for its whole life. A fight already
under way never changes mode. Once the build is out, flipping the flag turns it on with no
migration, and turning it back off is just as safe.

---

## 4. The dungeon master's part

### Who computes what

| | Engine | DM |
| --- | --- | --- |
| Initiative, order, whose turn | yes | no |
| Legal actions, targets, squares | yes | no |
| Every die, hit, damage, save, condition, death, morale, XP | yes | no |
| Monster choices (who to attack, where to step) | yes, by its stat block | no |
| Which turns are *candidates* for a moment | yes (a fixed list) | no |
| One or two sentences per hero action, one per monster run | no | yes |
| Whether a candidate deserves a picture, and its title, summary and image prompt | no | yes (within a budget the engine keeps) |
| Classifying a written action | no | yes (as today) |
| The fight's opening and the scene after it | no | yes (as today) |

### Moments

The engine marks a turn as a **candidate** when one of these happened:

| Reason | When |
| --- | --- |
| `opening` | the fight began (always painted, as now) |
| `wave` | new foes joined (wanderers into a fight, a summon), once that is possible |
| `boss-bloodied` | the strongest foe (highest XP, or toughness `strong`/`deadly`) went to Bloodied or worse |
| `hero-down` | a hero dropped to 0 HP, or died |
| `foe-falls` | the strongest foe, or the last of a kind, fell |
| `turned` | morale broke (they flee or surrender), or the fight's band dropped two steps |
| `critical` | a natural 20 that dropped a foe |
| `lull` | three rounds with no other candidate (a summary only, never a picture) |
| `end` | the fight ended (the next scene's picture covers it) |

The DM's beat answer says, for a candidate: `moment: "none" | "summary" | "picture"`. The engine
keeps the budget: **at most two mid-fight pictures, at least two rounds apart**, and `lull` is
summary-only. A `picture` past the budget becomes a `summary`. A beat that is not a candidate cannot
make a moment. That keeps cost bounded however chatty the model is, and leaves the DM the choice
Micah asked for.

### The new DM call

A new optional method on the `DungeonMaster` interface (`lib/dm/types.ts`):

```ts
narrateBeat?(ctx: BeatContext): Promise<Beat>;

interface BeatContext {
  archetype: Archetype;              // voice
  adventureTitle: string | null;
  place: string;                     // the fight scene's title and a line of its narration
  party: { name: string; look: string }[];
  foes: { name: string; wound: string; status: string }[];   // words, never HP
  recent: string[];                  // the last ~6 entries' engine lines and DM lines, oldest first
  beat: { actor: string; side: 'party' | 'foes'; declared: string | null;
          words: string | null;      // the player's own words with the action, if any
          lines: string[] };         // what the engine says happened this turn (or this monster run)
  candidate: MomentReason | null;
  picturesLeft: number;
}

interface Beat {
  narration: string;                 // 1–2 sentences, ≤ 240 characters
  moment: 'none' | 'summary' | 'picture';
  title: string;                     // "" unless moment is not none
  summary: string;                   // "" unless moment is not none; 2–3 sentences
  imagePrompt: string;               // "" unless moment is picture
}
```

The schema is flat with no nullable fields, for the same reason the hook schema is
(`lib/dm/hookSchema.ts`). The prompt is short and fixed: "You narrate one beat of a fight. The
engine has already decided what happened; the lines below are true. Colour them in one or two
sentences for a phone. No numbers. Never speak or decide for a hero; describe the world, the foes
and the physical result. A natural 20 is spectacular, a natural 1 a mishap of that action." The same
`stripHeroSpeech` guard runs on the answer. The fake DM writes a fixed sentence from the engine
line, and makes a moment on every candidate (budget permitting), so the features can see it.

`nextScene` after a fight gets `resolution.rules.lines` as now, but built from the **fight's
summary** rather than every die: how it began, each moment's title and summary, who fell, how it
ended, and the XP line. This keeps the after-fight prompt the size it is today.

### Model, cost and latency

The beat is a small call: about 1,200 tokens in and 80 out. It should use a fast model, set by a
new `DD_BEAT_MODEL`, which defaults to `DD_TEXT_MODEL`. Prices below are list prices per million
tokens; check them before deciding.

| Per beat | Sonnet-class ($3 in / $15 out) | Haiku-class ($1 / $5) |
| --- | --- | --- |
| Cost | about 0.5 ¢ | about 0.2 ¢ |
| Time to answer | 1.5–3 s | 0.6–1.5 s |

A typical fight is 2–4 heroes and 2–4 foes over 3–4 rounds. That is about 12 hero beats and 4–8
monster runs: **about 20 beats a fight**, roughly 10 ¢ with Sonnet or 4 ¢ with Haiku. Add one
opening painting (as now), up to two moment paintings (each one a scene painting's price), and the
after-fight scene call (as now, about 1.5 ¢). Today a fight costs one DM scene call per round
(about 1.5 ¢ and 10–15 s each) plus the opening painting. So text costs about the same with Haiku
and a few cents more with Sonnet, and paintings go from one to as many as three. The 10–15 s
"The tale unfolds…" wait between rounds goes away entirely.

**Recommendation:** Haiku-class for beats, Sonnet for scenes, and a picture budget of two. Knobs:
`DD_BEAT_MODEL`, `DD_FIGHT_PICTURES` (0–3), and `DD_BEATS=heroes` to narrate hero actions only and
leave monster runs to the engine's lines.

A beat is fire-and-forget (`runInBackground`). It writes `narration` (and `moment`) onto its log
row and sets `revised_at`. A beat that fails or takes more than 8 s is dropped. Beats for one fight
run one at a time, oldest first, so a slow model never narrates out of order. If one is still
running when the next turn's beat is due, the waiting beats are folded into one.

`npm run dm:check` gains a fourth call: one `narrateBeat` against the real model, to prove the
schema is accepted (about a cent more).

---

## 5. How it fits with what exists

**Dice (`votes.die`, `revealed`, `/roll`, the auto-reveal).** The same idea, moved from the vote
row to `combat.declared`. The face is rolled when the action is locked, hidden until the throw, and
the same face is kept if the action changes. A die the server throws at the deadline costs the
hero no XP: only XP earned outside a fight is halved for an idle hero. `PlayerDie` and `dieForAction` are
reused unchanged. Outside fights, votes keep `die` and `revealed` exactly as now.

**Written actions.** On your turn, `/action` with `turn`. The DM classifies as now. A known action
plays as that action. A check rolls the hidden d20 and asks for a throw. "Impossible" does not
spend the turn and the clock resumes. The words are quoted in the log entry's `declared`.

**In character.** `/speak` and in-character chat during a fight become `speech` log entries as
well as roleplay. The beat's `recent` includes them, so the DM can answer a taunt.

**XP.** Unchanged. The fight's XP is split among the living heroes when it ends (`award` in
`play/fight.ts`). A surrender pays all the foes, a flight pays the slain. Away heroes still get
their share, as heroes who did not vote do today. Levelling still waits for the quest's end.

**Conditions and concentration.** These move from round boundaries to turn boundaries, which is
closer to SRD 5.2:
- A save that ends a condition is made **at the end of that hero's own turn** (today all heroes
  save at the start of the round, `shakeOff(party, ['save'])` in `fightRound`).
- Concentration saves after each hit (`keepConcentration`), and morale checks (`morale`), run after
  every action instead of once per round. A foe can therefore break in the middle of the round, and
  the next hero sees it at once.
- Dodge, reactions and the move budget already reset at the start of the combatant's own turn
  (`advance` in `rules/scene.ts`).
- Death saves stay automatic at first. A later phase lets the dying hero's player throw their own.

**Opportunity attacks** are already automatic in the engine (`relocate` → `reactionAttack`). They
stay automatic and appear as `reaction` lines inside the mover's turn.

**Bonus-action healing** (Second Wind, a potion at half HP) stays automatic before the action, as
now.

**The HUD.** The HUD is the current state and the scroll is the history. Neither copies the other.
- The HUD reads `rules.combat.combatants` exactly as it is being built: exact HP for heroes, wound
  words and `fill` for foes, conditions, status. This proposal adds nothing there that it must
  change.
- It gains one optional input: `fight.turn.actorId` and `fight.next` for a ring and a "next" mark,
  and `fight.order` for its ordering (combatants are already in initiative order).
- When an entry's `changes` arrive, the HUD may flash those rows. The scroll draws the same
  changes as chips.
- Layout: HUD pinned at the top of the Fight tab (two compact rows: party, then foes), the scroll
  in the middle, the turn panel pinned at the bottom. On iPhone SE the HUD collapses to one row of
  rings.
- Ask for the HUD agent: keep the HUD a view of `[Combatant]` plus an optional current-actor id,
  so it can sit above the scroll unchanged. Section 6, question 9.

**The Map tab** is unchanged. The gold squares and token cards vote through `/turn` instead of
`/vote`, and are live only on your turn.

**The chronicle and past adventures.** A fight is one chronicle entry. `Adventure.images` lists
the opening picture and any moment pictures. `scenes` counts the fight once.

**Narration (Listen).** Listen reads the fight's opening, as now. Beats are not read aloud; that
can come later.

**The rounds mode** stays for games started before the switch and for any game started with an
old app. `fightRound` is rebuilt on the new per-turn step (phase 1), so both modes run the same
rules code.

### Help: the 5e action replaces group helping in a fight

**Today.** Outside a fight, a party check in "best" mode is rolled by the hero with the best bonus,
and every standing companion proficient in that skill gives Advantage (`play/checks.ts`,
`canHelp`). That is a group decision, and it fits a group vote. In a fight, `common:help` and the
third choice's "Help *name*" only stabilize a dying ally. On anyone else, Help is a line in the log
and does nothing (`resolveNamedAction` in `play/legal.ts`). With one combatant acting at a time,
there is no shared choice for heroes to help each other on.

**In a fight it becomes the plain 5e Help action (Micah's decision).** On your own turn you
spend your action and pick **an ally**, and **optionally a foe**. The ally's **next ability check
or attack roll** before your next turn has Advantage. If you named a foe, the attack has to be
against that foe. That is all there is to it: no coordination, nobody else is asked anything, and
nothing waits (section 2, "Turns never wait"). There is no conditional or readied Help.

| You pick | What gets Advantage | Limits | Ends |
| --- | --- | --- | --- |
| an ally | that ally's next ability check or attack roll, against anyone | none | used by that roll, or lapses at the start of your next turn |
| an ally and a foe | that ally's next ability check, or next attack roll against that foe | the foe is within 5 feet of you (the SRD's feint distance; a reach weapon does not lengthen it) | the same |
| a dying ally | nothing: you try to stabilize them, a DC 10 Wisdom (Medicine) check or a Healer's Kit, as today | within 5 feet | at once |

This is simpler than SRD 5.2 on purpose. The SRD splits Help into an attack form (any ally's next
attack on a foe within 5 feet of you) and a check form (one skill you are proficient in). Here
there is one form, the Advantage sits on the ally you name, and there is no skill to pick and no
proficiency to check.

**Rules details:**
- The action id stays `common:help`. Its `targets` are each ally ("Corin") and each ally-and-foe
  pair within reach ("Corin against the Ogre"), in the existing `{ id, name }` shape with
  `picks: "one"`, so the API needs no new field. A dying ally's target means stabilize.
- Help needs no d20 from the helper, so it resolves on the tap, and the next turn begins at once.
- It covers ability checks and attack rolls, not saving throws, as in 5e. Checks that come up in a
  fight are Break Free, Hide, stabilizing and written checks.
- One Help is used by one roll: whichever qualifying d20 test the ally makes first. An opportunity
  attack by that ally counts.
- Help does not stack. Two Helps on Corin give Corin's next roll Advantage once, and the second
  Help waits for Corin's following roll until its helper's next turn.
- A Help is discarded when its named foe falls, when its ally drops, and when the fight ends. The
  helper going down does not cancel it before their next turn.
- Advantage from Help joins any other source and cancels against Disadvantage, as the engine does
  now (`resolve.ts`). The extra d20 comes from the game's seeded RNG. The player's thrown face is
  always one of the two dice.
- Monsters do not take the Help action, as they take none of the common actions today.

**How it is chosen:**
- **Turn panel and Sheet.** "Help" sits among the common actions. A tap opens the list of allies,
  each with "against…" choices for foes within 5 feet. The turn panel's third quick action becomes
  "Help Corin against the Ogre" when an ally is engaged with a foe in the helper's reach and no
  friend is dying.
- **Map.** An ally token's card gets **Help**. A foe within 5 feet of the helper adds "Help *ally*
  against it" for each ally engaged with that foe.
- **In your own words.** "I wave my torch in the Ogre's face so Corin can hit it" is classified as
  `common:help`, with the ally and the foe the words name. This fixes, for Help, the TODO in
  `castAction` that drops named targets. When the words name no ally, the engine picks the ally
  engaged with that foe, or else the one who is Grappled or Restrained.

**How it is shown:**
- **Log.** The helper's entry: "Bryn distracts the Ogre for Corin: Corin's next attack on it has
  Advantage (until Bryn's next turn)." With no foe named: "Bryn helps Corin: Advantage on Corin's
  next check or attack." When it is used, Corin's die shows "Advantage · Bryn's help" and the line
  reads "Corin attacks the Ogre with Mace, with Bryn's help: 8 and 16, 16 + 4 = 20 vs AC 11, hit."
  If unused, a small line at the start of Bryn's next turn: "Bryn's help for Corin lapses." The
  DM's beat gets the same lines, so it can tell the feint.
- **HUD.** A gold hand **marker on the ally**: "Advantage · Bryn", or "Advantage vs Ogre · Bryn".
  A named foe gets a faint outline. The marker goes when the Help is used or lapses. A new optional
  field on each hero in `rules.combat.combatants` carries it:
  `helped: [{ by: string; against: string | null }]` (`against` is the foe's id when one was
  named). It ends at the start of `by`'s next turn. The log entry's `changes` add and remove it, so
  the HUD can flash it. The HUD agent only has to draw the marker.
- **Turn panel.** On the helped ally's turn their actions say so: "Attack the Ogre with Mace ·
  Advantage (Bryn's help)". The same note goes in that action's `detail`, and on checks such as
  Break Free.

**State.** `CombatState.helps?: { by: string; ally: string; against?: string }[]` in
`games.combat` (no migration). `advance` in `rules/scene.ts` clears the helper's entries at the
start of their turn, where it already clears `dodging`. The attack and check resolvers take the
ally's first matching entry and remove it.

**Outside a fight it stays as it is.** Recommended: yes. Out of combat the party still decides
together, and a party check with proficient companions giving Advantage is how 5.2 treats one
hero leading with help. Nothing changes in `play/checks.ts`. A later "one hero helps another" out of
combat can reuse the same Help if the out-of-combat flow ever becomes per-hero.

**Rounds mode** gets the same Help, because both modes run the same engine after phase 1. Within a
round, a Help counts for an ally who acts after the helper, and otherwise carries into the next round
until the helper's turn.

---

## 6. Open questions for Micah

Each has a recommended answer. Agreeing with all of them is a fine reply.

1. **Idle hero: Dodge or skip?** Recommend **Dodge** after 45 s, and a 10 s clock once the hero has
   missed two turns. Skipping helps nobody, and Dodge is what the engine does today.
2. **How long is a turn?** Recommend **45 s**, and the host can skip at any time. 30 s feels rushed
   on a phone with a spell list; 60 s drags with four heroes.
3. **Reactions and opportunity attacks?** Recommend **automatic only**: opportunity attacks as now,
   and no prompts that stop the table to ask someone else. Player-chosen reactions (Shield,
   Uncanny Dodge, Hellish Rebuke) come later as standing toggles on the sheet ("Use Shield when it
   would turn a hit"), never as an interruption.
4. **Readied actions?** Recommend **not in the first version.** Ready stays listed as today. Later,
   offer three fixed triggers ("attack the first foe that comes within reach", "cast at the first
   foe that comes into range", "Dodge until hit"), each resolved by the engine when it fires. Help is never readied (question 14).
5. **Initiative ties?** Recommend the engine's current rule (higher bonus, then the seed), with
   **heroes before monsters** on a full tie. SRD 5.2 leaves ties to the DM and the players. This
   keeps it automatic and slightly kind.
6. **A player who disconnects mid-turn?** Recommend: their clock runs. A locked action whose die
   was not thrown is thrown for them and resolves. No action means Dodge. Two misses mean away (10 s
   turns). A player who leaves the game: their hero leaves the order at the end of its turn, as
   leaving gives up the seat today.
7. **Do players throw initiative themselves?** Recommend **yes, with no waiting**: the first turn
   starts at once, and an unthrown number shows at that hero's first turn. It is theatre (the order
   is fixed at the fight's start), but it starts the fight with everyone touching a die.
8. **Pictures per fight?** Recommend the opening plus **at most two**, at least two rounds apart,
   only on an engine candidate, and the DM chooses which. Adjustable with `DD_FIGHT_PICTURES`.
9. **The HUD.** Recommend the HUD stays a pure view of the combatants with an optional
   current-actor ring, pinned above the scroll. Is two rows (party, then foes) the look you want, or
   one row of rings?
10. **Move then act, or act then move?** Recommend **one submission per turn** (a move plus an
    action), as votes are now. Splitting a move around an action ("step in, swing, step back") is a
    later phase.
11. **Monster runs narrated as one beat?** Recommend **yes**. Each monster gets its own engine line,
    and the DM writes one sentence or two for the whole run. It keeps the scroll readable and halves
    the beat count.
12. **Can off-turn players prepare their next action?** Recommend **no**. The point is to choose
    from the new state. They can plan in chat and look at the Sheet and Map.
13. **Rounds mode.** Recommend keeping it only for old games and old apps, and removing it once no
    open game uses it.
14. **Help. Decided by Micah:** the plain 5e Help action only. Pick an ally, and optionally a
    foe; the ally's next check or attack before your next turn has Advantage. No conditional or
    readied Help, because it takes too much coordination.
15. **Group helping outside combat?** Recommend **keeping it as it is**: the party's check, rolled
    by the best hero with Advantage from proficient companions.

---

## 7. Draft Gherkin feature

This would be `server/features/initiative_combat.feature`. It is listed here only and not added to
the repository. Each phase below names the scenarios it makes pass.

```gherkin
Feature: Initiative combat

  In a fight every hero and monster takes a turn in initiative order. A hero's
  action resolves as soon as its die is thrown, so the next to act sees what it
  did. The fight is one scene with a log that grows one turn at a time.

  Background:
    Given a game in initiative combat mode
    And the heroes "Bryn" (fighter) and "Corin" (cleric)

  # --- Starting a fight ---------------------------------------------------

  Scenario: A fight opens with heroes and monsters in one initiative order
    Given the party engages "Goblin Warrior" and "Goblin Warrior"
    Then the game is "fighting"
    And the fight's order holds Bryn, Corin, Goblin Warrior 1 and Goblin Warrior 2 by initiative
    And the log begins with the fight's opening

  Scenario: A hero's initiative is hidden until they throw it
    Given the party engages "Goblin Warrior"
    Then Bryn's initiative is not shown
    When Bryn throws initiative
    Then Bryn's initiative is shown
    And the order is the one fixed when the fight began

  Scenario: The first turn does not wait for initiative throws
    Given the party engages "Goblin Warrior"
    And no hero has thrown initiative
    Then the first turn has begun

  Scenario: An unthrown initiative shows at that hero's first turn
    Given Corin has not thrown initiative
    When Corin's first turn begins
    Then Corin's initiative is shown

  Scenario: Heroes go before monsters on a full tie
    Given Bryn and a Goblin Warrior roll the same initiative with the same bonus
    Then Bryn acts before the Goblin Warrior

  Scenario: A fight is one scene however many rounds it lasts
    Given a fight that lasts 3 rounds
    Then the scene count grew by 1 for the fight

  # --- Whose turn ---------------------------------------------------------

  Scenario: Only the hero whose turn it is may act
    Given it is Bryn's turn
    When Corin attacks Goblin Warrior 1
    Then the action is refused as "not_your_turn"

  Scenario: An action for a turn that has passed is refused
    Given it was Bryn's turn 3
    And the fight has moved on to turn 4
    When Bryn attacks for turn 3
    Then the action is refused as "stale_turn"

  Scenario: Only the actor is offered actions
    Given it is Bryn's turn
    Then Bryn is offered actions
    And Corin is offered none

  Scenario: The next turn begins as soon as an action resolves
    Given it is Bryn's turn and Corin acts next
    When Bryn's attack resolves
    Then it is Corin's turn
    And no other player was asked for input

  Scenario: Voting is closed in an initiative fight
    Given it is Bryn's turn
    When Bryn votes for choice "a"
    Then the vote is refused as "use_turn"

  # --- A hero's action resolves at once -----------------------------------

  Scenario: An attack waits for the hero's throw
    Given it is Bryn's turn
    When Bryn attacks Goblin Warrior 1 with "Longsword"
    Then Bryn has a die to throw, "d20+5"
    And the log has no entry for Bryn's attack yet

  Scenario: The throw resolves the attack and the next turn begins
    Given it is Bryn's turn
    And Bryn's next d20 is 17
    When Bryn attacks Goblin Warrior 1 with "Longsword"
    And Bryn throws
    Then the log's newest hero entry says Bryn rolled 17, total 22, against "AC 15"
    And it is a hit
    And the next combatant's turn has begun

  Scenario: The next hero chooses from the state the last action left
    Given Goblin Warrior 1 has 3 hit points left
    And it is Bryn's turn, then Corin's
    When Bryn drops Goblin Warrior 1
    Then Corin may not target Goblin Warrior 1

  Scenario: Changing the action before the throw keeps the same face
    Given it is Bryn's turn
    When Bryn attacks Goblin Warrior 1 with "Longsword"
    And Bryn changes to attack Goblin Warrior 2 with "Longsword"
    And Bryn throws
    Then the face thrown is the one rolled first

  Scenario: An action that needs no die resolves when it is chosen
    Given it is Bryn's turn
    When Bryn takes the "common:dodge" action
    Then the log's newest hero entry is Bryn dodging
    And the next combatant's turn has begun

  Scenario: A foe's hit points never appear in the log
    Given Bryn hits Goblin Warrior 1
    Then no log entry names Goblin Warrior 1's hit points
    And the entry's changes give Goblin Warrior 1 a wound word

  Scenario: A hero's damage is told in numbers
    Given Goblin Warrior 1 hits Corin for 5
    Then the entry's changes give Corin's hit points

  Scenario: Two throws of the same turn resolve it once
    Given it is Bryn's turn with an attack chosen
    When Bryn's throw and the deadline land together
    Then the log has one entry for Bryn's attack

  # --- Help ----------------------------------------------------------------

  Scenario: Help for an ally gives their next attack Advantage
    Given it is Bryn's turn
    When Bryn helps Corin
    Then the log says Bryn helps Corin
    And Corin is marked as helped by Bryn
    And it is the next combatant's turn without a throw from Bryn
    When Corin attacks Goblin Warrior 1
    Then Corin's attack has Advantage from Bryn's help

  Scenario: Help for an ally gives their next check Advantage
    Given Corin is Grappled
    And Bryn helped Corin
    When Corin breaks free with Athletics
    Then Corin's check has Advantage from Bryn's help

  Scenario: Help naming a foe applies to attacks on that foe
    Given the Ogre is within 5 feet of Bryn
    And Bryn helped Corin against the Ogre
    When Corin attacks Goblin Warrior 1
    Then Corin's attack does not have Advantage
    And Corin is still marked as helped against the Ogre
    When Corin attacks the Ogre
    Then Corin's attack has Advantage from Bryn's help

  Scenario: A foe can be named only within 5 feet of the helper
    Given the Ogre is 10 feet from Bryn
    Then Help offers no "against the Ogre" target for Bryn

  Scenario: Helping asks nobody else anything
    Given it is Bryn's turn
    When Bryn helps Corin
    Then no player is asked for input
    And the next combatant's turn has begun

  Scenario: Help is for the ally it names
    Given Bryn helped Corin
    When Mira attacks Goblin Warrior 1
    Then Mira's attack does not have Advantage

  Scenario: A help is used by one roll
    Given Bryn helped Corin
    When Corin attacks twice before Bryn's next turn
    Then Corin's first attack has Advantage
    And Corin's second attack does not
    And Corin is no longer marked as helped

  Scenario: Help does not cover saving throws
    Given Bryn helped Corin
    When Corin makes a Dexterity saving throw
    Then the save does not have Advantage
    And Corin is still marked as helped

  Scenario: Two helps for one ally do not stack
    Given Bryn and Pip each helped Corin
    When Corin attacks
    Then Corin's attack has Advantage once
    And Corin is still marked as helped by Pip

  Scenario: An unused help lapses at the start of the helper's next turn
    Given Bryn helped Corin
    And Corin made no check or attack
    When Bryn's next turn begins
    Then the log says Bryn's help for Corin lapses
    And Corin is no longer marked as helped

  Scenario: A help is discarded when its named foe falls
    Given Bryn helped Corin against Goblin Warrior 1
    When Goblin Warrior 1 falls to someone else's spell
    Then no help is left on the fight

  Scenario: The helped ally's opportunity attack uses the help
    Given Bryn helped Corin against Goblin Warrior 1
    When Goblin Warrior 1 leaves Corin's reach and Corin's opportunity attack is made
    Then Corin's opportunity attack has Advantage from Bryn's help

  Scenario: Help on a dying ally stabilizes them
    Given Corin is dying within 5 feet of Bryn
    When Bryn helps Corin
    Then Bryn makes a DC 10 Medicine check to stabilize Corin

  Scenario: Help in your own words names its ally and foe
    Given it is Bryn's turn
    And the Ogre is within 5 feet of Bryn
    When Bryn writes "I wave my torch in the Ogre's face so Corin can hit it"
    Then Bryn helps Corin against the Ogre

  Scenario: Outside a fight companions still help the best hero's check
    Given the party is not in a fight
    And the party takes a check in which the best hero rolls
    And Corin is proficient in that skill
    Then the roll has Advantage because Corin helps

  # --- Monsters -------------------------------------------------------------

  Scenario: Monsters act by themselves until a hero's turn
    Given Goblin Warrior 1 and Goblin Warrior 2 act after Bryn
    When Bryn's turn resolves
    Then both goblins' turns are in the log
    And it is Corin's turn

  Scenario: Monster entries are shown a beat apart
    When two monsters act in a row
    Then their entries are 1.2 seconds apart by showAt

  Scenario: The next hero's clock starts after the monsters are shown
    When two monsters act before Corin
    Then Corin's turn starts at the second monster entry's showAt

  # --- The clock ------------------------------------------------------------

  Scenario: A hero's turn is 45 seconds
    Given it is Bryn's turn
    Then the turn's deadline is 45 seconds after it started

  Scenario: An idle hero dodges when the clock runs out
    Given it is Bryn's turn
    When 45 seconds pass with no action from Bryn
    Then the log says Bryn keeps their guard up
    And Bryn is dodging
    And the next combatant's turn has begun

  Scenario: A chosen action is thrown for the hero when the clock runs out
    Given it is Bryn's turn with an attack chosen and the die not thrown
    When 45 seconds pass
    Then the attack resolves with the face rolled when it was chosen

  Scenario: A hero who misses two turns is away and gets 10 seconds
    Given Bryn's clock ran out on both of Bryn's last two turns
    When it is Bryn's turn
    Then Bryn is away
    And the turn's deadline is 10 seconds after it started

  Scenario: Acting again ends being away
    Given Bryn is away
    When Bryn's player opens the game
    Then Bryn is not away

  Scenario: The host can skip the current hero
    Given it is Bryn's turn
    When the host advances
    Then Bryn is dodging
    And the next combatant's turn has begun

  # --- Written actions and speech --------------------------------------------

  Scenario: A written action on your turn is your action
    Given it is Bryn's turn
    When Bryn writes "I kick the brazier into the goblins"
    Then the action is classified and played as Bryn's turn
    And the log entry quotes "I kick the brazier into the goblins"

  Scenario: An impossible written action does not spend the turn
    Given it is Bryn's turn
    When Bryn writes something impossible
    Then it is still Bryn's turn

  Scenario: Speaking in character never spends a turn
    Given it is Bryn's turn
    When Corin says in character "Hold the line!"
    Then the log has a speech entry from Corin
    And it is still Bryn's turn

  # --- Conditions, concentration and morale ---------------------------------

  Scenario: A condition a save ends is saved against at the end of the hero's own turn
    Given Corin is poisoned until a DC 12 CON save
    When Corin's turn ends
    Then Corin makes the DC 12 CON save

  Scenario: Foes may break in the middle of a round
    Given the goblins' leader falls on Bryn's turn
    Then the goblins check morale before the next turn

  # --- The dungeon master ------------------------------------------------------

  Scenario: The engine's line comes before the dungeon master's
    When Bryn's attack resolves
    Then the log entry has the engine's lines
    And its narration is empty until the dungeon master answers

  Scenario: The dungeon master's line arrives as an update
    Given the poll last saw log entry 7
    When the dungeon master narrates entry 7
    Then the next poll carries entry 7 in logUpdates with its narration

  Scenario: A dungeon master who fails does not stop the fight
    Given the dungeon master fails every beat
    When Bryn's attack resolves
    Then the next combatant's turn has begun
    And the entry has no narration

  Scenario: A run of monsters is narrated once
    When two monsters act in a row
    Then the dungeon master is asked to narrate one beat for both

  # --- Moments ---------------------------------------------------------------

  Scenario: The opening is a moment with a picture
    Given the party engages "Ogre"
    Then the log's opening entry has a picture

  Scenario: A bloodied boss may get a picture
    Given the dungeon master paints every moment it is offered
    When Bryn bloodies the Ogre
    Then the log has a moment "boss-bloodied" with a picture

  Scenario: An ordinary hit is never a moment
    When Bryn hits Goblin Warrior 1 and it is not bloodied
    Then the entry has no moment

  Scenario: Pictures are kept to the fight's budget
    Given the dungeon master paints every moment it is offered
    And a fight with four candidate moments, each two rounds apart
    Then the fight has at most 2 pictures besides its opening
    And the other candidates are summaries

  Scenario: A lull is a summary, not a picture
    Given three rounds pass with no candidate moment
    Then the log has a summary entry with no picture

  # --- Leaving the fight ----------------------------------------------------------

  Scenario: Victory splits the XP and the story goes on
    When the last goblin falls
    Then the log ends with "Victory!" and the XP each hero earned
    And the game is "resolving" while the dungeon master writes the next scene
    And then the game is "voting" on an ordinary scene

  Scenario: Every hero down goes to the epilogue
    When the last standing hero drops
    Then the next scene is the epilogue

  Scenario: After ten rounds the foes flee
    Given a fight in its tenth round
    When the round ends
    Then the log ends with "The foes flee."

  Scenario: A past fight's log can be read whole
    Given a fight that has ended
    Then the fight's log can be read from the chronicle

  # --- Polling -------------------------------------------------------------------

  Scenario: The poll sends only new log entries
    Given the poll last saw log entry 4
    When two more entries are written
    Then the next poll carries entries 5 and 6

  Scenario: While the party is together every player perceives every entry
    Given Bryn's player and Corin's player both poll the fight
    Then both see the same log entries
    And no entry carries an audience

  Scenario: A game started in rounds mode keeps fighting in rounds
    Given a game in rounds combat mode
    When the party engages "Goblin Warrior"
    Then each round is a scene and every hero votes
```

---

## 8. Build plan

Each phase ships alone: the gates pass (`typecheck`, `test`, `features`), it deploys, and nothing
changes for players until the flag is on. Sizes are rough: **S** is a few hundred lines with tests,
**M** about 500 to 1,000, **L** more than that.

| Phase | What ships | Gherkin scenarios | Size |
| --- | --- | --- | --- |
| **1. One turn at a time in the engine** | `play/initiative.ts`: `takeTurn(party, combat, heroAction \| null)` returns `{ party, combat, entries, candidate, ended }`. It is the body of `fightRound`'s loop with saves, concentration, morale and `lastingOnSheets` run per turn, plus `runMonsters` to the next hero. `fightRound` is rebuilt on it, so rounds mode still passes every existing test. End-of-turn condition saves. Moment candidates. No API change. | "Heroes go before monsters on a full tie", "A condition … end of the hero's own turn", "Foes may break in the middle of a round", "After ten rounds the foes flee" (rounds mode too) | M |
| **1b. The Help action** | `common:help` in `play/legal.ts` with ally and ally-against-foe targets (and stabilize for a dying ally), `CombatState.helps` with use and lapse in `rules/scene.ts` and the attack and check resolvers, the `helped` marker on `rules.combat.combatants`, the log lines. It works in rounds mode too, so it ships before the API work. `docs/api.md` first. | the Help block, except "Help in your own words names its ally and foe" (phase 6) | S–M |
| **2. The fight API, engine lines only** | Migration (`combat_mode`, `combat_turn`, `combat_log`), both stores, `status: "fighting"`, `GameState.fight`, `POST /turn`, `/roll` with `turn`, `/advance` as skip, the poll's `logSince`/`logUpdates`, the clock and Dodge on expiry, monster `showAt` pacing, the fight as one scene, the end going to `nextScene` with a fight summary. The perception hooks (section 9): the null
`audience` column and `perceives` on every read path. Behind `DD_INITIATIVE`. `docs/api.md` first. `npm run playtest` bots learn `/turn`. | Starting a fight, whose turn, a hero's action, monsters, the clock (not away), leaving the fight, polling, rounds mode | L |
| **3. The app's Fight tab** | `GameSession` reads `fight` and `logSince`. A Fight tab: HUD on top (the other agent's view), the scroll, the turn panel and die, the waiting bar, monster beats by `showAt`, Sheet and Map sending `/turn`. `INITIATIVE_MIN_BUILD`, `MARKETING_VERSION` bump, TestFlight. Needs a Mac: untestable on a cloud agent. | none new (exercises phase 2) | L |
| **4. The DM's beats** | `narrateBeat` in `dm/types.ts`, `llm.ts`, `fake.ts`. `DD_BEAT_MODEL`. The serial background queue per fight, folding, the 8 s drop. `stripHeroSpeech` on beats. `npm run dm:check` gains the beat. The app shows the shimmer and then the line. | "The engine's line comes before…", "…arrives as an update", "A dungeon master who fails…", "A run of monsters is narrated once" | M |
| **5. Moments** | Candidates to the DM, `moment` on the beat, the picture budget (`DD_FIGHT_PICTURES`), painting a moment with the party's portraits (`paintScene`'s cast), `pictureUrl`, summary cards, moment pictures in `Adventure.images`. The app's moment card. | the Moments block | M |
| **6. At the table** | Players throw initiative (never waited for). Away (10 s). The "your turn" push (kind `combat`, 4 s hold). Written actions and speech in the log, and Help in your own words (the classifier returns the target the words name: a `dm/` change, so `dm:check`). "Read the fight" (`GET …/fights/{sceneIndex}`). The dying hero throws their own death save. | initiative throws, away, written actions and speech, "Help in your own words names its ally and foe", "A past fight's log can be read whole" | M |
| **7. On by default** | `DD_INITIATIVE=1` in production once a TestFlight build with phase 3 is in testers' hands. Later, rounds mode removed when no open game uses it. | none | S |

Phases 1 and 2 are server-only and can be done by a cloud agent. Phase 3 needs Xcode. Phases 4
and 5 each need one deliberate `dm:check` (a few cents), which is routine. Turning the flag on in
production (phase 7) changes an environment variable, so it needs the owner's word.

Risks:
- **Rules drift** when saves and morale move to per-turn: phase 1 runs every existing fight test
  against the rebuilt `fightRound` before anything else uses it.
- **Two writers on one turn** (a throw and a timeout): handled by the compare-and-set on
  `combat_turn`, with a feature for it.
- **Beat cost on a chatty fight**: bounded by one beat per hero action and per monster run, a
  small model, and the folding queue.
- **The HUD and the scroll fighting for space** on small phones: the HUD's one-row mode,
  question 9.

---

## 9. Future: split parties and per-player views

Not part of any phase above. Micah may later want the party split: a hero kidnapped, or one who
wanders off. That hero would see other events, get other DM lines and pictures, and have a HUD
showing only the combatants where they are. The aim now is to leave hooks so that later this is
new code, not a rewrite.

### The idea

A **group** is a set of heroes in one place. Today there is one, implicitly. Later the engine keeps
`party.groups: { [groupId]: { at: string; heroes: string[] } }`, and each combatant carries the
group it stands with. Each log entry gets an `audience`, written by the engine when the entry is
made:

```ts
type Audience =
  | null                                // everyone at the table (all there is today)
  | { groups: string[] }                // the heroes standing in these groups when it happened
  | { players: string[] }               // named players only (a vision, a whisper from the DM)
```

What each player sees is the log filtered by `perceives`. A hero can perceive an entry because
they were in its group when it was written. Being there later does not count: a hero who rejoins
does not suddenly see what happened in a room they were not in. Later the same function could
also weigh senses (a blinded hero only hears the line; an unseen attacker is "something"), still
without changing the log's shape.

### Hooks to leave in place now (in phase 2, at almost no cost)

| Hook | Why it matters later |
| --- | --- |
| `combat_log.audience` jsonb, null for now, never sent to the app | No migration or backfill when groups arrive; old entries read as "everyone". |
| One `perceives(audience, playerId, game)` on every read path: poll, `/turn` and `/roll` responses, past-fight log, pushes, HUD combatants, the DM's `recent` | Splitting becomes one function body, not a hunt through handlers. |
| `seq` may have gaps; `logSince` is a high-water mark | A filtered feed is already a valid feed to the app. |
| `fight` is built per caller | A player in another room can be handed a different fight, or none. |
| The HUD draws the combatants it is given | It shows only the room's combatants with no change to the app. |
| `moment` lives on the entry; `fight.pictureUrl` is the newest *perceived* moment | Each group gets its own pictures and summaries. |
| `combat_log.fight` names the fight; nothing in the API assumes one fight per game | Two groups can fight at once later. |
| The beat call takes the entries it narrates and their audience | The DM can be asked to narrate for a group, in that group's knowledge. |

The only new rule this puts on phase 2 and 3 code is to call the gate and not assume everyone
sees the same log. The features pin it with one scenario ("While the party is together every
player perceives every entry").

### What it would cost later

| Piece | Work | Size |
| --- | --- | --- |
| Groups in the engine: who is where, splitting (kidnap, wander off), rejoining | `PartyState.groups`, hooks for "split" and "rejoin", the dungeon's `at` per group | M |
| Audience on entries, and `perceives` doing real filtering | Engine writes the group with each entry; the gate checks membership at write time | S |
| More than one fight at once | `games.combat` becomes a map by fight id, `combat_turn` per fight, a clock per fight; the turn and roll endpoints name the fight | M |
| Per-group DM beats and pictures | One beat queue per fight (already per fight); moments and the picture budget per group. Cost grows with the number of groups that are active | S, plus running cost |
| **Out of combat: per-group scenes** | Today's scene, vote and choice-window flow is shared by the whole table. Each group would need its own scene, votes and DM call, and a way to cut between them | L–XL, the real cost |
| The app | A "you are with…" line, a feed for each group the player is in, and a way to read the rest of the table after they rejoin | M |
| Chat | A group channel next to the whole table; whispers already exist | S |

The combat half is cheap because of the hooks above. The expensive half is outside combat: the
scene and vote flow assumes one table and one scene, and that is the part to design properly
if Micah asks for it.
