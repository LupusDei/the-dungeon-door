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
5. The DM narrates it. It can colour the result, but it cannot change the numbers, and it cannot play the
   heroes. The heroes belong to the players: the narrator does not put words in their mouths, decide their
   feelings, attitudes or choices, or narrate actions they did not take. It describes the world, the NPCs,
   the monsters and the immediate physical result of the chosen action, then hands the moment back. Whimsical
   detail of places and items is part of the world. A player may speak or act in character
   (`POST /api/games/{code}/speak`) with no roll and no adjudication; the line is kept on the turn, and the
   next narration answers it. Quoted hero speech the player did not write is stripped.

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
  spellcasting modifier. Magic Missile's darts (read from its text: three of 1d4 + 1 force, one more per
  slot level above 1st) never miss: each rolls its own damage, and darts may share a target. In a
  fight the hero's Cast sends one at each foe it would drop on average, most wounded first, and the rest
  at the most wounded (`splitDarts`). Darts and beams strike in turn: one whose foe has already fallen
  in the cast goes on to the most wounded foe still up, or nowhere if none is (it is not listed). A
  monster dies at 0 HP and never makes death saves; damage to the dead does nothing. A new wizard or sorcerer prepares it first. A spell with no
  attack, save, darts or healing (Bless) changes nothing; the DM
  narrates it. Targets are passed in; `targetsInRadius` picks them for spheres, cylinders and
  emanations on a 5-foot grid (diagonals 5 ft). Cones, cubes and lines are placed by whoever casts.
- **Deferred:** the multiclass spellcaster table (the sheet is single-class); upcast dice of a
  different die than the base (Ice Knife's cold burst); Scorching Ray's extra rays by slot level; conditions a failed save imposes (reported, applied by the DM); ritual casting;
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
  of speed, and level 6 is death. `d20Modifier` adds it to the revival penalty (Raise Dead's -4), and
  every D20 Test applies it: checks, saves, hazards, and in combat the hero's attacks, saves and initiative.
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

Phase 3 (below) wired in checks and skills, goods, traps and hazards, morale, death and revival.

## Phase 3: checks, goods, traps, morale, death

All SRD 5.2 unless marked **original** (our own rules, CC0, for what 5.2 leaves to the DM).

- **Checks and skills** (`rules/checks.ts`, `play/checks.ts`). Proficiency, Expertise, Advantage and
  Disadvantage, tools (the proficiency bonus, or Advantage if also proficient in the skill), passive
  Perception and Insight. 5.2 has no contests: a check against a creature uses its passive score (Stealth
  and Sleight of Hand against passive Perception, Perception and Investigation against 10 + Stealth,
  Insight against 10 + Deception) or the Influence DC, max(15, INT). Help: a proficient helper gives
  Advantage (`mode: "best"`). Group checks: half must succeed.
- **Goods** (`rules/items.ts`, `rules/inventory.ts`, `play/trade.ts`). SRD items and prices, starting
  gear, coins as gold, carrying capacity by size (Str × 7.5 Tiny, × 15 Small or Medium, × 30 Large, × 60 Huge, × 120 Gargantuan; over it
  Speed is 5 ft, up to twice it the hero can drag), buying at SRD prices, selling gear at half and treasure
  at full value, potions (2d4+2, 4d4+4, 8d4+8, 10d4+20). Pack weights come from the SRD's table (the JSON
  disagrees for several packs). Treasure goes into the packs.
- **Traps and hazards** (`rules/traps.ts`, `rules/hazards.ts`, `play/traps.ts`). The SRD 5.2 example
  traps, scaled by tier, found with passive Perception or Investigation, disarmed with thieves' tools,
  or sprung. Hazards: falling, burning, suffocation, extreme cold and heat, dehydration, malnutrition.
  Old 5.1 trap ids in stored dungeons map to their 5.2 counterparts. **Original**: the dungeon's hazard
  placements (a 10–120 ft drop by tier, a jet of burning oil, a flooded passage, a parched crawl).
- **Attitude, parley, and running** (`play/parley.ts`, `play/turn.ts`, **original**). Foes met in a room
  roll 2d6: 2–5 Hostile, 6–9 Indifferent, 10–12 Friendly. Undead, constructs and oozes are always Hostile.
  **They do not attack at once.** Hostile foes bar the way, and the party votes Engage, Run or Parley.
  Run, before initiative, backs out the way the party came; the room stays uncleared, with no loot and no
  XP. Wanderers who are Hostile wait for the same choice, and Run slips past them. A parley is a
  Persuasion check (the Influence DC of the foe hardest to sway, the best talker with Help; Advantage if
  Friendly, Disadvantage if Hostile). Success clears the room without its treasure (wanderers simply let
  the party be). Failure worsens the attitude a step. A band that turns Hostile bars the way for the same
  vote. Outside a dungeon, a parley the DM names starts Indifferent, and a failure that turns them Hostile
  does start the fight: there is nowhere to back out to.
- **Morale** (`play/morale.ts`, **original**). A band is shaken by its first death, by falling to half its
  total HP, or by its leader (most XP) going down, each only as it happens; it rolls d20 + its best WIS
  save vs DC 10. Below: it flees, and each standing hero with a melee weapon makes an Opportunity Attack
  (5.2) on the most wounded; failing by 5 or more, it surrenders (a victory, full XP). No check while any
  fearless foe (undead, construct, ooze) stands. Fleeing foes leave the XP of the slain only.
- **Area spells** (`rules/spellEffects.ts areaCatch`, **original** rule of thumb for play without a grid):
  1 + radius/5 foes for a sphere, cylinder or emanation, 1 + size/10 for a cone or cube, 1 + length/30
  for a line; the most wounded first. Damage is rolled once and each target saves. A fight that tracks
  range bands (below) catches by band instead.
- **Potions in combat.** Drinking a potion is a Bonus Action (5.2): a hero at half HP or less drinks the
  least of its healing potions before its action. (Phase 4: a fighter with Second Wind left uses that
  Bonus Action instead, 1d10 + Fighter level; one Bonus Action a turn.)
- **Death and dying** (`rules/dying.ts`, `play/dying.ts`). Massive damage kills outright; at 0 HP a hero
  is dying. Outside a fight, and when a fight ends, the dying are settled at once: Spare the Dying or a
  Healer's Kit stabilizes, else the best healer tries DC 10 Medicine (up to three tries, Help), with a
  death save after each failure; a stable hero wakes with 1 HP after 1d4 hours. The dead stay dead
  (`sheet.dead`): they sit out fights, checks and rests, go home dead, and cannot start or join a game.
- **Revival** (`rules/revive.ts`, `play/revive.ts`). Revivify (3rd level, 300 gp diamond, within a
  minute) is cast the moment a hero dies if a standing party caster can and someone has the gold. Raise
  Dead (5th level, 500 gp diamond; -4 on D20 Tests, -1 per Long Rest) comes from a party caster or a
  temple (2,000 gp service + diamond) through the revive hook, or between games through
  `POST /api/characters/revive`.

Phase 3's simplifications (no resistances, no conditions outside combat, no Disengage, no clock for the
revival windows) are lifted in Phase 4. Diamonds are still paid in gold rather than carried.

## Phase 4: time, light, corridors, conditions, the rest of combat

All SRD 5.2 unless marked **original**. Every new piece of state is an optional JSON field on the party or
the sheet, so games and characters stored before Phase 4 load unchanged (no migration).

- **The clock** (`play/time.ts`, `party.clock`, seconds from 08:00 on day 1). A choice takes ten minutes
  (**original**), a short rest an hour, a long rest eight, a fight six seconds a round. Time ends timed
  conditions, burns the light and brings the mornings.
- **Light and sight** (`rules/light.ts`). Torch (1 hour), lamp and lantern (6 hours of oil), candle, the
  Light cantrip. Where the party's place is not bright, the standing hero with the best light lights it
  before the turn's action, and the next when it burns out. A dungeon's entrance is dim, its rooms and
  corridors dark (**original** placement); outdoors follows the hour. Each hero's sight follows from the
  light and darkvision: dim gives Disadvantage on Perception; none fails Perception and Investigation and
  Blinds the hero in a fight. Monsters see by their own senses (darkvision, blindsight…) and are Blinded
  when they can't.
- **Packs** (`rules/inventory.ts unpacked`). Starting packs are opened into their contents (on new parties,
  on stored games as they are read, and when a pack is bought), so torches, oil and rations are usable.
- **Corridors** (`rules/corridors.ts`, **original** tables). Some ways between rooms become a passage,
  winding passage, junction or short stair (d12). Corridors are areas, not rooms: they don't count against
  the room total, hold no encounter or treasure, may hold a trap or hazard or a wanderer's spoor (d20),
  and are passed in the same move. They are rolled from the seed and the two rooms, so the rooms come out
  as they would without corridors. Explore mode rolls them as doors open.
- **Wandering monsters** (`play/wandering.ts`, **original** odds on the 5.2 encounter budget). In a
  dungeon, a d6 every half hour of the clock (a 1), and at once after noise (a fight, a sprung trap: 1–2).
  Wanderers roll an attitude like any foes.
- **Food and water** (`play/provisions.ts`). Each morning every hero eats a Ration or goes hungry (5.2
  malnutrition), and without a Waterskin suffers dehydration. A Waterskin is never emptied (simplified).
- **Conditions with durations** (`rules/conditions.ts`, `sheet.conditions`). A condition carries how it
  ends: after a time, at a long rest, by a save at the end of each of the hero's turns, or by an escape
  check (Restrained by a web, Grappled). Outside a fight an escape is tried free each turn; in a fight it
  is the hero's action (Break Free).
- **Resistances** (`rules/defenses.ts`). Species traits (dwarven poison resilience and the like) halve
  damage of their types, from attacks, spells, traps and hazards; a hero resisting Cold (Fire) endures
  extreme cold (heat) without a save.
- **Concentration** (`play/concentration.ts`). A CON save each time the hero is hit (DC 10 or half the
  damage); the spell ends on a failure, at 0 HP, when Incapacitated, or when the fight ends.
- **Multiattack and Extra Attack** (`rules/monsters.ts multiattackOf`). A monster makes each attack its
  Multiattack lists, padded to the count its text states with its first attack (some SRD entries list
  fewer than the text says); a hydra attacks once per head. Extra Attack, Two and Three Extra Attacks give
  heroes their swings. Follow-up attacks go to the most wounded foe still up.
- **Save abilities** (`rules/powers.ts`). Breath weapons, gazes and the like: Recharge X–6 rolled at the
  start of the monster's turn, "X/Day" as once per fight (simplified), at-will ones only for monsters with
  no attacks. The area catches heroes like an area spell; each saves, half on success where the text says,
  and a lasting effect becomes a timed condition.
- **Attack riders** (`riderOf`). A hit that forces a save or grapples ("DC 10 CON save or Paralyzed")
  applies its condition the same way. Creature-type and size limits are ignored; Grappled has no
  mechanical effect beyond needing to Break Free (simplified).
- **The third choice** (`play/actions.ts`, **original** for a three-slot vote): Break Free when held,
  Help to stabilize a dying friend (a Healer's Kit, or DC 10 Medicine), else Dodge.
- **Freeform turns** (`play/actions.ts`, **original**). A player may write their own action. The DM
  classifies the words and never names a number. See "Freeform turns" below.
- **Fleeing and targeting.** A monster with Disengage as a Bonus Action (goblins) flees without
  Opportunity Attacks. Monsters prefer heroes who aren't Dodging. Heroes aim past foes immune to their
  damage type (the most wounded foe they can hurt, else the most wounded); an area spell catches those it
  can hurt first.
- **Revival windows.** Revivify is always within its minute (a fight lasts at most ten rounds). Raise Dead
  reaches only heroes dead 10 days or less by the clock (`sheet.diedAt`); the between-games temple keeps no
  clock, so it has no window.
- **Stored 5.1 trap ids** in old dungeons are mapped to their 5.2 ids when a game is loaded.

Still simplified: legendary actions and legendary resistance; Hide, Ready and Search as combat
actions; rider creature-type and size limits; subspecies resistances (tiefling legacies, dragonborn
ancestry) until the sheet records the subspecies; overland travel pace. Dash is a combat move (range bands).

## Freeform turns

**Original.** A player may write what they do ("I kick the brazier onto the goblins") instead of picking
one of the three choices, in a fight or out of one. The dungeon master only classifies the words. The
engine owns every number.

The classification is one of three:

- **A known action.** It maps onto an id from this hero's legal actions (scene.actions): a weapon, a
  spell, a common action such as Dodge, or one of the three choices (choice:a and so on). knownActionIds
  is those available ids. choiceFor is the only place an id becomes a choice letter (an attack is a, a
  spell is b, anything else known is c). An id that needs a target is stored as the letter: the
  classification does not name who. TODO: pass a target the words name. A later kind (a move) has no
  letter until choiceFor learns it.
- **A check.** An ability, or a skill, a tier, and an effect category. Tiers are the 5e ones: easy DC 10,
  medium DC 15, hard DC 20. A natural 20 or 1 is not automatic, same as any other check. The player's d20
  is the one rolled for a vote, and the line is posted with the other dice.
- **Impossible.** The fiction does not allow it. The engine narrates the no (or a fixed line when the
  classification cannot be read, or the narration contains a number). The turn is not spent.

Effect categories, on a successful check:

- **none.** Success is the whole result.
- **damage.** The DM names a severity. The dice are light 1d6, moderate 2d6, severe 4d6, and the type is
  an SRD damage type or bludgeoning. In a fight that damage hits the most wounded foe, the same target an
  Attack would pick, after resistance, immunity and vulnerability. Outside a fight the dice are still
  rolled and logged; there is no creature in the state to mark.
- **condition.** The DM names an SRD condition other than exhaustion, and the ability of the save. The DC
  is the same tier. In a fight the most wounded foe saves; on a failure the condition lands for the fight.
  Outside a fight the line states the save and the DC for the DM to narrate.

A classification the engine cannot read (unknown skill, missing tier, a number where a word belongs) is
treated as impossible, so a bad reply cannot spend the turn or invent a result. The known-action id has
to be one of today's.

## Phase 5: dungeon levels, fights that fit, XP at the quest's end

Robert's design: *"Dungeons start at level one, and all monsters, treasures, and traps should be appropriate
to that level. Every time through a door, there's a chance that the level will increase, and monsters,
traps, and treasures should increase with that level. At the end of a quest, the players should level up
based on their experience points."* He added that the starting level is the party's average level. This
phase also closes the level-1 lethality issue: level-1 parties died in their first fights.

**The dungeon level** (`rules/depth.ts`, `play/delve.ts`):

- A dungeon starts at the **living heroes' average level, rounded down, from 1 to 20**
  (`startingLevel`). A new party of level-1 heroes starts at 1. A party of levels 3 and 6 starts at 4.
  The dead don't count. The map records it as `map.level`.
- **Each door can lead deeper.** Going through a door into an area not seen before rolls a d100. On 25 or
  less (`DEEPER_IN_100`, a 25% chance) the dungeon goes one level deeper. The roll is seeded by the map
  seed and the area (`derivedRng(seed, 'deeper:' + area)`), so it's the same every time. Ways that aren't
  doors (open passages, corridors) and areas already seen don't roll. In explore mode, stairs still add
  a level.
- The level never goes down, and it stops at 20 (`MAX_DUNGEON_LEVEL`). Every change is logged in
  `dungeon.deepened` (`{ at, level }`, oldest first). The table is told "The way leads deeper: dungeon
  level N."
- An area not yet seen, reached at a deeper level, is **restocked** there (`restock`): its encounter is
  rebuilt at the same difficulty and its treasure rerolled. Its kind, name, trap and ways stay the same.
  This is seeded by the area and level.
- In explore mode, a room's difficulty (low, moderate, then high) counts levels below the dungeon's
  starting level, not from 1. A dungeon that starts at 5 starts with low-difficulty fights at level 5.
- A game stored before this phase has no `level`, so it reads as its map's level, or 1.

**Scaled to the level:** monsters, traps and treasure all use the dungeon level, as if each living hero
were at that level (`foeLevels`: n living heroes × the dungeon level).

- *Monsters.* Room encounters, wanderers and the DM's proposed fights are all built for that party.
- *Traps.* Trap DCs and damage use that level.
- *Treasure.* Treasure uses OSE's band for that level, and rare magic items appear from level 4.
- Outside a dungeon, the heroes' own levels are used.

**Fights that fit** (`rules/encounter.ts`, the fix for the lethality issue):

- *Budget.* The SRD 5.2 XP budget is **halved at levels 1–2** (`temperedBudget`). The 5.2 table is
  swingy there: one bad round kills a hero.
- *Fight size.* The number of foes is capped (`foeCap`): half the party (rounded up) at levels 1–2, the
  party's size at 3–4, twice it from level 5, and never more than 8.
- *Variety.* An encounter has at most two kinds of monster.
- *Habitats.* Each dungeon kind has its own monsters (`rules/habitats.ts`, by creature type), with no
  mounts, livestock, sea creatures or townsfolk.
- *DM fights.* A fight the DM proposes is held to a **high** encounter for the party (`capFight`). Its
  monsters are kept in order while they fit the budget and the cap. If none fits, the weakest one is kept.
- *Toughness* (`rateEncounter`, **original** names on the 5.2 budgets). Any list of monsters is rated
  against the party's tempered budget. The fight is low, moderate, high, or **deadly** when its XP is
  above high. One monster is **puny**, **weak**, **even**, **strong** or **deadly**. Puny is strictly
  under half the low budget (`xp * 2 < low`): less than half an easy fight, a nuisance. At half that
  line through the low line the monster is weak, so a foe worth exactly half an easy fight is not
  puny (four level-1 heroes, low budget 100: a goblin at 50 XP is weak, a rat at 10 XP is puny). Even,
  strong and deadly are a moderate fight, a high fight, and anything above high. The fight's band has
  no puny step. The engine shows the words on a fight choice, on a meeting, and on every foe in a
  round. They are always visible. The DM may say them and may not change them. A fight the DM proposes
  is rated after `capFight`; foes the party has already met are rated as they stand.
- *DM suggestions.* The monsters suggested to the DM (`ctx.rules.monsters`) come from the dungeon's
  habitat and fit a moderate fight at its level.
- *Hero builds.* New heroes put their best scores into their class's primary abilities, then
  Constitution. Healers prepare Cure Wounds (or Healing Word). Heroes stored without a sheet keep the old
  build (`'classic'`), so their numbers stay the same.
- *Healing in a fight.* When a friend is dying, a healer's Cast casts its healing spell on them.

**Treasure** is shared in **whole gold pieces among the living heroes**. The coins are counted in gp,
rounded down, and split evenly. The odd pieces go one each to the first living heroes. Dead heroes get no
share. Gems, jewellery and the magic item go to whoever has room.

**XP and levels.** Fights only add XP: the living heroes share it, and nobody levels up during the
quest. When the next scene is the **epilogue** (the last scene, or after a lost fight),
`play/table.ts endQuest` levels up each living hero as far as its XP reaches. It uses the 2024
thresholds (300, 900, 2,700 …), average hit points, the SRD subclass, and +2 to the best score at an
Ability Score Improvement. The lines ("Bryn reaches level 2 (+7 max HP).") go to the chat and into the
DM's resolution for the epilogue. The API shows `rules.levelUps`. Heroes go home with their new level.

**Measured** (`lib/play/lethality.test.ts`, seeded): four new level-1 heroes (fighter, rogue, cleric,
wizard) fight 400 moderate fights from level-1 dungeons of every kind, and pass a test of **at least 75%
won and under 5% of heroes dead per fight**.

- *At 1,000 fights* they win 90%, and 2.6% of heroes die per fight.
- *`npm run fights`* (a mapped dungeon's rooms, the goal room included) gives: four heroes win 91% with
  3% dead; a rogue and a cleric win 93%; a lone fighter wins 91%.
- *Before this phase*, level-1 parties lost most of their first fights. A lone level-1 wizard is still
  fragile (40% won).

Not yet: an XP award for finishing a quest, so leveling up still takes many fights.

## Range bands

**Original** (CC0), now read off the grid. A fight is a map of 5-foot squares (`rules/grid.ts`): a room
is 10 by 8, a road 16 by 6. Distance in feet is 5 times the Chebyshev distance. Each combatant is
**engaged** with the creatures inside the longer melee reach (5 ft, 10 with a Reach weapon, or a
monster's listed reach), **near** (30 ft or less), or **far** (beyond that). Engagement is symmetric.
`position` and `engagedWith` on the combat view are that reading, kept for older apps. `rules/bands.ts`
still judges a fight that has no squares; `play/moves.ts` lists the legal moves, each with the squares
that speed can reach.

- **A move changes one band. Dash changes two and spends the action.** From near, one move engages a foe
  who is near, or steps out to far. From far, one move comes to near, or engages a foe who is also far;
  engaging someone near takes a Dash. Leaving an engaged foe provokes an opportunity attack from each foe
  you leave, unless you Disengage (or, like a goblin, you Disengage as a Bonus Action). A creature dropped
  by that attack does not finish the move.
- **Melee needs engaged.** A ranged weapon or a spell is checked against the feet of the band: within
  normal range as usual, between normal and long at disadvantage, past long range not at all. A ranged
  attack made while engaged has disadvantage. A touch spell needs engaged.
- **Monsters use the same bands.** A melee foe steps in (one band, then the attack; from two bands away it
  spends the turn moving closer). A ranged foe steps out of melee, Disengaging when it can, and shoots.
- **A fight in a room starts with both sides near.** A fight on the road starts **far**: they see each
  other down the track, about 60 feet apart, and a move still closes with a foe in that same band. When
  one side surprises the other, the fight begins in melee.
- **An area catches by band, where its size fits.** A cone, line, emanation or an area of range Self
  reaches from the caster: a 15-foot cone catches the creatures they are engaged with, not the near band.
  Stepping in (one move) and then casting catches that cluster. A sphere, cylinder or cube with a range is
  placed on a foe within that range and catches whoever is within its size of them: a 20-foot fireball
  catches the foe it is centred on and anyone in melee with that foe, not everyone merely near. The old
  count (`areaCatch`) remains only for a stored fight that has no places.

On a hero's turn the one-band step is free with the action, so Attack from near steps in and strikes, and
the choice says so. The same moves are on that hero's action list (`kind` `"move"`), so choosing one spends
the action on the move. A vote may also carry a `move` (`docs/api.md`): one band before the action, or a Dash
instead of it. An illegal move is refused.

## The road from the tavern

Robert's design: *"From the tavern to the door there should be a trek through territory with risk of
bandits, varmints, bands of level 1-2 surface monsters, and wandering vendors. Two scenes before the door
to the dungeon begins."*

`play/trek.ts`. Every game opens on the road: **two scenes**, then the tale as before. A dungeon game
(`fixed` or `explore`) walks to the dungeon door; a tale told (`none`, no dungeon) walks to wherever its
tale begins. The game is two scenes longer than the `sceneCount` asked for (a dungeon's map is still sized
for the count asked for).

- **The road is the party's, not the dungeon's.** It lives in `PartyState.trek` (with where it leads,
  `leadsTo: 'door' | 'tale'`, and any foes met on the current stretch, `facing`), so a game with no dungeon
  state walks it the same way, and the dungeon's own `facing` is only ever its wanderers. Games stored
  while the road lived in `DungeonState` are mended as they are read (`rulesStateOf`): the road, and foes
  met on it, move to the party, leading to the door.

- **The road is rolled when the game starts**, from the game's seed (`derivedRng(seed, 'trek')`): a terrain
  (farm road, forest road, moorland track, hill trails, river valley) and, for each stretch, a d12:

  | d12   | On the stretch | Odds |
  |-------|----------------|------|
  | 1–3   | bandits: Bandit, Scout, Tough, Bandit Captain | 25% |
  | 4–6   | wild beasts: Giant Rat, Jackal, Wolf, Boar, Giant Badger, Giant Wolf Spider, … up to Brown Bear and Giant Boar | 25% |
  | 7–8   | a band of monsters: Goblin Minion, Warrior or Boss, Hobgoblin Warrior, Gnoll Warrior, Worg, Bugbear Warrior | 17% |
  | 9–10  | a wandering vendor | 17% |
  | 11–12 | a quiet stretch | 17% |

  So two of three stretches hold foes. They are a **low** fight for the party (`buildEncounter`, the same
  budget, tempering and party-size cap as a dungeon room), at the levels the dungeon starts at (in a tale
  told, the party's level); the tougher ones only appear for parties that can afford them. Bandits and
  monster bands carry treasure for that level; beasts carry none.
- **A lone hero meets less** (`roadBudget`): half the low budget again, since one hero has no one to share
  the blows or pick them up, and the road comes before the dungeon. At level 1 that is 12 XP: only CR 0
  beasts (a jackal or a hyena). Bandits and monster bands have no one that small, so for a lone traveller
  that stretch is quiet. Groups keep the full low budget. Measured (`npm run playtest`, fixed dungeon,
  under the range-band rules): a lone level-1 wizard dies in 4% of games with the road as it was, with this
  budget, and with a road that has no one on it (1,000 games each): the road adds no measurable deaths.
  Road fights for a lone wizard drop from 0.6 to 0.4 a game (0.2 is the dungeon's own).
- **Foes are met** as in a dungeon room: they roll an attitude (2d6: 2–5 Hostile, about 28%). Hostile ones
  bar the way: Engage, Run (slip past: no fight, no loot, no XP) or Parley. If a parley fails and they are
  still Hostile, they attack: there is no way back on the road. Others watch and wait while the party goes on.
- **A fight** on the road awards XP like any other, and its victors take the stretch's treasure.
- **A wandering vendor** sells a Potion of Healing (50 gp) and four other SRD adventuring gear items of
  25 gp or less, at SRD prices, through the `buy` hook.
- **After each scene** the party goes on by itself (two hours, under the open sky's light) to the next
  stretch, or, after the second, to the dungeon door ("The party reaches the dungeon door.") or where the
  tale begins ("The road ends where the tale begins."). On the road
  there are no exits (`move` is refused), no dungeon wanderers, and no torches needed by day.
- **The DM** sees `trek` (stretch, terrain, what is on it, wares, who waits, and what comes after: more
  road, the dungeon door, or where the tale begins) and no `dungeon` until the door; its instructions say
  to narrate overland travel, with no corridors, rooms or doors, and to open the game on the road.

## Wounds, not hit points

Robert's design: *"The monster's hp should not be explicitly shown. Instead it should show degrees of
incapacity like Bleeding, limping, gasping etc. players should see that they are making progress without
knowing exactly how much."*

`rules/wounds.ts`. A foe's hit points stay in the engine's state; the app and the DM see its **wound**, one
of six rungs of **vigor** by the share of hit points left:

| Vigor | Hit points left | Flesh | Undead | Construct | Ooze |
|-------|-----------------|-------|--------|-----------|------|
| 6 | all | Unhurt | Whole | Intact | Whole |
| 5 | over 3/4 | Scratched | Torn | Scuffed | Rippling |
| 4 | over 1/2 | Bleeding | Gouged | Dented | Seeping |
| 3 | over 1/4 (1/2 or less: Bloodied, as in the 2024 rules) | Bloodied | Crumbling | Cracked | Shrinking |
| 2 | over 1/10 | Staggering | Falling apart | Breaking | Sloughing |
| 1 | any left | Gasping | Coming undone | Failing | Dissolving |
| 0 | none | Dead | Destroyed | Destroyed | Destroyed |

- The API's foe combatants carry `wound` and `vigor` and no `hp`/`maxHp`; heroes keep theirs.
- A round's lines tell a foe's wounds when they change ("Goblin Warrior is bleeding."). Damage rolled on a
  hit is still shown ("hit for 7"), but never what is left.
- The DM's combat block gives the wound word for each foe, and its instructions say to show wounds in the
  story, never hit points.

## For the app (the game layer on top)

What the game adds around the engine so the app can show it (Justin's side; `docs/api.md` has the shapes):

- **Attacks** (`lib/attacks.ts`): every character comes with `attacks`, worked out from its sheet with
  the engine's own numbers: its weapons, then each cantrip and prepared spell a fight can resolve (an
  attack roll or a save). The forge previews a hero with `POST /api/sheet`; `GET /api/reference` serves
  the SRD text behind a sheet's spells, traits, feats, class features, skills and conditions.
- **The hero in a game**: `players[].character` carries the live sheet from the game's party state, so
  the sheet screen shows current HP, slots, level and gear during play.
- **Where everyone stands** (`rules.combat.combatants`): `position` is `engaged`, `near` or `far`, and
  `engagedWith` names who they are in melee with, by id. The battle map will draw this; until then the
  choice text says when a hero will step in ("You move to engage Goblin Warrior").
- **A round written for each player** (`lib/play/your-turn.ts`): the three combat choices say what the
  caller's own hero will do ("Attack with Greatsword", "+5 to hit, 2d6+3 slashing, at Goblin Warrior 2"),
  using the same picks as `play/fight.ts`: an area spell names every foe it will catch, and a hero the
  engine will have use Second Wind or drink a potion first is told so. A hero that is down or dead has no
  action (`scene.canAct`), and a round waits only for the heroes that can act. The third choice differs
  from hero to hero (Dodge, Break Free, Help), so in a round each vote carries the label of its own
  hero's choice (`scene.votes[].label`, `lib/game.ts`), and the app shows that for the others.
- **The hour and the light** (app): a scene shows the clock, the light the party carries and how long it
  has left, and what the caller's own hero can see (`rules.time`, `rules.light`, `party[].sight`); a
  hero's sheet in a game says when they cannot see.
- **Waiting foes and the dead** (app): a room whose foes did not attack, and a room whose foes bar the
  way, shows who they are, how hard they are, and what a parley would do (`rules.dungeon.waiting`, with
  each foe's toughness and the fight's band). A fight choice and each foe in a round show the same
  ratings. A dead hero's page has the temple (`POST
  /api/characters/revive`), listing which of the player's purses can pay; a raised hero's page and sheet
  show the revival penalty.
- **Conditions and the held spell** (app): a scene tells the caller what their own hero carries and how
  each condition ends, and that they are concentrating; a hero's sheet in a game lists the same
  (`party[].conditions`, `party[].concentratingOn`). The dice log marks a monster's power, a recharge, a
  hero breaking free or failing to, and a spell lost.
- **Deeper levels and the quest's end** (app): a scene names the dungeon level once the party has gone
  deeper than where it began (`rules.dungeon.level`, `deepened`), and the finale says who rose a level
  (`rules.levelUps`).
- **The narrator** (`lib/voice.ts`, app): any scene can be read aloud in a voice the player picks from the
  catalog's `narrators`; one reading per scene per voice, made on demand and kept. See
  docs/dungeon-master.md, "The narrator".
- **One picture per fight**: the round that begins a fight is painted; later rounds carry the same
  picture. Paintings are most of what a game costs.
- **A rules error never strands a table** (`lib/game.ts`, `withoutTheEngine`): if the engine throws, the
  scene resolves without it, the chat says so, and the error is logged.

## Measuring it

Two scripts play the engine with bots, for nothing (`server/`):

- `npm run fights` plays the fights a mapped dungeon rolls, straight through `play/fight.ts`, and
  reports won / foes fled / lost and how many heroes died. `--light dark` fights them in an unlit room
  and `--race dwarf` builds the party from another species (who sees in the dark decides a lot).
- `npm run playtest` plays whole games through the API handlers with the fake DM and reports scenes,
  fights, deaths, levels gained and anything that broke. `--dungeon none --fights 2` makes the DM offer
  a fight of two monsters in every scene.

Open problems found this way are on the quest log as issues (bugs and balance), each with a brief:
https://the-dungeon-door.vercel.app/quest-log (filter: Issues), or `quest_list_issues` over MCP.

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
