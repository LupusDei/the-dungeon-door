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
