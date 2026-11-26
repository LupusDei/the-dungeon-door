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
  dungeonTables, dungeon, explore (PR C): fixed room graph or explore-as-you-go, stocking, loot
  leveling (PR D)            XP awards and thresholds, milestones, level-up
  spells, spellEffects (PR E): preparing, casting, slots, concentration; resolving casts
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

As built (PR C): `dungeonTables.ts` (every table, checked to cover its die once at load), `dungeon.ts`
(`stockRoom`, `rollTreasure`, `generateDungeon(seed, size, levels)`), `explore.ts` (`startExplore`,
`expand`, `unexplored`) and `rng.ts`'s `derivedRng(seed, key)` (FNV-1a of `seed/key`). Decisions:

- Fixed maps: the path runs r0 → goal; branches hang off path rooms (off the entrance too on a short
  map, never off the goal); loops are drawn from room pairs not yet linked. The entrance is empty, the
  goal always a high-difficulty monster with treasure, other rooms moderate. A stairs connection on a
  fixed map is a way between rooms on the same level, not a level change.
- Explore mode: an area's id is the path to it (`e.x1.ahead.door`), so its dice depend on where it is,
  not when it was found. Behind a door is a room or a plain passage. Stairs lead one level deeper, and
  room monsters get harder with depth (low, moderate, then high from level 3).
- **The main line never closes.** Off it, dead ends and rooms with no way on are allowed; on the
  main line (the entrance, then each area's first way on), a dead end becomes a passage going on and a
  room has at least one way on. So an explore dungeon can't run out, and the rule depends only on ids.
- Treasure is OSE's band for the level in coins, gems and jewellery counts; a magic item is drawn from
  the SRD 5.2 magic items (common and uncommon, rare from level 4).
- Not yet: wandering monsters, traps' DCs and damage, treasure values for gems and jewellery, and
  marking rooms cleared (the game stores that beside the dungeon).

## Leveling (PR D)

`leveling.ts`, on the same `CharacterSheet` (still version 1; nothing stores sheets yet):

- **XP.** `encounterXp(crs)` sums the SRD CR-to-XP values; `splitXp(total, heroes)` gives each hero an
  equal share (the remainder is lost); `awardXp` adds it. `levelForXp` and `canLevelUp` read the SRD 5.2
  thresholds (300, 900, 2,700 … 355,000).
- **Milestones.** `levelUp(…, { advancement: 'milestone' })` skips the XP check and raises the hero's XP
  to the new level's threshold, so switching back to XP later stays consistent.
- **Hit points.** The sheet keeps one hit die result per level (`hpRolls`; level 1 is the die's
  maximum). A level-up takes the fixed value (die / 2 + 1) or a seeded roll. Max HP is always derived:
  each level adds its roll + CON modifier (+1 Dwarven Toughness), at least 1, so raising CON raises every
  past level too. A wounded hero gains the new hit points but is not healed.
- **Everything else is rederived** by `rederive(sheet)` (also used by `buildCharacter`): proficiency
  bonus by level, saves, skills, passive Perception, AC, spell save DC, attack bonus and slots.
- **Features.** The class's features for the new level, and the subclass's, are appended by name. The
  subclass is chosen at the class's subclass level (3 in SRD 5.2), from the class's SRD subclasses.
- **Improvements.** At an Ability Score Improvement level: +2 to one score or +1 to two (max 20), or a
  general feat the hero qualifies for (Grappler: STR or DEX 13; its +1 to STR or DEX), each feat once.
  At 19, an Epic Boon (its +1 can reach 30; Boon of Spell Recall needs spellcasting) or a general feat.
  A feat's +1 options are read from its SRD text where it enters (`srd.ts`).
- Not yet: new cantrips and prepared spells at higher levels (PR E validates them), class resources
  such as Rage uses (PR F), feats' other benefits, fighting styles, and multiclassing.

## Spellcasting (PR E)

- **Data.** `srd.ts` reads each SRD 5.2 spell's mechanics where the JSON enters: spell attack (melee or
  ranged), the saving throw its text names, half damage on a save, damage dice and type, upcast dice
  per slot level, healing dice, area (shape and size) and concentration. Cantrip upgrades come from
  `cantripScaling.json` (more dice, or Eldritch Blast's beams).
- **On the sheet** (`spells.ts`): `prepareSpells` takes exactly the class's cantrip and prepared counts
  for the hero's level, from its list, no higher than its highest slot level. `castSpell` needs the
  cantrip known or the spell prepared, spends the slot asked for (or the lowest left at or above the
  spell's level), and returns the dice: cantrips by character level (5, 11, 17), upcasting by slot.
  Warlock pact slots need no special case: they are all of the pact level, so that is the lowest
  slot left. `slots` and `expended` live on the sheet; rederive moves spent pact slots up a level when
  the pact slot level rises.
- **Concentration.** One spell at a time: a new concentration spell ends the old (the cast reports
  which). `concentrationCheck` is a CON save at max(10, half the damage), capped at 30, and is lost
  outright if the caster is down.
- **Resolution** (`spellEffects.ts`) reuses PR B's resolver: a spell attack is `attackRoll` with the
  spell attack bonus (one per beam), a save spell rolls its damage once and each target makes
  `savingThrow` (half or nothing on a success, then resistances), healing is rolled once plus the
  spellcasting modifier. A spell with no attack, save or healing (Bless) changes nothing; the DM
  narrates it. Targets are passed in; `targetsInRadius` picks them for spheres, cylinders and
  emanations on a 5-foot grid (diagonals 5 ft). Cones, cubes and lines are placed by whoever casts.
- **Deferred:** the multiclass spellcaster table (the sheet is single-class); upcast dice of a
  different die than the base (Ice Knife's cold burst); extra rays or darts by slot level (Scorching
  Ray, Magic Missile); conditions a failed save imposes (reported, applied by the DM); ritual casting;
  subclass always-prepared spells; concentration ending on incapacitation outside the check.

## Rests and resources (PR F)

- **Class resources** (`resources.ts`): Rage, Bardic Inspiration, Channel Divinity, Wild Shape, Second
  Wind, Action Surge, Focus Points, Lay On Hands, Sorcery Points, Magical Cunning and Arcane Recovery.
  A hero has one once its class has given it the feature. The number of uses comes from the class table
  (`rageCount`, `channelDivinityCharges`, `focusPoints`, `secondWindUses`, `wildShapeUses`,
  `sorceryPoints`) or from the rule: Lay On Hands is 5 × level, Bardic Inspiration is the CHA modifier
  (at least 1), and Action Surge counts how many times the hero has gained it (twice at 17). Uses spent
  live on the sheet as `resourcesUsed`. What a Short Rest gives back comes from each feature's own text:
  one use, all of them, or none. Font of Inspiration changes Bardic Inspiration from none to all. A Long
  Rest restores everything.
- **Short Rest** (`rests.ts`): the hero spends any number of its remaining hit dice (one per level).
  Each die heals its roll plus the CON modifier, at least 1, and HP never goes above the maximum.
  Features recharge as above, and a warlock gets its pact slots back. Arcane Recovery and Magical
  Cunning are separate calls made after it, each once per Long Rest.
- **Long Rest:** full HP, every spent hit die back (SRD 5.2; the 2014 "half" rule is not offered),
  every slot back, concentration ends, every feature recharges, and exhaustion goes down by 1.
- **Exhaustion:** levels 0 to 6, stored on the sheet. Each level gives -2 on every d20 test and -5 feet
  of speed, and level 6 is death. `exhaustionEffects` reports these numbers; the callers apply them.
- **Both rests need at least 1 HP.** The engine doesn't track the rule of one Long Rest per 24 hours or
  interrupted rests, because the game has no clock. The DM decides when a rest happens.

## Integration (done)

Wired in after Justin merged the engine PRs (see docs/api.md and docs/dungeon-master.md):

1. `Character.sheet` is stored. New heroes get an engine-built sheet; heroes saved before the engine get
   one when they are read. Stored `half-orc` heroes become `orc` and `half-elf` heroes become `elf`;
   the player can change race freely while the hero is level 1.
2. Games keep `party`, `combat` and `dungeon` as JSON columns (`db/schema.sql`; run `npm run migrate`
   before deploying).
3. The DM proposes hooks and narrates the engine's results; votes resolve through the engine (checks,
   saves, fights, rests, moves); fights run as rounds; XP and level-ups follow a won fight; the sheets
   go home to the characters when the adventure ends.
4. The API shows `GameState.rules`, `Choice.rules` and `Scene.combat`.

Still to come: area spells hit one target; the trap names come from the SRD 5.1 table (the numbers use
the 5.2 scaling); a fallen hero is not kept dead.

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
