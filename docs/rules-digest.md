# D&D 5e Rules Digest for The Dungeon Door

A compact reference for adding richer rules (ability scores, hit points, inventory, combat, and dungeons) to [The Dungeon Door](https://github.com/LupusDei/the-dungeon-door). Character creation and combat live in the *Player’s Handbook*; random dungeon generation lives in the 2014 *Dungeon Master’s Guide* (Appendix A) and is **not** in the SRD. Mechanics below are taken from the official System Reference Document (SRD 5.2 / 2024 rules, with 2014 / SRD 5.1 differences called out). Dungeon-mapping procedure is summarized from reputable overviews of the 2014 DMG, not copied from the book.

**Copyright.** Do not paste non-SRD book text into the game or its prompts. The SRD is licensed CC-BY-4.0; if you ship SRD rules text, include the attribution at the end of this file.

**Where the books put things**

| Topic | 2014 books | 2024 books | Free rules |
| --- | --- | --- | --- |
| Character creation | *Player’s Handbook* ch. 1–5 | *Player’s Handbook* (“Character Creation,” origins, classes, equipment) | [SRD 5.1](https://media.dndbeyond.com/compendium-images/srd/5.1/SRD_CC_v5.1.pdf) (2014) and [SRD 5.2](https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.pdf) (2024) |
| Combat, checks, rests, conditions | *PHB* “Combat” / “Adventuring” | *PHB* “Playing the Game” + Rules Glossary | Same SRDs |
| Encounter XP budgets | *DMG* ch. 3 (easy / medium / hard / deadly + monster-count multiplier) | *DMG* toolbox; also in SRD 5.2 “Combat Encounters” (low / moderate / high, no multiplier) | SRD 5.2 pp. 202–203 |
| Random dungeon maps and stocking | *DMG* Appendix A (pp. 290–301) plus ch. 5 purpose/location/creator/history tables | No equivalent mapper. Ch. 3 “Dungeon Quirks” (d100) plus sample maps in Appendix B | Not in the SRD |

The Dungeon Door today: a hero is a written description (name, race, class, temperament, alignment, backstory, look) with an AI portrait. Players join by door code. Each scene offers the same three choices; every player votes and the server rolls a d20 for that vote. The party follows the majority choice (the DM only breaks ties). The DM must still weigh dissent, natural 20s, and natural 1s in the narration. Adventures are short (2–8 scenes, including a finale). Stats, HP, and inventory are listed as later work.

---

## 1. Character generation

### Step order

**2024 / SRD 5.2**

1. **Choose a class.** This is the character’s vocation (Barbarian, Bard, Cleric, Druid, Fighter, Monk, Paladin, Ranger, Rogue, Sorcerer, Warlock, or Wizard). Note level (usually 1, 0 XP), the class’s primary ability, armor training, and level 1 features.
2. **Determine origin:** background, species, and languages. A background is formative occupation; a species is ancestry (size, Speed, traits). Every character knows Common plus two other standard languages (rolled or chosen). The SRD 5.2 backgrounds are Acolyte, Criminal, Sage, and Soldier; its species are Dragonborn, Dwarf, Elf, Gnome, Goliath, Halfling, Human, Orc, and Tiefling.
3. **Determine ability scores** (see methods below), assign them to Strength, Dexterity, Constitution, Intelligence, Wisdom, and Charisma, then apply the background’s ability increases.
4. **Choose an alignment** (the nine Lawful/Neutral/Chaotic × Good/Neutral/Evil combinations; most creatures without reason are unaligned).
5. **Fill in details:** class features, saving throws, skills, Passive Perception (`10 + Wisdom (Perception) bonus`), hit points, Initiative (Dexterity modifier), Armor Class, attacks, and spellcasting numbers if any.

**2014 / SRD 5.1** used a slightly different order: **race → class → ability scores → describe the character (name, background, alignment, personality) → equipment.** The mechanical split of “race vs. background” is the important 2014/2024 difference, not the step labels.

### Ability score methods

Generate six numbers, then assign them to the six abilities (put the best scores in the class’s primary abilities).

| Method | How it works |
| --- | --- |
| **Standard array** | Use 15, 14, 13, 12, 10, 8. |
| **Random generation** | Roll 4d6 six times; each time keep the three highest dice and total them. |
| **Point cost (point buy)** | Spend 27 points. Costs: 8=0, 9=1, 10=2, 11=3, 12=4, 13=5, 14=7, 15=9. You cannot buy a score above 15 this way (racial/background increases come after). |

**Ability modifier** is `floor((score − 10) / 2)`. The SRD prints it as a table:

| Score | 3 | 4–5 | 6–7 | 8–9 | 10–11 | 12–13 | 14–15 | 16–17 | 18–19 | 20 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Modifier | −4 | −3 | −2 | −1 | +0 | +1 | +2 | +3 | +4 | +5 |

**2024 background increases (after assignment):** the background lists three abilities. Increase one by +2 and another by +1, or increase all three by +1. None of these increases can raise a score above 20.

SRD 5.2 also prints a suggested standard-array layout per class (highest scores in the class’s main abilities). Examples: Barbarian 15/13/14/10/12/8; Rogue 12/15/13/14/10/8; Wizard 8/12/13/15/14/10.

### Species, background, and class: 2014 vs. 2024

| Piece | 2014 (*PHB* / SRD 5.1) | 2024 (*PHB* / SRD 5.2) |
| --- | --- | --- |
| Ability score increases | Come from **race** (typically +2 and +1, sometimes other patterns). *Tasha’s Cauldron of Everything* later made moving those bonuses optional. | Come from **background**, not species. Species keep size, Speed, and traits only. |
| Background | Skills, tools, a feature, equipment, and personality hooks (traits, ideal, bond, flaw). No ability increases or feat in the 2014 core. | Two skill proficiencies, one tool proficiency, starting equipment, an **Origin feat**, and the ability increases above. |
| Species names | SRD: Dwarf, Elf, Halfling, Human, Dragonborn, Gnome, Half-Elf, Half-Orc, Tiefling. | SRD: Dragonborn, Dwarf, Elf, Gnome, Goliath, Halfling, Human, Orc, Tiefling. Half-Elf and Half-Orc are not distinct SRD species; Goliath and Orc are in. |
| Class list | The same twelve classes. | The same twelve classes. Subclass usually arrives at level 3 (some 2014 classes got a subclass at 1 or 2). |
| Starting at level 1 | 0 XP, Proficiency Bonus +2, one Hit Die, level 1 class features. | Same. |

For a family-friendly app, either edition works. 2024 is a cleaner data model: class drives hit die and features; background drives bonuses and a starter feat; species stays mostly narrative (darkvision, breath weapon, luck, etc.).

### Hit points

**Level 1 maximum** = the class’s Hit Die value + Constitution modifier:

| Classes | Hit Die | Level 1 HP | HP per later level (fixed option) |
| --- | --- | --- | --- |
| Barbarian | d12 | 12 + Con mod | 7 + Con mod |
| Fighter, Paladin, Ranger | d10 | 10 + Con mod | 6 + Con mod |
| Bard, Cleric, Druid, Monk, Rogue, Warlock | d8 | 8 + Con mod | 5 + Con mod |
| Sorcerer, Wizard | d6 | 6 + Con mod | 4 + Con mod |

At each new level you gain another Hit Die. Either roll it and add Constitution modifier (minimum 1 HP), or take the fixed value in the table (the die’s average, rounded up). If Constitution modifier later increases, HP maximum rises by 1 per level already attained.

A character is **Bloodied** while at half HP or fewer (a flag for other effects; no effect by itself). **Temporary Hit Points** are a buffer lost before real HP; they don’t stack, aren’t healing, and don’t wake someone at 0 HP.

### Proficiency Bonus

Characters (and monsters, by Challenge Rating) add Proficiency Bonus to D20 Tests they are trained in (skills, tools, weapon/spell attacks, proficient saving throws) and to spell save DCs (`8 + spellcasting ability modifier + Proficiency Bonus`). It never stacks with itself.

| Level or CR | 1–4 | 5–8 | 9–12 | 13–16 | 17–20 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Bonus | +2 | +3 | +4 | +5 | +6 |

(The SRD table continues +7 / +8 / +9 for CR 21–30, which player characters do not use.)

XP thresholds to reach each level (2024 / SRD 5.2, same familiar 5e curve): 0; 300; 900; 2,700; 6,500; 14,000; 23,000; 34,000; 48,000; 64,000; 85,000; 100,000; 120,000; 140,000; 165,000; 195,000; 225,000; 265,000; 305,000; 355,000.

### Armor Class

Base AC = **10 + Dexterity modifier**. Only one base-AC formula applies (armor, Unarmored Defense, or a spell such as Mage Armor). A Shield adds **+2** if the character has training with it.

| Category | Examples (AC) | Dexterity | Notes |
| --- | --- | --- | --- |
| Light | Padded or Leather 11 + Dex; Studded Leather 12 + Dex | Full Dex | Padded: Stealth Disadvantage |
| Medium | Hide 12, Chain Shirt 13, Scale or Breastplate 14, Half Plate 15 — all + Dex (**max +2**) | Capped | Scale and Half Plate: Stealth Disadvantage |
| Heavy | Ring Mail 14; Chain Mail 16 (Str 13); Splint 17 or Plate 18 (Str 15) | None | Stealth Disadvantage; Strength requirement on the better suits |
| Shield | +2 AC | — | One shield at a time |

Wearing armor without training: Disadvantage on Strength or Dexterity D20 Tests, and you can’t cast spells. Common class alternatives: Barbarian Unarmored Defense (10 + Dex + Con, shield allowed); Monk Unarmored Defense (10 + Dex + Wis).

**Attacks (proficient):** melee bonus = Strength modifier + Proficiency Bonus; ranged = Dexterity modifier + Proficiency Bonus; Finesse weapons may use either. Add the same ability modifier to the weapon’s damage roll.

### Starting equipment

**2024 / SRD 5.2:** both the class and the background grant starting gear. Classes offer package A (and often B or C) — armor and weapons plus an adventuring pack and a few GP — or a flat GP alternative to shop with (for example, Fighter A/B/C or 155 GP; Wizard and similar casters have leaner kits). Spend leftover coins from the Equipment chapter.

**2014 / SRD 5.1:** take the class equipment package **plus** the background’s gear, or roll/take starting gold by class and buy everything (classic values: Monk 5d4 GP; Barbarian or Druid 2d4 × 10; Sorcerer 3d4 × 10; Rogue, Warlock, or Wizard 4d4 × 10; Bard, Cleric, Fighter, Paladin, or Ranger 5d4 × 10).

For a short app adventure, “package A for the class, plus one or two flavor items from the player’s description” is enough.

---

## 2. Combat

These rules are in the *Player’s Handbook* (“Playing the Game” / “Combat” in 2024; “Combat” in 2014). A **round** is about 6 seconds. Everyone gets one **turn** per round, in Initiative order, until one side is defeated, flees, surrenders, or both sides agree to stop.

### Surprise and Initiative

1. The GM places everyone.
2. Everyone rolls **Initiative**: a Dexterity check. Identical monsters can share one roll. The order is high to low and stays fixed. Ties: players decide among characters, GM decides among monsters, GM decides mixed ties.
3. Take turns until the fight ends.

**2024 surprise:** a surprised combatant has **Disadvantage on Initiative**. They still act in the first round if their roll is high enough.

**2014 surprise:** a surprised creature could not move or take actions on its first turn, and could not take reactions until that turn ended. This is one of the larger combat changes.

### Turn structure

On your turn you can **move** up to your Speed and take **one action**, in either order. You may break movement around your action. You may also take **one Bonus Action** if a feature or spell gives you one, and you have **one Reaction** (used on anyone’s turn, then gone until the start of your next turn). You can speak briefly and interact with one object for free; a second object needs the Utilize action (2024) or Use an Object (2014). You may do nothing, or Dodge or Ready if you are unsure.

**Difficult Terrain** costs 1 extra foot per foot moved.

### Actions (2024 / SRD 5.2)

| Action | What it does |
| --- | --- |
| **Attack** | Attack with a weapon or an Unarmed Strike. |
| **Dash** | Gain extra movement equal to your Speed for the rest of the turn. |
| **Disengage** | Your movement doesn’t provoke Opportunity Attacks this turn. |
| **Dodge** | Attack rolls against you have Disadvantage; you make Dexterity saves with Advantage, until the start of your next turn (lost if Incapacitated or Speed 0). |
| **Help** | Help another creature’s check or attack, or administer first aid. |
| **Hide** | Dexterity (Stealth) check. |
| **Influence** | Charisma (Deception, Intimidation, Performance, or Persuasion) or Wisdom (Animal Handling) to change a creature’s attitude. |
| **Magic** | Cast a spell, use a magic item, or use a magical feature. |
| **Ready** | Name a trigger; take a Reaction to act (or move) when it happens. |
| **Search** | Wisdom (Insight, Medicine, Perception, or Survival) check. |
| **Study** | Intelligence (Arcana, History, Investigation, Nature, or Religion) check. |
| **Utilize** | Use a nonmagical object. |

2014’s shorter list was Attack, Cast a Spell, Dash, Disengage, Dodge, Help, Hide, Ready, Search, Use an Object. Influence / Study / a formal Magic action are 2024 packaging; the intent is the same.

### Attack rolls, Advantage, and critical hits

A **D20 Test** is an ability check, saving throw, or attack roll: roll 1d20 + ability modifier + Proficiency Bonus if relevant, plus any circumstantial bonus or penalty. Checks and saves succeed if the total meets or exceeds a **Difficulty Class (DC)**. Attacks succeed if the total meets or exceeds the target’s **Armor Class**.

Typical DCs: Very easy 5, Easy 10, Medium 15, Hard 20, Very hard 25, Nearly impossible 30.

**Advantage / Disadvantage:** roll two d20s and use the higher (Advantage) or lower (Disadvantage). They don’t stack. If both apply, they cancel and you roll one d20.

**Natural 20** on an **attack roll** always hits and is a **Critical Hit**. **Natural 1** on an attack roll always misses. (This automatic hit/miss applies to attack rolls, not to ordinary ability checks or saves.)

**Critical Hit damage:** roll all of the attack’s damage dice twice (including extra dice such as Sneak Attack), then add modifiers once.

Attack sequence: choose a target in range → apply cover and Advantage/Disadvantage → roll. Unseen attacker: Advantage on the roll; attacking an unseen target: Disadvantage (and you miss if you guessed the wrong spot). Hidden attackers give away their location when the attack hits or misses. Ranged attacks in melee typically have Disadvantage.

### Damage, resistance, and cover

Roll the listed damage dice, add the same ability modifier used for a weapon attack, and subtract from current HP. Damage cannot go below 0. Types (Slashing, Fire, and so on) have no effect of their own; other rules key off them.

Apply modifiers first, then **Resistance** (halve, round down), then **Vulnerability** (double). Multiple Resistances to the same type don’t stack. **Immunity** means no damage of that type, or no effect from that condition.

**Cover** (use the best degree only):

| Degree | Benefit | Typical source |
| --- | --- | --- |
| Half | +2 AC and Dexterity saves | Another creature, or an object covering at least half the target |
| Three-quarters | +5 AC and Dexterity saves | An object covering at least three-quarters |
| Total | Can’t be targeted directly | An object covering the whole target |

### Opportunity attacks

If a creature you can see **leaves your reach**, you may spend your Reaction to make one melee attack (weapon or Unarmed Strike) against it, resolved just before it leaves. You do **not** provoke if the traveler takes Disengage, Teleports, or is moved without using its own movement, action, Bonus Action, or Reaction (for example, shoved by an explosion).

### Conditions (SRD 5.2)

A creature either has a condition or does not; conditions don’t stack, except **Exhaustion**. Brief effects:

- **Blinded** — Can’t see; fail sight-based checks; attacks against you have Advantage; your attacks have Disadvantage.
- **Charmed** — Can’t harm the charmer; the charmer has Advantage on social checks against you.
- **Deafened** — Can’t hear; fail hearing-based checks.
- **Exhaustion** — Cumulative levels. You die at 6. Each level: −2 on D20 Tests and −5 feet of Speed. A Long Rest removes 1 level. *(2014 used six qualitatively different levels — disadvantage on checks, then halved speed, and so on — instead of this numeric penalty.)*
- **Frightened** — Disadvantage on ability checks and attack rolls while the source of fear is in sight; can’t willingly move closer to it.
- **Grappled** — Speed 0; Disadvantage on attacks against anyone but the grappler; the grappler can drag you (usually at extra movement cost).
- **Incapacitated** — No actions, Bonus Actions, or Reactions; typically can’t speak; Disadvantage on Initiative if you roll it while Incapacitated. Ends Concentration.
- **Invisible** — Unseen without a special sense; attacks against you have Disadvantage and your attacks have Advantage, unless the foe can see you.
- **Paralyzed** — Incapacitated, Speed 0, auto-fail Strength and Dexterity saves, attacks against you have Advantage, and a hit from within 5 feet is a Critical Hit.
- **Petrified** — Turned to an inanimate substance; Incapacitated, Speed 0, attacks have Advantage, auto-fail Strength and Dexterity saves, Resistance to all damage, Immunity to Poisoned.
- **Poisoned** — Disadvantage on attack rolls and ability checks.
- **Prone** — Crawl, or spend half your Speed to stand. Your attacks have Disadvantage. Attacks against you have Advantage within 5 feet, otherwise Disadvantage.
- **Restrained** — Speed 0; attacks against you have Advantage; your attacks and Dexterity saves have Disadvantage.
- **Stunned** — Incapacitated; attacks against you have Advantage (and the usual Incapacitated limits).
- **Unconscious** — Incapacitated, unaware, usually Prone, Speed 0, auto-fail Strength and Dexterity saves, attacks against you have Advantage, and a hit from within 5 feet is a Critical Hit.

### Death saving throws

Monsters usually die at 0 HP. A character who drops to 0 and does not die instantly is Unconscious and starts making **Death Saving Throws**. **Instant death** also occurs if leftover damage at 0 equals or exceeds HP maximum, or if HP maximum is reduced to 0.

At the start of your turn at 0 HP, roll 1d20 (no ability modifier). 10 or higher is a success. Three successes: you become **Stable**. Three failures: you die. A natural 1 counts as two failures; a natural 20 restores 1 HP (you are conscious). Damage at 0 HP adds a failure (two on a Critical Hit). Successes and failures reset if you regain any HP or become Stable.

**Stabilize** (2024): Help action, DC 10 Wisdom (Medicine). A Stable creature stays at 0 HP and Unconscious but stops rolling death saves; if later damaged, saves resume. If never healed, the creature regains 1 HP after 1d4 hours.

You may knock a creature out instead of killing it: a melee attack that would drop it to 0 can leave it at 1 HP, Unconscious, and starting a Short Rest.

### Resting

| Rest | Duration | Main benefits (2024 / SRD 5.2) |
| --- | --- | --- |
| **Short Rest** | 1 hour of light activity; must start with at least 1 HP | Spend Hit Dice (roll die + Con mod, minimum 1 HP each); some features recharge. Interrupted by Initiative, a non-cantrip spell, or any damage — no benefits if interrupted. |
| **Long Rest** | At least 8 hours, including ≥6 hours of sleep and ≤2 hours of light activity. Need at least 1 HP to start. Wait 16 hours before starting another. | Regain all HP and all spent Hit Dice; reduced HP maximum and reduced ability scores return to normal; Exhaustion decreases by 1; many features recharge. If interrupted after at least 1 hour, you still get Short Rest benefits. |

**2014 Long Rest difference:** you regained all HP but only **up to half** your Hit Dice (minimum 1 die), not all of them.

### Encounter-building XP budgets

**2024 / SRD 5.2:** pick Low, Moderate, or High difficulty; look up XP per character for the party’s level; multiply by the number of characters; spend that budget on monster XP values without going over.

Guidance: Low should be scary in spots but not lethal; Moderate can drop weaker characters; High can be lethal without good tactics. A single monster whose CR equals the party’s level is a rough low-difficulty fight for four characters. Watch large swarms of creatures (lucky damage spikes), especially at levels 1–2.

XP budget **per character** (Low / Moderate / High):

| Level | Low | Moderate | High |
| ---: | ---: | ---: | ---: |
| 1 | 50 | 75 | 100 |
| 2 | 100 | 150 | 200 |
| 3 | 150 | 225 | 400 |
| 4 | 250 | 375 | 500 |
| 5 | 500 | 750 | 1,100 |

(The SRD table continues through level 20; level 20 is 6,400 / 13,200 / 22,000.) Example: four level 1 characters, low difficulty → 200 XP (one 200 XP monster, or two 100 XP, or several weaker creatures).

**2014 *DMG*:** used Easy / Medium / Hard / Deadly XP **thresholds** per character, then applied a **multiplier** that rose with the number of monsters. SRD 5.2 dropped the multiplier: you just spend the budget.

---

## 3. Dungeon generation

Random dungeon *mapping and stocking* is a 2014 *Dungeon Master’s Guide* procedure (**Appendix A**, about pp. 290–301). It is **not** in the SRD, so this section summarizes structure, dice, and categories from published overviews and indexes (see Sources). It is not a reproduction of the book’s tables. Chapter 5 of that same *DMG* has separate “why does this dungeon exist?” tables (location, exotic location, creator, purpose, history).

### 2014 procedure (iterative)

1. Decide a **size limit** first (a sheet of graph paper, a target room count, or “this many scenes”). Unbounded rolling produces sprawling complexes.
2. Roll a **Starting Area** and pick one opening as the dungeon entrance.
3. For each passage leaving that area, extend it and roll on the **Passage** table until you hit a door, a chamber, stairs, or a dead end. For each door, roll **Door Type** and **Beyond a Door**.
4. When a chamber appears, roll **size and shape**, then **how many exits**, then each exit’s **location** and **type**. Keep going from every unfinished opening.
5. After the map exists, **stock** it: give the dungeon a purpose, assign each room a function, then roll contents, and finally add traps, dressing, and treasure.

If a feature would run off the page, shrink it, turn it, or treat the edge as another entrance. Stairs or shafts to levels you don’t plan to draw can also be extra exits.

### Key tables (dice and categories only)

**Starting Area (d10).** Ten entrance configurations: small square rooms with passages and/or doors (one version hides a secret door), a larger square with several doors, a long pillared hall, mid-size rooms, a 40-foot circle with cardinal passages (sometimes a well in the middle), a T-intersection, or a four-way intersection. Passages from the start are treated as already 10 feet out; then you consult the Passage table.

**Passages (d20).** Typical results: continue straight (about 20–30 feet) with no side features; a door to the left, right, or dead ahead; a side passage; a dead end (sometimes with a chance of a secret door); a left or right turn; a **chamber**; or **stairs**. Roll **Passage Width** when a new corridor begins (d12 if it branches from another passage, d20 if it leaves a chamber, and not wider than the room it leaves). Widths run from a tight 5-foot hall up through common 10-foot corridors to wider halls, sometimes with columns or a stream.

**Doors.** **Door Type (d20)** distinguishes ordinary wooden doors from stone, iron, portcullises, secret doors, and similar, often with a chance the door is stuck or locked. **Beyond a Door (d20)** says what is on the other side: a short corridor, a chamber, stairs, a false door, and similar continuations.

**Chambers.** **Chamber (d20)** gives size and shape, loosely grouped into normal vs. large rooms (squares and rectangles of various footprints, plus circles, octagons, trapezoids). **Chamber Exits (d20)** gives an exit count (zero up to several; large rooms tend to have more). For each exit, **Exit Location (d20)** (opposite wall, left, right, or the same wall as the entrance) and **Exit Type (d20)** (a door vs. a short corridor).

**Stairs (d20).** Up or down one or more levels, dead ends, chutes, and occasional trapped or unusual vertical connections. Useful both as dungeon “depth” and as a way to stop mapping a level.

**Stocking a dungeon.** First pick (or roll) the dungeon’s **purpose**. Appendix A includes purpose-specific chamber tables, commonly grouped as: death trap, lair, maze, mine, planar gate, stronghold, temple or shrine, tomb, and treasure vault, plus a **General Dungeon Chambers** table when you don’t want a type. Optional: **Current Chamber State** (what condition the room is in now). Then **Dungeon Chamber Contents** — the important stocking roll — whose categories are along the lines of empty rooms, a dominant monster, pets or allied creatures, random wanderers, hazards, obstacles, traps, tricks, and treasure (sometimes alone, sometimes with a monster). **Monster Motivation** flavors why the occupants are there.

**Traps and tricks (several d20 / related tables).** Typical pieces: **Trap Trigger**, **Trap Damage Severity**, **Trap Effect**, plus **Trick Objects** / **Tricks**. Hazards and obstacles have their own tables. These are meant to be interpreted, not used as a physics engine.

**Dressing.** Separate tables for noises, air quality, odors, general architectural features, furnishings (general, religious, and mage), utensils and personal items, container contents, and books or scrolls. This is how empty rooms still feel like a place.

**Chapter 5 “big picture” tables (2014 *DMG*, before Appendix A).** **Dungeon Location** and **Exotic Location**, **Dungeon Creator** (and related group tables), **Dungeon Purpose**, and **Dungeon History**. Roll these first if you want the map to mean something. Adventure-framing tables in the same chapter (goals, villains, patrons, introductions, climaxes) are useful for a 2–8 scene door-code game.

### 2024 *Dungeon Master’s Guide*

The 2024 *DMG* **drops Appendix A’s random mapper**. Appendix A is a lore glossary; Appendix B collects **sample maps**. Dungeon advice moves into the DM’s toolbox. The old location / creator / purpose / history tables are collapsed into one **Dungeon Quirks** table (d100): roll or pick one or more quirks (abandoned because of a curse, built as a maze, and so on) to sketch the site. Commentary on the book notes that you may need several rolls to cover location, maker, purpose, and history, and that some 2014 creator options were cut. For *generating a walkable map*, the 2014 appendix (or any simple room-and-corridor algorithm inspired by it) is still the practical tool; the 2024 book is better for flavor than for procedural layout.

### Practical tips

- **Bound the dungeon before you roll.** For The Dungeon Door, a graph of `sceneCount` rooms (2–8, including a finale) is enough. You do not need 5-foot squares.
- **Purpose before contents.** A tomb that is also a cult lair reads as one place; a pile of unrelated chambers does not.
- **Do not fight in every room.** Empty, trapped, trick, and treasure rooms are part of the design. Dressing tables exist so “empty” is still interesting.
- **Exits are story structure.** Dead ends, secret doors, and stairs are natural “choice” beats (the three options in a scene).
- **Stock to the party, not the table.** Use the XP budget in section 2 for anything that can fight. A short family game wants at most one moderate fight and maybe one low-difficulty skirmish or trap.
- **Let unmapped stairs be later adventures**, not homework.
- **A node graph is better than a geomorph for an AI DM:** rooms with a title, purpose, contents tag, exits, and a one-line hazard/treasure note.

---

## 4. Implications for The Dungeon Door

Keep the current loop (shared three choices, majority moves the party, every d20 colors the outcome). Add just enough numbers that the DM can be consistent about harm, treasure, and “did we succeed?” Do not build a full initiative-and-grid combat engine.

### Hero data to add (minimal)

The forge already captures race, class, alignment, and a written description (`Character` in `docs/api.md`). Extend it with computed, mostly auto-filled fields:

```ts
HeroStats {
  level: 1                         // one-shots stay at 1 unless you later add XP
  abilities: { str, dex, con, int, wis, cha }  // scores; derive modifiers
  proficiencyBonus: 2
  hitDie: 'd6' | 'd8' | 'd10' | 'd12'
  hpMax: number
  hp: number
  ac: number
  inventory: { id: string, name: string, kind: 'weapon' | 'armor' | 'gear' | 'treasure' | 'consumable', notes?: string }[]
  conditions?: string[]            // a short list, often empty
}
```

Suggested generation, all server-side so the forge stays mostly narrative:

1. Player still describes a hero and picks race and class from the catalog.
2. Apply the **standard array** using the SRD’s class layout (or let the player rearrange once).
3. Grant **+2 to the class’s primary ability** and **+1 to Constitution** (a simplified 2024 background ASI). Cap at 20.
4. Set `hpMax` / `hp` from the level 1 HP table and Constitution modifier; set `hitDie` from class; set `ac` from a default kit (unarmored 10 + Dex, or the armor in package A).
5. Seed `inventory` from class package A plus any obvious item in the player’s description (“a red fiddle,” “grandmother’s shield”).

Pass `HeroStats` into `DMContext.party` (see `docs/dungeon-master.md`) so every scene prompt can see current HP and gear. Persist HP and inventory on the game’s player record so they survive from scene to scene.

Skip, for v1: feats, spell slots, skill lists, formal species traits, death-save tracking across scenes, and carrying capacity. If someone hits 0 HP in a short one-shot, mark them **downed for the scene** (Unconscious / Stable) and let a later choice or a friendly Heal moment bring them back, unless you deliberately want a death.

### Mapping a d20 vote to a check

Keep the server-rolled d20 on the vote. After the majority choice is known, treat **each voter’s roll** as that hero’s D20 Test for how well *they* did their part of the same plan.

- `total = roll + abilityMod + (proficient ? proficiencyBonus : 0)`
- Pick the ability from the choice’s intent: force a door → Strength; sneak or dodge → Dexterity; endure → Constitution; recall lore → Intelligence; notice or track → Wisdom; persuade or deceive → Charisma. If the choice is an attack, use the attack bonus instead and compare to a monster AC (or a stand-in DC).
- Set **DC** from the 5/10/15/20/25/30 ladder. Default **15** (medium). Use 10 for an easy beat, 20 for a hard one. Put the DC and ability on the choice when the DM writes it (`choices: { label, detail, ability?, dc? }`) so the engine, not the prose, does the math.
- **Natural 20 / natural 1** already in the DM contract: spectacular success or a memorable mishap *for that character*, even if the party as a whole follows the majority.
- Resolve the **party** from the majority choice plus a simple success count (for example, at least half the voters meet the DC → the plan works cleanly; fewer → it works at a cost; all fail → complications). Split votes already mean a messy, staggered result.

Worked example: four heroes pick “talk the goblins down” (Charisma, DC 15). Rolls 18, 12, 4, 20 become totals after modifiers. The party still tries to parley (majority). The 20 is a stirring speech, the 4 is a careless insult, and the DM’s `outcome` weaves both — which is already how the seam is written.

### Combat and dungeons in a 2–8 scene game

- **Do not run turn-by-turn combat in the app.** A fight is one scene (sometimes two). The three choices are tactics: charge, hold the doorway, bargain, flee, drop the chandelier. Each hero’s d20 is an attack or a check. Failed rolls spend HP (a small, fixed bite, or the monster’s typical damage once). If several heroes fail a high-difficulty scene, someone can drop to 0 and be Stable by the outcome text.
- **XP budget as a prompt constraint, not a combat engine.** For a level 1 party of four, a moderate fight is about 300 XP of opposition; a low fight is 200. Tell the DM the budget and the monsters’ names; don’t ask it to invent CR math mid-scene.
- **Generate a room graph, not a geomorph.** When the host starts a game, build `sceneCount` nodes: a starting area, a mid-dungeon choice of paths, one confrontation, and a finale that matches a purpose (lair, tomb, vault, shrine). Tag each node with Appendix A-style categories (`contents: monster | trap | empty | treasure | trick`, plus a purpose and two or three exits). Feed that graph to `openingScene` / `nextScene` so choices correspond to real exits. 2024 **Dungeon Quirks** are a cheap way to flavor the adventure title and dressing.
- **Inventory changes belong in the DM return value** (add/remove item, spend a consumable). The engine applies them after `nextScene`, the same way it already accepts `chosenChoiceId` and then enforces majority.

This stays compatible with the existing seam: the engine still enforces three choices and majority movement; the DM still writes narration; the new numbers only constrain what “weigh everyone’s roll” means.

---

## Sources

**Official SRD (CC-BY-4.0)** — primary source for character creation, combat, conditions, rests, and encounter budgets:

- SRD 5.2 (2024 rules), PDF: <https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.pdf>
- SRD 5.2 / 5.2.1 index on D&D Beyond: <https://www.dndbeyond.com/srd>
- SRD 5.1 (2014 rules), PDF: <https://media.dndbeyond.com/compendium-images/srd/5.1/SRD_CC_v5.1.pdf>
- License: <https://creativecommons.org/licenses/by/4.0/legalcode>

This work includes material from the System Reference Document 5.2 (“SRD 5.2”) by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.

**Open references and APIs**

- Open5e (SRD-based reference and API): <https://open5e.com/> and <https://api.open5e.com/>
- Structured SRD 5.2 character-creation pages (Your 5E): <https://your5e.com/notebooks/your5e/dnd-52-srd-player-characters/>

**2014 vs. 2024 overviews** (non-SRD; used for differences, not for copying book text)

- Wizards: “How to Create a Character Using the 2024 Player’s Handbook”: <https://www.dndbeyond.com/posts/1787-how-to-create-a-character-using-the-2024-players>
- Wizards: backgrounds and Origin feats (2024): <https://www.dndbeyond.com/posts/1785-the-backgrounds-and-origin-feats-in-the-2024>
- Wizards: the ten 2024 species: <https://www.dndbeyond.com/posts/1783-the-10-species-in-the-2024-players-handbook>
- Wizards: “Updates in the Dungeon Master’s Guide (2024)” (Appendix A becomes a lore glossary; Appendix B is maps): <https://www.dndbeyond.com/posts/1916-updates-in-the-dungeon-masters-guide-2024>
- Rule-change roundups: <https://www.rollfortwo.com/articles/dnd-2014-vs-2024-rules-changes/>, <https://rollcamp.com/blog/dnd-5e-2024-vs-2014-changes>

**Dungeon generation structure (2014 Appendix A is not in the SRD; summarized only)**

- Sly Flourish, index of 2014 *DMG* random tables (names and page numbers, including Appendix A): <https://slyflourish.com/random_tables_of_the_dmg.html>
- Commentary on the 2024 *DMG* dropping the random mapper and collapsing purpose/history into Dungeon Quirks: <https://forlornencystment.blogspot.com/2024/12/the-2024-dmg-cares-even-less-about.html>

**The Dungeon Door**

- Repository: <https://github.com/LupusDei/the-dungeon-door>
- `README.md`, `docs/dungeon-master.md` (DM seam, votes, and d20 contract), `docs/api.md` (character and scene shapes)
