# The rules engine

The Dungeon Door already has a story engine: `lib/game.ts` owns the game, the votes and the d20s, and a
`DungeonMaster` (see [dungeon-master.md](dungeon-master.md)) writes the scenes. This document adds a
*rules engine* beside it, so the numbers behind the story (ability scores, hit points, armour class,
attacks, saving throws, encounters, rooms and treasure) follow D&D 5e (SRD 5.2) instead of the DM's
imagination.

One sentence: **the DM proposes and narrates; the engine owns dice, numbers and state.**

## Boundaries

```
server/lib/rules/            pure TypeScript, no I/O, no clock, no Math.random
  rng.ts                     seeded, serializable randomness
  abilities.ts               scores, modifiers, standard array, point buy, 4d6-drop-lowest
  srd.ts                     the SRD 5.2 tables, parsed and checked once where they enter
  character.ts               character generation: choices -> CharacterSheet
  sheet.ts                   the CharacterSheet type and its stored (JSON) shape
  violation.ts               RuleViolation: a choice the rules forbid
  dice, monsters, combatant, resolve, encounter, scene (PR B): combat
  dungeon/… (PR C)           fixed room graph or explore-as-you-go, stocking, encounters, loot
server/data/srd/             SRD 5.2 (preferred) and 5.1 JSON, plus open-licensed extras
```

- **Pure core.** Every rules function takes plain data in and returns plain data out. Nothing in
  `lib/rules/` reads the store, the network, the environment or the clock. `game.ts` and the API
  handlers are the shell around it.
- **Data enters once.** `srd.ts` imports the bundled JSON and parses only the fields the engine uses,
  with zod. A malformed table fails at load, not in the middle of a fight. Inside the engine the data
  is trusted. The same goes for a stored `CharacterSheet`: `parseCharacterSheet` checks it where it
  comes out of the store or off the wire.
- **Errors.** A choice the rules forbid (a skill the class can't pick, a point-buy over 27, a spell
  off the class list) throws `RuleViolation` with a message a player can read. The API layer turns it
  into a 400, the same way `zodMessage` does today.

## Randomness

Every roll comes from an `Rng` the caller passes in:

```ts
interface Rng {
  die(sides: number): number; // 1..sides
  state(): number;            // a uint32; seededRng(state) resumes exactly here
}
```

- `seededRng(seed)` is mulberry32: fast, tiny, and its whole state is one number, so a combat or a
  dungeon can be stored as JSON and resumed on the next request (Vercel functions are stateless).
- `scriptedRng([faces…])` replays given faces. Tests use it, and so does the vote bridge below: the
  d20 a player already rolled when they voted *is* the die the engine uses.
- Same seed, same choices, same result. A dungeon is a function of its seed and the party.

## State model

| Thing | Shape | Lives in |
| --- | --- | --- |
| Hero profile | today's `Character` (name, race, class, look, portrait) | `characters` table, unchanged |
| Hero rules | `CharacterSheet` (version 1): scores, HP, AC, proficiencies, equipment, spells | proposed: a nullable JSON column `sheet` on the character |
| Combat | `CombatState` (PR B): combatants, initiative order, round, turn, conditions, RNG state | proposed: a nullable JSON column on the game |
| Dungeon | `Dungeon` (PR C): seed, rooms, exits, stocking, which rooms are cleared | proposed: a nullable JSON column on the game |

Everything the engine produces is plain JSON with a `version` field, so a stored value can be read back
and checked, and an old shape can be migrated when it changes. This PR adds the library only. Adding
the column, the API field and the app screen is a contract change, so it starts in `docs/api.md` in
its own PR (see Integration).

## How the DM and the engine work together

Today a scene is: the DM writes narration and three choices, everyone votes, the server rolls each
voter a d20, the most-voted choice wins, and the DM writes what happened, weighing the rolls by feel.

With the engine, a choice can carry a **rules hook**:

```ts
type RulesHook =
  | { kind: 'check'; ability: Ability; skill?: SkillId; dc: number }     // climb the wall, DC 12 Athletics
  | { kind: 'save'; ability: Ability; dc: number }                       // the floor gives way, DC 13 DEX
  | { kind: 'attack'; targetId: string }                                 // in a combat scene
```

1. The DM proposes the hook with the choice (or the engine generates combat choices itself).
2. Players vote as they do now. The server still rolls the d20 on the first vote and keeps it.
3. On resolve, the engine turns each relevant vote into a roll: **the voter's d20 + that character's
   bonus** against the DC or the target's AC. A natural 20 always succeeds (and an attack crits); a
   natural 1 always fails. Advantage or disadvantage draws one more d20 from the game's seeded `Rng`.
4. The engine applies the result to state (damage, conditions, HP, death saves, XP) and hands the DM
   a structured summary in `Resolution`, for example "Bryn: 17 + 5 = 22 vs AC 15, hit, 9 slashing,
   goblin down".
5. The DM narrates it. It can colour the result, but it cannot change the numbers.

**Exploration scenes** keep the current rule: the party goes with the most-voted choice, and every
voter's roll still counts (a check is made by each voter; the DM narrates successes and failures).

**Combat scenes** are different (PR B): each player's vote is *their own character's action* on
their turn, not a party decision. The engine offers the choices from the character sheet (attack with
a weapon, cast a known spell, dodge, help, flee) and the monsters act by simple rules. A round ends
when every living combatant has acted. This is the one place the voting flow changes meaning, and it
is worth Justin's review.

## Character generation (this PR)

`buildCharacter(choices, rng)` follows SRD 5.2:

1. **Class**, **species** (size, speed, traits) and **background**.
2. **Ability scores** by one of three methods: the standard array (15, 14, 13, 12, 10, 8) assigned in
   any order; point buy (27 points, scores 8–15, costs from `abilityScorePointCosts.json`); or 4d6
   drop the lowest, six times, from the seeded `Rng`, then assigned.
3. **Background increases** (5.2): +2 and +1 to two of the background's three abilities, or +1 to all
   three. No score above 20.
4. **Level-1 numbers**: proficiency bonus +2; HP = the class hit die + CON modifier (+1 for Dwarven
   Toughness), at least 1; saving throws from the class.
5. **Skills**: the background's two skills plus the class's choices (no repeats).
6. **Equipment**: the class's option A/B(/C) and the background's option A/B, or their gold.
   AC is the best the character can wear with proficiency: body armour (light, medium with max +2
   DEX, heavy), a shield, or Unarmored Defense (Barbarian 10 + DEX + CON, Monk 10 + DEX + WIS).
7. **Spells**: casters get their level-1 slots, the right number of cantrips and prepared spells from
   their class list, a spell save DC (8 + proficiency + ability modifier) and spell attack bonus.

`quickChoices(rng, …)` makes a full legal set of choices at random, for "roll me a hero" or for the DM
to stat an NPC.

Not modelled yet, listed on the sheet by name only: species traits beyond size, speed, darkvision and
Dwarven Toughness; the background's origin feat; subclasses; levels above 1; tool and instrument
choices nested inside equipment options (kept as `pendingChoices`).

## Combat (PR B)

- `rollDice("2d6+3")`, initiative (d20 + DEX, ties by DEX then seed), turn order, rounds.
- Attack rolls with advantage and disadvantage, crits doubling the damage dice, cover (+2/+5, total
  cover blocks), damage with resistance, vulnerability and immunity, saving throws against a spell
  save DC, the SRD conditions as data with their effects on rolls, death saves, and the action economy
  (action, bonus action, reaction, movement) per turn.
- Monsters load from `monsters.json` into the same combatant shape as heroes.
- Encounters use the SRD 5.2 XP budget per character level (low, moderate, high) and the CR-to-XP
  table.
- A scene state machine: `startCombat → round(turn…) → victory | defeat`, where each player vote
  resolves as a roll as above (`playRound(state, votes)`).

As built (PR B): `dice.ts`, `monsters.ts`, `combatant.ts`, `resolve.ts`, `encounter.ts`, `scene.ts`.
Simplifications, for later: one action per turn (bonus actions, reactions and movement are not
modelled), conditions have no durations, monsters use attack-roll actions only (breath weapons and
other save-based actions are left to the DM), Multiattack is one attack, fleeing is not an action
yet, and spells are not yet castable in combat (the sheet has the DC and attack bonus they will use).

## Dungeons (PR C)

Two modes share one room model, one stocking procedure and one encounter builder.

**Fixed map.** A seeded room graph of 5, 7 or 9 rooms following `extras/dungeonGenerator.json`
(entrance, a goal room, side branches, at least one loop on larger maps), generated all at once.
Good for a short session with a known ending.

**Explore as you go.** A dungeon of unlimited size that grows only where the party goes, in the
spirit of the classic random-dungeon procedure (roll the passage ahead, then the room, then what is
in it). The tables are original, in a new CC0 file `extras/exploreGenerator.json`; they borrow the
procedure's mechanics only, not the wording or the numbers of any published table.

- The dungeon starts as an entrance node with unexplored exits.
- `expand(dungeon, nodeId, exitId)` rolls what lies beyond that exit: the passage continues, a door,
  a side passage, a turn, a chamber or room, stairs, or a dead end. A room then gets its size and its
  exits, and its contents.
- Each node's dice come from an `Rng` derived from the dungeon seed and the node's id
  (`seed + "/" + nodeId`, hashed). The same seed and the same exploration choices always give the
  same dungeon, whatever order the party explores in, and expanding an exit twice changes nothing
  (idempotent).
- The whole dungeon is plain JSON: seed, nodes, edges, and which exits are still unexplored.

**Stocking**, in both modes, follows the OSE style (`extras/oseDungeonStocking.json`): monster,
trap, special or empty, each with or without treasure. Monster rooms get encounters from PR B's
builder, sized to the party's levels and the dungeon depth. Treasure comes from the SRD magic items
and the starting-wealth tables.

Either way the DM gets a room at a time to narrate, and the game stores which rooms are explored and
cleared.

## Integration (later, contract first)

These are proposals, kept out of the engine PRs so Justin's flow stays as it is until he picks them up:

1. `docs/api.md`: `Character.sheet: CharacterSheet | null`; `PUT /api/characters` accepts build
   choices and stores the sheet the engine returns.
2. The forge's race list and SRD 5.2 species differ: the catalog has Half-Elf and Half-Orc, the SRD
   has Goliath and Orc. A mapping (Half-Orc → Orc, Half-Elf → Human or Elf) or a catalog change is
   Justin's call.
3. `PartyMember` gains the numbers the DM needs to narrate fairly (HP, AC, conditions).
4. `Choice` gains an optional `RulesHook`; `Resolution` gains the engine's roll results.

## Glossary

- **Ability**: one of STR, DEX, CON, INT, WIS, CHA. **Modifier**: floor((score − 10) / 2).
- **Proficiency bonus**: +2 at level 1, added to rolls the character is proficient in.
- **DC**: difficulty class, the number a check or save must meet or beat.
- **AC**: armour class, the number an attack roll must meet or beat to hit.
- **Check / save / attack**: d20 + modifier (+ proficiency if proficient) against a DC or AC.
- **Natural 20 / 1**: the face on the die before modifiers.
- **Advantage / disadvantage**: roll two d20s and keep the higher / lower.
- **Sheet**: the rules side of a hero (`CharacterSheet`). **Profile**: the story side (`Character`).
- **Rules hook**: the check, save or attack a scene choice asks for.
- **Encounter budget**: the XP of monsters a party of a given level can face at a given difficulty.
