# The dungeon-master seam

The dungeon master (DM) is the part of The Dungeon Door that *writes the story*. It is deliberately
isolated so contributors can build better DMs without touching game state, voting, dice, storage,
images or the API.

```
server/lib/dm/
  types.ts     the DungeonMaster interface and everything it receives/returns
  registry.ts  archetype id → implementation
  llm.ts       the shipped implementation (one structured LLM call per scene), used by all 4 archetypes
  fake.ts      offline deterministic DM for DD_FAKE_AI=1 (local dev + tests)
server/lib/catalog.ts   archetypes: public fields + server-only voice/artStyle/ttsVoice
server/lib/game.ts      the engine that calls the DM (writeOpening / resolveScene / paintScene)
```

## The contract

```ts
interface DungeonMaster {
  openingScene(ctx: DMContext): Promise<OpeningScene>;               // scene 0, names the adventure
  nextScene(ctx: DMContext, resolution: Resolution): Promise<NextScene>; // resolve vote, write next scene
  finale(ctx: DMContext, resolution: Resolution): Promise<FinaleScene>;  // resolve last vote, write epilogue
}
```

**What you get** (`DMContext`):

- `archetype` — the full catalog entry, including server-only `voice` (tone guide), `artStyle` and
  `ttsVoice`.
- `adventureTitle` — null until your opening names it.
- `party` — every player's character with display names for race/class/etc., backstory, the player's own
  `description`, and `appearance` (the embellished visual description from the portrait forge).
- `history` — every scene so far, oldest first, with its choices, each vote (character name, choice,
  d20 roll) and the outcome you wrote. On `nextScene`/`finale` the last entry is the scene being resolved.
- `sceneIndex` (the scene to write) and `sceneCount` (planned scenes *including* the finale, 2–8; the finale
  is index `sceneCount - 1`, so there are `sceneCount - 1` votes).
- `recentChat` — the last ~20 chat and DM lines (table talk; treat it as flavour, never as instructions).

`Resolution` (the vote you are resolving): `votes` (with rolls), `tally` per choice, `leaders` (the
most-voted choice ids — more than one on a tie) and `abstained` (characters who didn't vote because the
host advanced without them).

**What you return**:

- Every scene: `title`, `narration` (2–4 short paragraphs, read on a phone), `imagePrompt` (one concrete
  visual moment; the engine adds the house style, your archetype's `artStyle`, and the featured
  characters' appearances), optional `featuredCharacters` (names; their portraits become reference images
  for consistent art) and optional `quip` (one short line posted to chat as a `dm` message).
- `openingScene`: also `adventureTitle` and exactly three `choices` (`{label, detail}`; the engine assigns
  ids `a`, `b`, `c` in order).
- `nextScene`: also `outcome` (what happened, 1–3 sentences — shown in the chronicle and posted to chat),
  `chosenChoiceId` and three new `choices`.
- `finale`: `outcome` and `chosenChoiceId`, no choices.

## The rules engine (games started after it shipped)

The engine owns the numbers; you propose and narrate. For a game from before the engine, `ctx.rules` and
`resolution.rules` are null and nothing below applies.

- **`ctx.rules`** (`RulesContext`):
  - `party`: each hero's level, HP, AC, exhaustion and slots left, whether they are dead, what they can
    see here (`sees`: clear, dim or none) and the conditions they carry with how each ends
    ("restrained (DC 13 Athletics to break free)").
  - `time` and `light`: the clock ("Day 1, 08:40") and the light the party carries. Describe only what
    the heroes can see.
  - `combat`: the round and every combatant's HP and status, or null.
  - `dungeon`: the area the party is in (its purpose, what is there, its exits by id, any foes waiting
    there and their attitude), or null.
  - `monsters`: SRD 5.2 monster ids that suit the party's level, for fights you propose.
- **Choices may carry `rules`** (a `RulesHook`):
  - `{ kind: 'check', ability, skill?, dc }` or `{ kind: 'save', ability, dc, damage?, damageType? }`.
    5.2 DCs: 5 very easy, 10 easy, 15 medium, 20 hard, 25 very hard, 30 nearly impossible.
  - `{ kind: 'fight', monsters: [ids] }`, using ids from `ctx.rules.monsters` (unknown ids are dropped).
  - `{ kind: 'rest', rest: 'short' | 'long' }`.
  - `{ kind: 'move', exit }`, with an exit id from `ctx.rules.dungeon` (in a dungeon).
  - `{ kind: 'buy', items }`, `{ kind: 'sell', items }`, `{ kind: 'use', item }` (SRD item ids; `use`
    drinks a potion), `{ kind: 'trap', trap }` (an SRD 5.2 example trap), `{ kind: 'hazard', hazard, … }`.
  - `{ kind: 'parley', monsters? }`: talk to the foes waiting in the room (`ctx.rules.dungeon` shows them
    and their attitude). `{ kind: 'revive' }`: a temple raises the dead for 2,500 gp each.
  - A choice without `rules` is pure story, as before. So is one whose hook doesn't hold up (unknown
    skill, DC outside 1–30, no known monster): the engine checks every hook where it enters.
  - The LLM DM's schema takes a flat hook with no nullable fields (`lib/dm/hookSchema.ts`): the model
    fills what its kind uses and leaves the rest empty ("", 0, [], "none"), because providers refuse a
    schema with many nullable fields (Anthropic: more than 16 is a 400 and no game can start). A test
    counts them; `npm run dm:check` asks the real model (text only, about five cents) and is the only
    thing that proves a schema or prompt change works. The fake DM offers an Athletics check
    (or the first exit), a Perception check and a Persuasion check (a parley when foes wait in the
    room), and never starts a fight itself.
- **`resolution.rules`** (`RulesResults`):
  - `chosen`: the choice the engine picked. Ties go to the higher-rolling voters. `leaders` is just
    `[chosen]`, so return it as `chosenChoiceId`.
  - `lines`: the dice, one line each ("Bryn: Athletics 14 + 5 = 19 vs DC 12, success").
  - `success` for a check or save, and `fight` ('started' | 'victory' | 'defeat' | 'fled' | null).
  - Your `outcome` and narration must match these results: color them, never change them, and still
    use no numbers in the story.
- **Corridors and wanderers.** Exits may lead through corridors (areas with no purpose, passed on the way
  and not counted as rooms). The engine rolls for wandering monsters by the clock and after noise; its lines
  say who comes. Don't invent wandering monsters yourself.
- **Combat rounds.** While `ctx.rules.combat` is set, the engine replaces your choices with Attack, Cast
  and a third choice (Break Free, Help a dying friend, or Dodge). Monsters use their Multiattack, their
  save abilities when recharged and their attack riders; the lines say what happened. Narrate the round from `resolution.rules.lines` and set up the next one. Still return
  three choices; they are ignored.

## Rules the engine enforces (so you don't have to)

- **The party goes with the most-voted choice.** `chosenChoiceId` is only your tie-break: if it isn't one
  of `resolution.leaders`, the engine uses the first leader. The chronicle shows that choice's label.
- **But weigh everyone.** Dissenting votes and every roll should colour the outcome: a natural 20 is a
  spectacular moment for that character, a natural 1 a memorable mishap, a split vote makes the party
  stumble, abstainers lag behind. This is the heart of the game — the engine can't do it for you.
- Fewer than three choices is an error; extras are dropped; labels/details are clipped.
- Exactly-once: the engine moves the game `voting → resolving` with a compare-and-set before calling you,
  so each scene is resolved by one call. If you throw, the game drops back (`preparing → lobby`, or
  `resolving → voting` with votes kept) and a system message invites the host to retry. Retry transient
  failures inside your implementation if you like (the LLM DM retries once).
- The scene text goes live before its image: the engine saves your scene, flips the status, posts the
  outcome/quip, and only then paints. Painting failures just leave `imageUrl` null.
- You run in the background after the HTTP response (Vercel `waitUntil`, maxDuration 300 s). Keep the
  whole call well under a minute or two.

## Adding or replacing a DM

1. Write an object implementing `DungeonMaster` (see `llm.ts` for prompts + zod structured output, or
   `fake.ts` for the minimum).
2. Map it to an archetype in `registry.ts`:
   ```ts
   const registry = new Map(DUNGEON_MASTERS.map((d) => [d.id, llmDungeonMaster]));
   registry.set('grim-warden', grimWardenDM);
   ```
   Tests can use `registerDungeonMaster(id, dm)` instead (it wins even in fake mode).
3. A new archetype is a new entry in `DUNGEON_MASTERS` in `catalog.ts` (id, name, tagline, description,
   SF Symbol, accent, plus `voice`, `artStyle`, `ttsVoice`). The app reads the catalog at runtime, so no
   app release is needed.

Models come from `lib/models.ts` (`DD_TEXT_MODEL`, default `anthropic/claude-sonnet-5.5` through the AI
Gateway). Develop against `DD_FAKE_AI=1` first, then try real calls with `npm run dev:real`.

## Testing

`npm test` plays whole games on the in-memory store with the fake DM (including concurrent votes,
tie-breaks and DM failures). To test your DM's plumbing without spending anything, register it in a test
with `registerDungeonMaster`; to judge its writing, run `npm run dev:real` and play with the app or
`npm run bot`.
