# SRD Rules Tables for The Dungeon Door

Normalized, camelCase JSON built from openly licensed D&D 5e System Reference Documents.
Prefer the `5.2/` folder (2024 rules) for the game's rules engine; `5.1/` is the 2014 SRD.

Fetched: 2026-11-25.

Structured source: [5e-bits/5e-srd-api](https://github.com/5e-bits/5e-srd-api) `packages/5e-database/src/{2014,2024}/en` (community JSON of the SRD).

Official PDFs used for tables and rules text not present as standalone collections:

- SRD 5.2: https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.pdf
- SRD 5.1: https://media.wizards.com/2023/downloads/dnd/SRD_CC_v5.1.pdf

The 5e-database project is MIT-licensed; the underlying game content is CC-BY-4.0 SRD.
Rebuild with `python3 server/scripts/build_srd_data.py` from the repo root (writes to `server/data/srd/`, reads curated tables from `server/scripts/curated/`; the 5e-srd-api sources are expected at `/tmp/5e-srd-src`).

## Attribution

### SRD 5.2

This work includes material from the System Reference Document 5.2 ("SRD 5.2") by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.

### SRD 5.1

This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at https://creativecommons.org/licenses/by/4.0/legalcode.

## Files

| File | Records | Version | Source |
| --- | ---: | --- | --- |
| `5.2/weapons.json` | 38 | SRD 5.2 | 5e-srd-api |
| `5.2/armor.json` | 13 | SRD 5.2 | 5e-srd-api |
| `5.2/weaponProperties.json` | 10 | SRD 5.2 | 5e-srd-api |
| `5.2/weaponMasteryProperties.json` | 8 | SRD 5.2 | 5e-srd-api |
| `5.2/adventuringGear.json` | 88 | SRD 5.2 | 5e-srd-api |
| `5.2/equipmentPacks.json` | 7 | SRD 5.2 | 5e-srd-api |
| `5.2/tools.json` | 36 | SRD 5.2 | 5e-srd-api |
| `5.2/conditions.json` | 15 | SRD 5.2 | 5e-srd-api |
| `5.2/exhaustion.json` | 1 | SRD 5.2 | 5e-srd-api |
| `5.2/damageTypes.json` | 13 | SRD 5.2 | 5e-srd-api |
| `5.2/actionsInCombat.json` | 12 | SRD 5.2 | official PDF |
| `5.2/cover.json` | 3 | SRD 5.2 | official PDF |
| `5.2/deathSaves.json` | 1 | SRD 5.2 | official PDF |
| `5.2/characterAdvancement.json` | 20 | SRD 5.2 | official PDF |
| `5.2/proficiencyBonusByLevel.json` | 20 | SRD 5.2 | official PDF |
| `5.2/abilityModifiers.json` | 30 | SRD 5.2 | official PDF |
| `5.2/abilityScorePointCosts.json` | 8 | SRD 5.2 | official PDF |
| `5.2/difficultyClasses.json` | 6 | SRD 5.2 | official PDF |
| `5.2/sizeCategories.json` | 6 | SRD 5.2 | official PDF |
| `5.2/encounterBudgets.json` | 20 | SRD 5.2 | official PDF |
| `5.2/crToXp.json` | 31 | SRD 5.2 | official PDF |
| `5.2/objects.json` | 1 | SRD 5.2 | official PDF |
| `5.2/spells.json` | 339 | SRD 5.2 | 5e-srd-api |
| `5.2/magicSchools.json` | 8 | SRD 5.2 | 5e-srd-api |
| `5.2/cantripScaling.json` | 15 | SRD 5.2 | 5e-srd-api |
| `5.2/spellSlots.json` | 8 | SRD 5.2 | 5e-srd-api |
| `5.2/classes.json` | 12 | SRD 5.2 | 5e-srd-api |
| `5.2/subclasses.json` | 12 | SRD 5.2 | 5e-srd-api |
| `5.2/species.json` | 9 | SRD 5.2 | 5e-srd-api |
| `5.2/subspecies.json` | 24 | SRD 5.2 | 5e-srd-api |
| `5.2/backgrounds.json` | 4 | SRD 5.2 | 5e-srd-api |
| `5.2/feats.json` | 17 | SRD 5.2 | 5e-srd-api |
| `5.2/skills.json` | 18 | SRD 5.2 | 5e-srd-api |
| `5.2/languages.json` | 19 | SRD 5.2 | 5e-srd-api |
| `5.2/abilityScores.json` | 6 | SRD 5.2 | 5e-srd-api |
| `5.2/alignments.json` | 10 | SRD 5.2 | 5e-srd-api |
| `5.2/traits.json` | 68 | SRD 5.2 | 5e-srd-api |
| `5.2/monsters.json` | 341 | SRD 5.2 | 5e-srd-api |
| `5.2/magicItems.json` | 277 | SRD 5.2 | 5e-srd-api |
| `5.2/poisons.json` | 14 | SRD 5.2 | 5e-srd-api |
| `5.2/traps.json` | 1 | SRD 5.2 | official PDF |
| `5.2/hazards.json` | 5 | SRD 5.2 | official PDF |
| `5.1/weapons.json` | 37 | SRD 5.1 | 5e-srd-api |
| `5.1/armor.json` | 13 | SRD 5.1 | 5e-srd-api |
| `5.1/weaponProperties.json` | 11 | SRD 5.1 | 5e-srd-api |
| `5.1/adventuringGear.json` | 149 | SRD 5.1 | 5e-srd-api |
| `5.1/equipmentPacks.json` | 7 | SRD 5.1 | 5e-srd-api |
| `5.1/tools.json` | 31 | SRD 5.1 | 5e-srd-api |
| `5.1/conditions.json` | 15 | SRD 5.1 | 5e-srd-api |
| `5.1/exhaustion.json` | 1 | SRD 5.1 | 5e-srd-api |
| `5.1/damageTypes.json` | 13 | SRD 5.1 | 5e-srd-api |
| `5.1/actionsInCombat.json` | 10 | SRD 5.1 | 5e-srd-api |
| `5.1/cover.json` | 1 | SRD 5.1 | 5e-srd-api |
| `5.1/deathSaves.json` | 2 | SRD 5.1 | 5e-srd-api |
| `5.1/proficiencyBonusByLevel.json` | 20 | SRD 5.1 | official PDF |
| `5.1/characterAdvancement.json` | 20 | SRD 5.1 | official PDF |
| `5.1/abilityModifiers.json` | 30 | SRD 5.1 | official PDF |
| `5.1/difficultyClasses.json` | 1 | SRD 5.1 | 5e-srd-api |
| `5.1/sizeCategories.json` | 1 | SRD 5.1 | 5e-srd-api |
| `5.1/crToXp.json` | 28 | SRD 5.1 | 5e-srd-api |
| `5.1/spells.json` | 319 | SRD 5.1 | 5e-srd-api |
| `5.1/magicSchools.json` | 8 | SRD 5.1 | 5e-srd-api |
| `5.1/cantripScaling.json` | 10 | SRD 5.1 | 5e-srd-api |
| `5.1/spellSlots.json` | 8 | SRD 5.1 | 5e-srd-api |
| `5.1/classes.json` | 12 | SRD 5.1 | 5e-srd-api |
| `5.1/subclasses.json` | 12 | SRD 5.1 | 5e-srd-api |
| `5.1/races.json` | 9 | SRD 5.1 | 5e-srd-api |
| `5.1/subraces.json` | 4 | SRD 5.1 | 5e-srd-api |
| `5.1/backgrounds.json` | 1 | SRD 5.1 | 5e-srd-api |
| `5.1/feats.json` | 1 | SRD 5.1 | 5e-srd-api |
| `5.1/skills.json` | 18 | SRD 5.1 | 5e-srd-api |
| `5.1/languages.json` | 16 | SRD 5.1 | 5e-srd-api |
| `5.1/abilityScores.json` | 6 | SRD 5.1 | 5e-srd-api |
| `5.1/alignments.json` | 9 | SRD 5.1 | 5e-srd-api |
| `5.1/traits.json` | 38 | SRD 5.1 | 5e-srd-api |
| `5.1/monsters.json` | 334 | SRD 5.1 | 5e-srd-api |
| `5.1/magicItems.json` | 362 | SRD 5.1 | 5e-srd-api |
| `5.1/traps.json` | 11 | SRD 5.1 | 5e-srd-api |
| `5.1/environment.json` | 7 | SRD 5.1 | 5e-srd-api |
| `5.1/objects.json` | 3 | SRD 5.1 | 5e-srd-api |
| `5.1/combatRules.json` | 16 | SRD 5.1 | 5e-srd-api |
| `extras/startingWealthSrd52.json` | 12 | SRD 5.2 | 5e-srd-api |

## Extras (open-licensed equivalents and originals)

Open-licensed stand-ins for tables that are not in the SRD, plus original CC0 procedures authored for The Dungeon Door. Each JSON file has `meta.license`, `meta.attribution`, and `meta.sourceUrl`. The 2014 DMG and 1e AD&D Appendix A were not used as sources.

| File | Records | License | Role |
| --- | ---: | --- | --- |
| `extras/actionEconomyBands.json` | 1 | CC0-1.0 | Action Economy Bands (original multiple-monster guidance) |
| `extras/dungeonGenerator.json` | 1 | CC0-1.0 | The Dungeon Door Map Procedure (original random dungeon generator) |
| `extras/exploreGenerator.json` | 1 | CC0-1.0 | The Dungeon Door Explore-As-You-Go Tables (original passage, door, room-exit and depth tables) |
| `extras/encounterDifficultyA5e.json` | 1 | CC-BY-4.0 | A5E Combat Encounter Difficulty (Easy / Medium / Hard / Deadly) |
| `extras/oseDungeonStocking.json` | 1 | CC-BY-4.0 (also OGL 1.0a Open Game Content) | Old-School Essentials Random Dungeon Stocking |
| `extras/startingWealthA5e.json` | 13 | CC-BY-4.0 | A5E Starting Gold Per Class |
| `extras/startingWealthPathfinder.json` | 11 | OGL 1.0a | Pathfinder RPG Starting Character Wealth |
| `extras/startingWealthRandom.json` | 1 | CC0-1.0 (procedure and fortune die); buyout amounts CC-BY-4.0 SRD 5.2 | Original Starting Purse (centered on SRD 5.2 buyouts) |
| `extras/startingWealthSrd52.json` | 12 | CC-BY-4.0 | SRD 5.2 Starting Gold Options by Class |
| `extras/OGL-LICENSE.md` | — | OGL 1.0a | Full license and Section 15 for the Pathfinder wealth table |

## Gaps and notes

- **2014 encounter XP thresholds** (easy / medium / hard / deadly) are from the Dungeon Master's Guide, not SRD 5.1, and are not reproduced here. Open equivalent: `extras/encounterDifficultyA5e.json` (A5ESRD, CC-BY-4.0) uses total-CR ratios for the same four bands plus Impossible. Official 2024 budgets remain in `5.2/encounterBudgets.json`.
- **2014 multiple-monster encounter multipliers** are also DMG-only and are not reproduced. A5E handles action economy by summing CRs (and doubling elites). Optional original band-shift rule: `extras/actionEconomyBands.json` (CC0).
- **2014 starting-wealth (random GP) table** is not in the SRD and is not reproduced. Open stand-ins: `extras/startingWealthSrd52.json` (SRD 5.2 buyout gold), `extras/startingWealthA5e.json` (A5E fixed gold, CC-BY-4.0), `extras/startingWealthPathfinder.json` (PF1 random dice, OGL 1.0a), and an original fortune die around the SRD 5.2 amounts in `extras/startingWealthRandom.json` (CC0).
- **DMG Appendix A random dungeon tables** (and the 1e AD&D Appendix A) are not open and were not copied. Open stocking: `extras/oseDungeonStocking.json` (OSE SRD, CC-BY-4.0 / OGL). Original 5e graph procedure for this game: `extras/dungeonGenerator.json` (CC0), which points at SRD 5.1 sample traps and SRD 5.2 hazards. Explore-as-you-go: `extras/exploreGenerator.json` (CC0), original tables that follow the classic roll-the-passage-ahead procedure but share no wording or numbers with any published table. The Basic Fantasy 'Dungeon Generator' supplement is OGL 1.0a but could not be fetched in full (HTTP 403). donjon's generator is CC-BY-NC and was skipped.
- **2024 SRD has no creature named Goblin.** Use `goblin-warrior`, `goblin-minion`, or `goblin-boss`. The 2014 file has `goblin`.
- **CR 11-13** in `5.2/crToXp.json` were filled from SRD 5.2 monster XP because those rows were not visible in the two-column PDF extract. The Archmage stat block lists 8,000 XP at CR 12 versus the table value 8,400.
- Some 2014 monster stat blocks disagree with the standard CR-to-XP mapping; see notes in `5.1/crToXp.json`.
- **2024 backgrounds in the SRD:** Acolyte, Criminal, Sage, Soldier (each with ability increases and an origin feat). **2014 SRD:** Acolyte only.
- **2024 feats:** 17 SRD feats. **2014 SRD:** Grappler only.
- Hazard wording for Falling, Suffocation, and Malnutrition should be double-checked against the PDF if used in a rules engine; two-column extraction can drop a clause.
- A later SRD 5.2.1 exists on D&D Beyond (May 2025). This dataset uses the official SRD 5.2 PDF dated April 22, 2025, plus 5e-srd-api 2024 JSON fetched 2026-11-25.

## Validation

Every file parses as JSON. Spot-checks passed for Fireball (3rd-level Evocation, 8d6 Fire, Dexterity save), Longsword (1d8 slashing, versatile 1d10, mastery Sap), Goblin / Goblin Warrior, and Fighter (d10, Str/Con saves, proficiency +2/+3).
