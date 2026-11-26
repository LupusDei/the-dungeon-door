#!/usr/bin/env python3
"""Build normalized camelCase SRD JSON tables for The Dungeon Door.

Sources fetched 2026-11-25:
  - 5e-bits/5e-srd-api packages/5e-database src/{2014,2024}/en
  - Official SRD 5.2 PDF (CC-BY-4.0)
  - Official SRD 5.1 CC PDF (CC-BY-4.0)

DMG Appendix A random dungeon tables are not SRD and are not included.
2014 encounter XP thresholds and monster-count multipliers are not in
SRD 5.1 and are not included.
"""
from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
import shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = Path("/tmp/5e-srd-src")
OUT = HERE.parent / "data" / "srd"
CURATED = HERE / "curated"

ATTR_52 = (
    "This work includes material from the System Reference Document 5.2 "
    '("SRD 5.2") by Wizards of the Coast LLC, available at '
    "https://www.dndbeyond.com/srd. The SRD 5.2 is licensed under the "
    "Creative Commons Attribution 4.0 International License, available at "
    "https://creativecommons.org/licenses/by/4.0/legalcode."
)
ATTR_51 = (
    "This work includes material taken from the System Reference Document 5.1 "
    '("SRD 5.1") by Wizards of the Coast LLC and available at '
    "https://dnd.wizards.com/resources/systems-reference-document. The "
    "SRD 5.1 is licensed under the Creative Commons Attribution 4.0 "
    "International License available at "
    "https://creativecommons.org/licenses/by/4.0/legalcode."
)

SOURCE_DB = "https://github.com/5e-bits/5e-srd-api/tree/main/packages/5e-database/src"
SOURCE_PDF_52 = "https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.pdf"
SOURCE_PDF_51 = "https://media.wizards.com/2023/downloads/dnd/SRD_CC_v5.1.pdf"
FETCHED = "2026-11-25"
DROP_KEYS = {"url", "image"}
MANIFEST: list[dict] = []

ACTIONS_51_INDEXES = [
    "attack", "cast-a-spell", "dash", "disengage", "dodge", "help", "hide",
    "ready", "search", "use-an-object",
]
CASTER_TYPES = {
    "bard": "full", "cleric": "full", "druid": "full", "sorcerer": "full",
    "wizard": "full", "paladin": "half", "ranger": "half", "artificer": "half",
    "eldritch-knight": "third", "arcane-trickster": "third", "warlock": "pact",
}


def camel(key: str) -> str:
    if "_" not in key:
        return key
    parts = key.split("_")
    return parts[0] + "".join(p[:1].upper() + p[1:] for p in parts[1:] if p)


def convert(obj):
    if isinstance(obj, list):
        return [convert(x) for x in obj]
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if k in DROP_KEYS:
                continue
            out[camel(k)] = convert(v)
        return out
    return obj


def load_src(year: str, name: str):
    return json.loads((SRC / year / f"5e-SRD-{name}.json").read_text())


def load_curated(name: str):
    return json.loads((CURATED / name).read_text())


def meta(version: str, title: str, records, *, extra_sources=None, notes=None, from_pdf=False):
    is_52 = version.startswith("5.2")
    m = {
        "title": title,
        "version": f"SRD {version}",
        "srd": version,
        "ruleset": "2024" if is_52 else "2014",
        "license": "CC-BY-4.0",
        "attribution": ATTR_52 if is_52 else ATTR_51,
        "sourceDatabase": f"{SOURCE_DB}/{'2024' if is_52 else '2014'}/en",
        "sourcePdf": SOURCE_PDF_52 if is_52 else SOURCE_PDF_51,
        "fetched": FETCHED,
        "recordCount": len(records) if isinstance(records, list) else 1,
    }
    if extra_sources:
        m["additionalSources"] = extra_sources
    if notes:
        m["notes"] = notes
    if from_pdf:
        m["primarySource"] = "official-pdf"
    return m


def write_file(relpath: str, version: str, title: str, records, **kwargs):
    path = OUT / relpath
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"meta": meta(version, title, records, **kwargs), "records": records}
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    rec_count = len(records) if isinstance(records, list) else 1
    source = payload["meta"]["sourcePdf"] if kwargs.get("from_pdf") else payload["meta"]["sourceDatabase"]
    MANIFEST.append({
        "file": relpath,
        "title": title,
        "version": f"SRD {version}",
        "recordCount": rec_count,
        "source": source,
    })
    print(f"  wrote {relpath} ({rec_count})")
    return path


def ref_name(obj, default=None):
    if obj is None:
        return default
    if isinstance(obj, str):
        return obj
    if isinstance(obj, dict):
        return obj.get("name") or obj.get("index") or default
    return default


def ref_index(obj, default=None):
    if obj is None:
        return default
    if isinstance(obj, str):
        return obj
    if isinstance(obj, dict):
        return obj.get("index") or default
    return default


def category_indexes(item) -> set:
    cats = list(item.get("equipment_categories") or [])
    if item.get("equipment_category"):
        cats.append(item["equipment_category"])
    out = set()
    for c in cats:
        if isinstance(c, dict):
            out.add((c.get("index") or "").lower())
        elif isinstance(c, str):
            out.add(c.lower())
    return out


def cost_obj(cost):
    return convert(cost) if cost else None


def ability_modifier(score: int) -> int:
    return (score - 10) // 2


def build_ability_modifiers():
    records = []
    for score in range(1, 31):
        records.append({
            "score": score,
            "modifier": ability_modifier(score),
            "inPrintedTable": 3 <= score <= 20,
        })
    return records


def normalize_weapon(item, version):
    cats = category_indexes(item)
    weapon_cat = item.get("weapon_category")
    if weapon_cat:
        weapon_cat = weapon_cat.lower()
    elif "martial-weapons" in cats:
        weapon_cat = "martial"
    elif "simple-weapons" in cats:
        weapon_cat = "simple"
    melee = "melee-weapons" in cats or item.get("weapon_range") == "Melee"
    ranged = "ranged-weapons" in cats or item.get("weapon_range") == "Ranged"
    rng = item.get("range") or {}
    rec = {
        "index": item.get("index"),
        "name": item.get("name"),
        "category": weapon_cat,
        "weaponRange": "ranged" if ranged and not melee else ("melee" if melee else item.get("weapon_range")),
        "cost": cost_obj(item.get("cost")),
        "weight": item.get("weight"),
        "damage": convert(item.get("damage")),
        "twoHandedDamage": convert(item.get("two_handed_damage")),
        "range": {"normal": rng.get("normal"), "long": rng.get("long")} if rng else None,
        "properties": [ref_index(p) for p in (item.get("properties") or [])],
    }
    if version == "5.2" and item.get("mastery"):
        rec["mastery"] = ref_index(item.get("mastery"))
    if item.get("ammunition"):
        rec["ammunition"] = convert(item.get("ammunition"))
    if rec["twoHandedDamage"] is None:
        rec.pop("twoHandedDamage")
    return rec


def normalize_armor(item):
    cats = category_indexes(item)
    kind = item.get("armor_category")
    if kind:
        kind = kind.lower()
    elif "shields" in cats or item.get("index") == "shield":
        kind = "shield"
    elif "light-armor" in cats:
        kind = "light"
    elif "medium-armor" in cats:
        kind = "medium"
    elif "heavy-armor" in cats:
        kind = "heavy"
    else:
        kind = "armor"
    ac = item.get("armor_class") or {}
    return {
        "index": item.get("index"),
        "name": item.get("name"),
        "category": kind,
        "armorClass": {
            "base": ac.get("base"),
            "dexBonus": ac.get("dex_bonus"),
            "maxBonus": ac.get("max_bonus"),
        },
        "strengthMinimum": item.get("str_minimum") or 0,
        "stealthDisadvantage": bool(item.get("stealth_disadvantage")),
        "cost": cost_obj(item.get("cost")),
        "weight": item.get("weight"),
        "donTime": item.get("don_time"),
        "doffTime": item.get("doff_time"),
    }


def normalize_spell(s):
    school = s.get("school")
    desc = s.get("description") or s.get("desc")
    if isinstance(desc, list):
        desc = "\n".join(desc)
    higher = s.get("higher_level")
    if isinstance(higher, list):
        higher = "\n".join(higher)
    return {
        "index": s.get("index"),
        "name": s.get("name"),
        "level": s.get("level"),
        "school": ref_index(school) if not isinstance(school, str) else school,
        "schoolName": ref_name(school),
        "castingTime": s.get("casting_time"),
        "range": s.get("range"),
        "components": s.get("components"),
        "material": s.get("material"),
        "duration": s.get("duration"),
        "concentration": bool(s.get("concentration")),
        "ritual": bool(s.get("ritual")),
        "classes": [ref_index(c) for c in (s.get("classes") or [])],
        "attackType": s.get("attack_type"),
        "damage": _normalize_damage(s.get("damage")),
        "description": desc,
        "higherLevel": higher,
    }


LEVEL_DICE_RE = re.compile(r"levels?\s+(\d+)\s*\(([^)]+)\)", re.I)
LEVEL_DICE_2014_RE = re.compile(r"(\d+)(?:st|nd|rd|th)\s+level\s*\(([^)]+)\)", re.I)
CANTRIP_UPGRADE_RE = re.compile(r"Cantrip Upgrade\.\s*(.+)$", re.I | re.S)


def _first_damage(dmg):
    if isinstance(dmg, list):
        return dmg[0] if dmg else {}
    if isinstance(dmg, dict):
        return dmg
    return {}


def _normalize_damage(dmg):
    if not dmg:
        return None
    if isinstance(dmg, list):
        return [convert(x) for x in dmg]
    return convert(dmg)


def parse_cantrip_scaling(spell):
    text = (spell.get("description") or "") + " "
    higher = spell.get("higherLevel")
    if isinstance(higher, str):
        text += higher
    elif isinstance(higher, list):
        text += " ".join(higher)
    dmg = _first_damage(spell.get("damage"))
    at = {}
    # Prefer structured tables when present (2014 uses damageAtCharacterLevel).
    structured = dmg.get("damageAtCharacterLevel") or dmg.get("damage_at_character_level") or {}
    if isinstance(structured, dict):
        at = {str(k): v for k, v in structured.items()}
    # "levels 5 (2d10), 11 (3d10), and 17 (4d10)" — only the first token
    # has the word "level", so also harvest every "<n> (<dice>)" pair.
    for m in re.finditer(r"(?<![A-Za-z])(\d+)\s*\(([^)]+)\)", text):
        at.setdefault(str(int(m.group(1))), m.group(2).strip())
    for rx in (LEVEL_DICE_RE, LEVEL_DICE_2014_RE):
        for m in rx.finditer(text):
            at.setdefault(str(int(m.group(1))), m.group(2).strip())
    upgrade = None
    m = CANTRIP_UPGRADE_RE.search(text)
    if m:
        upgrade = re.sub(r"\s+", " ", m.group(1)).strip()
    for m in re.finditer(r"(\w+) beams? at level (\d+)", text, re.I):
        at[str(int(m.group(2)))] = f"{m.group(1)} beams"
    if not at and not upgrade:
        return None
    slot = dmg.get("damageAtSlotLevel") or dmg.get("damage_at_slot_level") or {}
    base = None
    if isinstance(slot, dict):
        base = slot.get("0") or slot.get(0)
    if not base and "1" in at:
        base = at.get("1")
    return {
        "index": spell["index"],
        "name": spell["name"],
        "baseDamage": base,
        "atCharacterLevel": at or None,
        "upgradeText": upgrade,
    }


def slots_from_spellcasting(sc):
    if not sc:
        return None
    slots = [sc.get(f"spell_slots_level_{i}") or 0 for i in range(1, 10)]
    return {
        "cantripsKnown": sc.get("cantrips_known") or 0,
        "spellsKnown": sc.get("spells_known"),
        "preparedSpells": sc.get("prepared_spells"),
        "slots": slots,
    }


def build_spell_slots(levels):
    by_class = defaultdict(list)
    for lv in levels:
        if lv.get("subclass") or not lv.get("spellcasting"):
            continue
        ci = ref_index(lv.get("class"))
        by_class[ci].append((lv.get("level"), slots_from_spellcasting(lv.get("spellcasting"))))
    records = []
    for ci, rows in sorted(by_class.items()):
        rows.sort()
        records.append({
            "index": ci,
            "class": ci,
            "casterType": CASTER_TYPES.get(ci, "unknown"),
            "byLevel": [{"level": lvl, **(data or {})} for lvl, data in rows],
        })
    return records


def normalize_class(c, levels, features_by_index):
    class_index = c.get("index")
    class_levels = [
        lv for lv in levels
        if ref_index(lv.get("class")) == class_index and not lv.get("subclass")
    ]
    class_levels.sort(key=lambda x: x.get("level") or 0)
    progression = []
    for lv in class_levels:
        feats = []
        for f in (lv.get("features") or []):
            idx = ref_index(f)
            name = ref_name(f)
            desc = None
            if idx and idx in features_by_index:
                raw = features_by_index[idx]
                desc = raw.get("description") or raw.get("desc")
                if isinstance(desc, list):
                    desc = "\n".join(desc)
                name = name or raw.get("name")
            feats.append({"index": idx, "name": name, "description": desc})
        entry = {
            "level": lv.get("level"),
            "proficiencyBonus": lv.get("prof_bonus"),
            "features": feats,
            "classSpecific": convert(lv.get("class_specific")),
        }
        if lv.get("spellcasting"):
            entry["spellcasting"] = convert(lv.get("spellcasting"))
        progression.append(entry)
    return {
        "index": class_index,
        "name": c.get("name"),
        "hitDie": c.get("hit_die"),
        "primaryAbility": convert(c.get("primary_ability")),
        "savingThrows": [ref_index(s) for s in (c.get("saving_throws") or [])],
        "proficiencies": [
            {"index": ref_index(p), "name": ref_name(p)}
            for p in (c.get("proficiencies") or [])
            if not (ref_index(p) or "").startswith("saving-throw-")
        ],
        "proficiencyChoices": convert(c.get("proficiency_choices")),
        "startingEquipment": convert(c.get("starting_equipment")),
        "startingEquipmentOptions": convert(c.get("starting_equipment_options")),
        "subclasses": [{"index": ref_index(s), "name": ref_name(s)} for s in (c.get("subclasses") or [])],
        "multiclassing": convert(c.get("multi_classing")),
        "levels": progression,
    }


def normalize_magic_item(item):
    rec = convert(item)
    rarity = item.get("rarity")
    if isinstance(rarity, dict):
        rec["rarity"] = rarity.get("name") or rarity.get("index")
    desc = rec.get("desc") or rec.get("description")
    if isinstance(desc, list):
        rec["description"] = "\n".join(desc)
        rec.pop("desc", None)
    elif desc and "description" not in rec:
        rec["description"] = desc
        rec.pop("desc", None)
    return rec


def rule_text(rules, index):
    r = next((x for x in rules if x.get("index") == index), None)
    if not r:
        return None
    desc = r.get("desc") or r.get("description") or ""
    if isinstance(desc, list):
        desc = "\n".join(desc)
    return {"index": r.get("index"), "name": r.get("name"), "description": desc}


def split_markdown_sections(text: str):
    if not text:
        return [], ""
    parts = re.split(r"\n(?#{2,4} )", text)
    records = []
    preamble = []
    for part in parts:
        m = re.match(r"(#{2,4}) (.+)\n?", part)
        if not m:
            preamble.append(part)
            continue
        name = m.group(2).strip()
        body = part[m.end():].strip()
        records.append({
            "index": re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-"),
            "name": name,
            "description": body,
        })
    return records, "\n".join(preamble).strip()


def split_equipment(items, version):
    weapons, armor, packs, gear, tools = [], [], [], [], []
    for item in items:
        cats = category_indexes(item)
        if version == "5.2":
            is_weapon = "weapons" in cats
            is_armor = "armor" in cats or "shields" in cats
            is_pack = (
                "equipment-packs" in cats
                or (item.get("contents") and "pack" in (item.get("name") or "").lower())
            )
            is_tool = "tools" in cats
        else:
            is_weapon = "weapon" in cats or "weapons" in cats
            is_armor = "armor" in cats or "shields" in cats
            is_pack = "equipment-packs" in cats or (
                item.get("contents") and "pack" in (item.get("name") or "").lower()
            )
            is_tool = "tools" in cats or "tool" in cats
        if is_weapon:
            weapons.append(normalize_weapon(item, version))
        elif is_armor:
            armor.append(normalize_armor(item))
        elif is_pack:
            packs.append(convert(item))
        elif is_tool:
            tools.append(convert(item))
        else:
            gear.append(convert(item))
    return weapons, armor, packs, gear, tools


def build_52():
    print("Building SRD 5.2 (2024) tables...")
    weapons, armor, packs, gear, tools = split_equipment(load_src("2024", "Equipment"), "5.2")
    write_file("5.2/weapons.json", "5.2", "Weapons", weapons)
    write_file("5.2/armor.json", "5.2", "Armor and Shields", armor)
    write_file("5.2/weaponProperties.json", "5.2", "Weapon Properties",
               convert(load_src("2024", "Weapon-Properties")))
    write_file("5.2/weaponMasteryProperties.json", "5.2", "Weapon Mastery Properties",
               convert(load_src("2024", "Weapon-Mastery-Properties")))
    write_file("5.2/adventuringGear.json", "5.2", "Adventuring Gear", gear)
    write_file("5.2/equipmentPacks.json", "5.2", "Equipment Packs", packs)
    write_file("5.2/tools.json", "5.2", "Tools", tools)

    conditions = convert(load_src("2024", "Conditions"))
    write_file("5.2/conditions.json", "5.2", "Conditions", conditions)
    exhaustion = next((c for c in conditions if c.get("index") == "exhaustion"), {})
    write_file("5.2/exhaustion.json", "5.2", "Exhaustion", [{
        **exhaustion,
        "maxLevel": 6,
        "d20TestPenaltyPerLevel": 2,
        "speedReductionFeetPerLevel": 5,
        "deathAtLevel": 6,
        "recovery": "Finishing a Long Rest removes 1 Exhaustion level.",
    }], notes="2024 exhaustion uses cumulative numeric penalties, not the 2014 six-row effect table.")
    write_file("5.2/damageTypes.json", "5.2", "Damage Types", convert(load_src("2024", "Damage-Types")))
    write_file("5.2/actionsInCombat.json", "5.2", "Actions in Combat",
               load_curated("actionsInCombat.json"), extra_sources=[SOURCE_PDF_52], from_pdf=True)
    write_file("5.2/cover.json", "5.2", "Cover",
               load_curated("cover.json"), extra_sources=[SOURCE_PDF_52], from_pdf=True)
    write_file("5.2/deathSaves.json", "5.2", "Death Saving Throws",
               load_curated("deathSaves.json"), extra_sources=[SOURCE_PDF_52], from_pdf=True)

    adv = load_curated("characterAdvancement.json")
    write_file("5.2/characterAdvancement.json", "5.2", "Character Advancement",
               adv, extra_sources=[SOURCE_PDF_52], from_pdf=True)
    write_file("5.2/proficiencyBonusByLevel.json", "5.2", "Proficiency Bonus by Level",
               [{"level": r["level"], "proficiencyBonus": r["proficiencyBonus"]} for r in adv],
               extra_sources=[SOURCE_PDF_52], from_pdf=True)
    write_file("5.2/abilityModifiers.json", "5.2", "Ability Scores and Modifiers",
               build_ability_modifiers(), extra_sources=[SOURCE_PDF_52], from_pdf=True,
               notes="Printed SRD table covers scores 3-20. Other scores use the SRD formula (score - 10) / 2, rounded down.")
    write_file("5.2/abilityScorePointCosts.json", "5.2", "Ability Score Point Costs",
               load_curated("abilityScorePointCosts.json"), extra_sources=[SOURCE_PDF_52], from_pdf=True)
    write_file("5.2/difficultyClasses.json", "5.2", "Typical Difficulty Classes",
               load_curated("difficultyClasses.json"), extra_sources=[SOURCE_PDF_52], from_pdf=True)
    write_file("5.2/sizeCategories.json", "5.2", "Size Categories",
               load_curated("sizeCategories.json"), extra_sources=[SOURCE_PDF_52], from_pdf=True)
    write_file("5.2/encounterBudgets.json", "5.2", "XP Budget per Character (Encounter Difficulty)",
               load_curated("encounterBudgets.json"), extra_sources=[SOURCE_PDF_52], from_pdf=True,
               notes="Per-character XP budget. Multiply by party size for the encounter's total XP budget.")
    write_file("5.2/crToXp.json", "5.2", "Experience Points by Challenge Rating",
               load_curated("crToXp.json"), extra_sources=[SOURCE_PDF_52], from_pdf=True,
               notes="CR 11-13 XP values were taken from SRD 5.2 monster stat blocks because the two-column PDF table extract omitted those three rows. The 5e-srd-api Archmage stat block lists 8,000 XP at CR 12; the standard table value is 8,400.")
    write_file("5.2/objects.json", "5.2", "Object Armor Class and Hit Points", [{
        "armorClassBySubstance": load_curated("objectArmorClass.json"),
        "hitPointsBySize": load_curated("objectHitPoints.json"),
        "notes": "An object is destroyed at 0 Hit Points. For Huge or Gargantuan objects, divide into Large or smaller sections and track each section separately.",
    }], extra_sources=[SOURCE_PDF_52], from_pdf=True)

    spells = [normalize_spell(s) for s in load_src("2024", "Spells")]
    write_file("5.2/spells.json", "5.2", "Spells", spells)
    write_file("5.2/magicSchools.json", "5.2", "Magic Schools", convert(load_src("2024", "Magic-Schools")))
    cantrips = [c for c in (parse_cantrip_scaling(s) for s in spells if s.get("level") == 0) if c]
    write_file("5.2/cantripScaling.json", "5.2", "Cantrip Scaling", cantrips,
               notes="Parsed from each cantrip's Cantrip Upgrade text in SRD 5.2. Typical damage cantrips scale at character levels 5, 11, and 17.")

    levels = load_src("2024", "Levels")
    write_file("5.2/spellSlots.json", "5.2", "Spell Slots by Class and Level",
               build_spell_slots(levels),
               notes="Warlock uses Pact Magic: a small number of slots of a single level, shown in the same slots array (the non-zero slot level is the pact slot level).")
    features = {f["index"]: f for f in load_src("2024", "Features")}
    write_file("5.2/classes.json", "5.2", "Classes",
               [normalize_class(c, levels, features) for c in load_src("2024", "Classes")])
    write_file("5.2/subclasses.json", "5.2", "Subclasses", convert(load_src("2024", "Subclasses")))
    write_file("5.2/species.json", "5.2", "Species", convert(load_src("2024", "Species")))
    write_file("5.2/subspecies.json", "5.2", "Subspecies", convert(load_src("2024", "Subspecies")))
    write_file("5.2/backgrounds.json", "5.2", "Backgrounds",
               convert(load_src("2024", "Backgrounds")),
               notes="2024 backgrounds include ability score increases and an origin feat.")
    write_file("5.2/feats.json", "5.2", "Feats", convert(load_src("2024", "Feats")))
    write_file("5.2/skills.json", "5.2", "Skills", convert(load_src("2024", "Skills")))
    write_file("5.2/languages.json", "5.2", "Languages", convert(load_src("2024", "Languages")))
    write_file("5.2/abilityScores.json", "5.2", "Ability Scores", convert(load_src("2024", "Ability-Scores")))
    write_file("5.2/alignments.json", "5.2", "Alignments", convert(load_src("2024", "Alignments")))
    write_file("5.2/traits.json", "5.2", "Species Traits", convert(load_src("2024", "Traits")))
    write_file("5.2/monsters.json", "5.2", "Monster Stat Blocks", convert(load_src("2024", "Monsters")))
    write_file("5.2/magicItems.json", "5.2", "Magic Items",
               [normalize_magic_item(i) for i in load_src("2024", "Magic-Items")])
    write_file("5.2/poisons.json", "5.2", "Poisons", convert(load_src("2024", "Poisons")))
    write_file("5.2/traps.json", "5.2", "Traps (design guidance)",
               load_curated("trapsGuidance.json"), extra_sources=[SOURCE_PDF_52], from_pdf=True,
               notes="No random dungeon-generation tables. Named sample traps from SRD 5.1 are in 5.1/traps.json.")
    write_file("5.2/hazards.json", "5.2", "Hazards",
               load_curated("hazards.json"), extra_sources=[SOURCE_PDF_52], from_pdf=True,
               notes="Falling, Suffocation, and Malnutrition wording is taken from the SRD 5.2 Rules Glossary.")


def build_51():
    print("Building SRD 5.1 (2014) tables...")
    weapons, armor, packs, gear, tools = split_equipment(load_src("2014", "Equipment"), "5.1")
    write_file("5.1/weapons.json", "5.1", "Weapons", weapons)
    write_file("5.1/armor.json", "5.1", "Armor and Shields", armor)
    write_file("5.1/weaponProperties.json", "5.1", "Weapon Properties",
               convert(load_src("2014", "Weapon-Properties")))
    write_file("5.1/adventuringGear.json", "5.1", "Adventuring Gear", gear)
    write_file("5.1/equipmentPacks.json", "5.1", "Equipment Packs", packs)
    write_file("5.1/tools.json", "5.1", "Tools", tools)

    conditions = convert(load_src("2014", "Conditions"))
    write_file("5.1/conditions.json", "5.1", "Conditions", conditions)
    exh = next((c for c in conditions if c.get("index") == "exhaustion"), {})
    write_file("5.1/exhaustion.json", "5.1", "Exhaustion", [{
        **exh,
        "levels": [
            {"level": 1, "effect": "Disadvantage on ability checks"},
            {"level": 2, "effect": "Speed halved"},
            {"level": 3, "effect": "Disadvantage on attack rolls and saving throws"},
            {"level": 4, "effect": "Hit point maximum halved"},
            {"level": 5, "effect": "Speed reduced to 0"},
            {"level": 6, "effect": "Death"},
        ],
        "notes": "Effects are cumulative. Finishing a long rest reduces exhaustion by 1 level, provided the creature has also ingested some food and drink.",
    }])
    write_file("5.1/damageTypes.json", "5.1", "Damage Types", convert(load_src("2014", "Damage-Types")))

    rules = load_src("2014", "Rules")
    write_file("5.1/actionsInCombat.json", "5.1", "Actions in Combat",
               [x for x in (rule_text(rules, i) for i in ACTIONS_51_INDEXES) if x])
    cover = rule_text(rules, "cover")
    write_file("5.1/cover.json", "5.1", "Cover", [cover] if cover else [])
    write_file("5.1/deathSaves.json", "5.1", "Dropping to 0 Hit Points and Death Saving Throws",
               [x for x in (rule_text(rules, "dropping-to-0-hit-points"),
                            rule_text(rules, "knocking-a-creature-out")) if x])

    adv = load_curated("characterAdvancement.json")
    write_file("5.1/proficiencyBonusByLevel.json", "5.1", "Proficiency Bonus by Level",
               [{"level": r["level"], "proficiencyBonus": r["proficiencyBonus"]} for r in adv],
               extra_sources=[SOURCE_PDF_51], from_pdf=True,
               notes="Same +2 to +6 cadence as 2024; confirmed against SRD 5.1 class/advancement tables.")
    write_file("5.1/characterAdvancement.json", "5.1", "Character Advancement",
               adv, extra_sources=[SOURCE_PDF_51], from_pdf=True,
               notes="XP thresholds match the Character Advancement table shared by SRD 5.1 and 5.2.")
    write_file("5.1/abilityModifiers.json", "5.1", "Ability Scores and Modifiers",
               build_ability_modifiers(), extra_sources=[SOURCE_PDF_51], from_pdf=True)
    dc = rule_text(rules, "typical-difficulty-classes")
    write_file("5.1/difficultyClasses.json", "5.1", "Typical Difficulty Classes",
               [dc] if dc else load_curated("difficultyClasses.json"))
    size = rule_text(rules, "creature-size")
    write_file("5.1/sizeCategories.json", "5.1", "Creature Size",
               [size] if size else load_curated("sizeCategories.json"))

    standard = {r["challengeRating"]: r["xp"] for r in load_curated("crToXp.json")}
    seen = {}
    for m in load_src("2014", "Monsters"):
        cr, xp = m.get("challenge_rating"), m.get("xp")
        if cr is None or xp is None:
            continue
        seen.setdefault(str(cr), set()).add(xp)
    alias = {"0.125": "1/8", "0.25": "1/4", "0.5": "1/2"}
    cr_rows = []
    for key in ["0", "0.125", "0.25", "0.5"] + [str(i) for i in range(1, 31)]:
        if key not in seen:
            continue
        label = alias.get(key, key)
        xps = sorted(seen[key])
        rec = {
            "challengeRating": label,
            "xpValuesInStatBlocks": xps,
            "xp": standard.get(label, xps[-1] if xps else None),
        }
        if len(xps) > 1:
            rec["notes"] = f"Some SRD 5.1 stat blocks list {xps}; the standard table value is {rec['xp']}."
        cr_rows.append(rec)
    write_file("5.1/crToXp.json", "5.1", "Challenge Rating to XP (derived from monster stat blocks)",
               cr_rows,
               notes="SRD 5.1 has no standalone extractable CR-to-XP table; values are derived from official SRD monster XP. The 2014 DMG easy/medium/hard/deadly XP-threshold table and the multiple-monster encounter multipliers are not in the SRD and are omitted.")

    spells = [normalize_spell(s) for s in load_src("2014", "Spells")]
    write_file("5.1/spells.json", "5.1", "Spells", spells)
    write_file("5.1/magicSchools.json", "5.1", "Magic Schools", convert(load_src("2014", "Magic-Schools")))
    cantrips = [c for c in (parse_cantrip_scaling(s) for s in spells if s.get("level") == 0) if c]
    write_file("5.1/cantripScaling.json", "5.1", "Cantrip Scaling", cantrips)

    levels = load_src("2014", "Levels")
    write_file("5.1/spellSlots.json", "5.1", "Spell Slots by Class and Level",
               build_spell_slots(levels),
               notes="Includes full casters, half casters (Paladin, Ranger), and Warlock pact slots. Eldritch Knight and Arcane Trickster third-caster slots may be on subclass level entries and absent here.")
    features = {f["index"]: f for f in load_src("2014", "Features")}
    write_file("5.1/classes.json", "5.1", "Classes",
               [normalize_class(c, levels, features) for c in load_src("2014", "Classes")])
    write_file("5.1/subclasses.json", "5.1", "Subclasses", convert(load_src("2014", "Subclasses")))
    write_file("5.1/races.json", "5.1", "Races", convert(load_src("2014", "Races")))
    write_file("5.1/subraces.json", "5.1", "Subraces", convert(load_src("2014", "Subraces")))
    write_file("5.1/backgrounds.json", "5.1", "Backgrounds",
               convert(load_src("2014", "Backgrounds")),
               notes="SRD 5.1 includes only the Acolyte background.")
    write_file("5.1/feats.json", "5.1", "Feats",
               convert(load_src("2014", "Feats")),
               notes="SRD 5.1 includes only the Grappler feat.")
    write_file("5.1/skills.json", "5.1", "Skills", convert(load_src("2014", "Skills")))
    write_file("5.1/languages.json", "5.1", "Languages", convert(load_src("2014", "Languages")))
    write_file("5.1/abilityScores.json", "5.1", "Ability Scores", convert(load_src("2014", "Ability-Scores")))
    write_file("5.1/alignments.json", "5.1", "Alignments", convert(load_src("2014", "Alignments")))
    write_file("5.1/traits.json", "5.1", "Racial Traits", convert(load_src("2014", "Traits")))
    write_file("5.1/monsters.json", "5.1", "Monster Stat Blocks", convert(load_src("2014", "Monsters")))
    write_file("5.1/magicItems.json", "5.1", "Magic Items",
               [normalize_magic_item(i) for i in load_src("2014", "Magic-Items")])

    trap_rule = rule_text(rules, "traps")
    traps_in_play = rule_text(rules, "traps-in-play")
    sample = rule_text(rules, "sample-traps")
    sample_records = []
    if sample:
        recs, preamble = split_markdown_sections(sample["description"])
        sample_records = recs
        if preamble:
            sample_records.insert(0, {"index": "sample-traps-intro", "name": "Sample Traps", "description": preamble})
    write_file("5.1/traps.json", "5.1", "Traps and Sample Traps",
               [x for x in (trap_rule, traps_in_play) if x] + sample_records,
               notes="Named sample traps from SRD 5.1. The DMG Appendix A random dungeon generator is not SRD and is not included.")
    env = [rule_text(rules, i) for i in (
        "the-environment", "falling", "suffocating", "vision-and-light",
        "food-and-water", "difficult-terrain", "interacting-with-objects",
    )]
    write_file("5.1/environment.json", "5.1", "The Environment", [x for x in env if x])
    obj_rules = [rule_text(rules, i) for i in ("objects", "statistics-for-objects", "interacting-with-objects")]
    write_file("5.1/objects.json", "5.1", "Objects", [x for x in obj_rules if x])
    extra = [
        "combat-step-by-step", "initiative", "your-turn", "reactions",
        "making-an-attack", "attack-rolls", "damage-and-healing",
        "damage-rolls", "damage-resistance-and-vulnerability",
        "underwater-combat", "mounted-combat", "short-rest", "long-rest",
        "spell-slots", "cantrips", "proficiency-bonus",
    ]
    write_file("5.1/combatRules.json", "5.1", "Additional Combat and Adventuring Rules",
               [x for x in (rule_text(rules, i) for i in extra) if x])


def get_records(relpath):
    data = json.loads((OUT / relpath).read_text())
    return data["meta"], data["records"]


def find_rec(records, **preds):
    for r in records:
        if all(r.get(k) == v for k, v in preds.items()):
            return r
    return None


def validate():
    issues = []
    for p in sorted(OUT.rglob("*.json")):
        try:
            json.loads(p.read_text())
        except Exception as e:
            issues.append(f"INVALID JSON {p}: {e}")

    _, spells = get_records("5.2/spells.json")
    fb = find_rec(spells, index="fireball") or find_rec(spells, name="Fireball")
    if not fb:
        issues.append("Fireball missing from 5.2/spells.json")
    else:
        if fb.get("level") != 3:
            issues.append(f"Fireball level {fb.get('level')} != 3")
        dmg = (fb.get("damage") or {}).get("damageAtSlotLevel") or {}
        if str(dmg.get("3") or dmg.get(3) or "") != "8d6":
            issues.append(f"Fireball damage {dmg} expected 8d6 at slot 3")
        if (fb.get("school") or "").lower() != "evocation":
            issues.append(f"Fireball school {fb.get('school')}")
        desc = fb.get("description") or ""
        if "Dexterity" not in desc or "8d6" not in desc:
            issues.append("Fireball description missing Dexterity save or 8d6")

    _, weps = get_records("5.2/weapons.json")
    lw = find_rec(weps, index="longsword") or find_rec(weps, name="Longsword")
    if not lw:
        issues.append("Longsword missing")
    else:
        dice = (lw.get("damage") or {}).get("damageDice")
        typ = ref_index((lw.get("damage") or {}).get("damageType"))
        if dice != "1d8":
            issues.append(f"Longsword damage {dice} != 1d8")
        if typ != "slashing":
            issues.append(f"Longsword type {typ} != slashing")
        th = (lw.get("twoHandedDamage") or {}).get("damageDice")
        if th != "1d10":
            issues.append(f"Longsword two-handed {th} != 1d10")
        if lw.get("mastery") != "sap":
            issues.append(f"Longsword mastery {lw.get('mastery')} != sap")
        if "versatile" not in (lw.get("properties") or []):
            issues.append(f"Longsword properties missing versatile: {lw.get('properties')}")

    _, mons52 = get_records("5.2/monsters.json")
    gob = find_rec(mons52, index="goblin-warrior") or find_rec(mons52, name="Goblin Warrior")
    if not gob:
        issues.append("Goblin Warrior missing from 5.2 monsters")
    else:
        cr = gob.get("challengeRating")
        if cr not in (0.25, "0.25", 1 / 4):
            issues.append(f"Goblin Warrior CR {cr}")

    _, mons51 = get_records("5.1/monsters.json")
    gob14 = find_rec(mons51, index="goblin") or find_rec(mons51, name="Goblin")
    if not gob14:
        issues.append("Goblin missing from 5.1 monsters")
    else:
        if gob14.get("challengeRating") not in (0.25, "0.25"):
            issues.append(f"2014 Goblin CR {gob14.get('challengeRating')} != 1/4")

    _, classes = get_records("5.2/classes.json")
    fighter = find_rec(classes, index="fighter") or find_rec(classes, name="Fighter")
    if not fighter:
        issues.append("Fighter missing")
    else:
        if fighter.get("hitDie") != 10:
            issues.append(f"Fighter hit die {fighter.get('hitDie')} != 10")
        saves = {s.lower() for s in (fighter.get("savingThrows") or [])}
        if not {"str", "con"}.issubset(saves) and not {"strength", "constitution"}.issubset(saves):
            issues.append(f"Fighter saves {saves}")
        lvls = fighter.get("levels") or []
        if len(lvls) != 20:
            issues.append(f"Fighter levels {len(lvls)} != 20")
        pb1 = lvls[0].get("proficiencyBonus") if lvls else None
        pb5 = next((l.get("proficiencyBonus") for l in lvls if l.get("level") == 5), None)
        if pb1 != 2 or pb5 != 3:
            issues.append(f"Fighter prof bonus L1={pb1} L5={pb5}")

    if issues:
        print("SPOT-CHECK ISSUES:")
        for i in issues:
            print("  -", i)
    else:
        print("All JSON valid. Spot-checks passed: Fireball, Longsword, Goblin/Goblin Warrior, Fighter.")
    return issues


def write_readme(issues):
    lines = [
        "# SRD Rules Tables for The Dungeon Door",
        "",
        "Normalized, camelCase JSON built from openly licensed D&D 5e System Reference Documents.",
        "Prefer the `5.2/` folder (2024 rules) for the game's rules engine; `5.1/` is the 2014 SRD.",
        "",
        "Fetched: 2026-11-25.",
        "",
        "Structured source: [5e-bits/5e-srd-api](https://github.com/5e-bits/5e-srd-api) "
        "`packages/5e-database/src/{2014,2024}/en` (community JSON of the SRD).",
        "",
        "Official PDFs used for tables and rules text not present as standalone collections:",
        "",
        f"- SRD 5.2: {SOURCE_PDF_52}",
        f"- SRD 5.1: {SOURCE_PDF_51}",
        "",
        "The 5e-database project is MIT-licensed; the underlying game content is CC-BY-4.0 SRD.",
        "Rebuild with `python3 server/scripts/build_srd_data.py` from the repo root (writes to `server/data/srd/`, reads curated tables from `server/scripts/curated/`; the 5e-srd-api sources are expected at `/tmp/5e-srd-src`).",
        "",
        "## Attribution",
        "",
        "### SRD 5.2",
        "",
        ATTR_52,
        "",
        "### SRD 5.1",
        "",
        ATTR_51,
        "",
        "## Files",
        "",
        "| File | Records | Version | Source |",
        "| --- | ---: | --- | --- |",
    ]
    for item in MANIFEST:
        src = "SRD PDF" if "dndbeyond.com" in item["source"] or "wizards.com" in item["source"] and "srd" in item["source"].lower() and "github" not in item["source"] else (
            "official PDF" if "media.dndbeyond.com" in item["source"] or "media.wizards.com" in item["source"] else "5e-srd-api"
        )
        if "compendium-images/srd" in item["source"] or "downloads/dnd/SRD_CC" in item["source"]:
            src = "official PDF"
        lines.append(f"| `{item['file']}` | {item['recordCount']} | {item['version']} | {src} |")

    extras_dir = OUT / "extras"
    if extras_dir.exists():
        lines += [
            "",
            "## Extras (open-licensed equivalents and originals)",
            "",
            "Open-licensed stand-ins for tables that are not in the SRD, plus original CC0 procedures authored for The Dungeon Door. Each JSON file has `meta.license`, `meta.attribution`, and `meta.sourceUrl`. The 2014 DMG and 1e AD&D Appendix A were not used as sources.",
            "",
            "| File | Records | License | Role |",
            "| --- | ---: | --- | --- |",
        ]
        for path in sorted(extras_dir.glob("*.json")):
            data = json.loads(path.read_text())
            meta = data.get("meta", {})
            lines.append(
                f"| `extras/{path.name}` | {meta.get('recordCount', len(data.get('records', [])))} | "
                f"{meta.get('license', '?')} | {meta.get('title', path.stem)} |"
            )
        lines.append("| `extras/OGL-LICENSE.md` | — | OGL 1.0a | Full license and Section 15 for the Pathfinder wealth table |")

    lines += [
        "",
        "## Gaps and notes",
        "",
        "- **2014 encounter XP thresholds** (easy / medium / hard / deadly) are from the Dungeon Master's Guide, not SRD 5.1, and are not reproduced here. Open equivalent: `extras/encounterDifficultyA5e.json` (A5ESRD, CC-BY-4.0) uses total-CR ratios for the same four bands plus Impossible. Official 2024 budgets remain in `5.2/encounterBudgets.json`.",
        "- **2014 multiple-monster encounter multipliers** are also DMG-only and are not reproduced. A5E handles action economy by summing CRs (and doubling elites). Optional original band-shift rule: `extras/actionEconomyBands.json` (CC0).",
        "- **2014 starting-wealth (random GP) table** is not in the SRD and is not reproduced. Open stand-ins: `extras/startingWealthSrd52.json` (SRD 5.2 buyout gold), `extras/startingWealthA5e.json` (A5E fixed gold, CC-BY-4.0), `extras/startingWealthPathfinder.json` (PF1 random dice, OGL 1.0a), and an original fortune die around the SRD 5.2 amounts in `extras/startingWealthRandom.json` (CC0).",
        "- **DMG Appendix A random dungeon tables** (and the 1e AD&D Appendix A) are not open and were not copied. Open stocking: `extras/oseDungeonStocking.json` (OSE SRD, CC-BY-4.0 / OGL). Original 5e graph procedure for this game: `extras/dungeonGenerator.json` (CC0), which points at SRD 5.1 sample traps and SRD 5.2 hazards. The Basic Fantasy 'Dungeon Generator' supplement is OGL 1.0a but could not be fetched in full (HTTP 403). donjon's generator is CC-BY-NC and was skipped.",
        "- **2024 SRD has no creature named Goblin.** Use `goblin-warrior`, `goblin-minion`, or `goblin-boss`. The 2014 file has `goblin`.",
        "- **CR 11-13** in `5.2/crToXp.json` were filled from SRD 5.2 monster XP because those rows were not visible in the two-column PDF extract. The Archmage stat block lists 8,000 XP at CR 12 versus the table value 8,400.",
        "- Some 2014 monster stat blocks disagree with the standard CR-to-XP mapping; see notes in `5.1/crToXp.json`.",
        "- **2024 backgrounds in the SRD:** Acolyte, Criminal, Sage, Soldier (each with ability increases and an origin feat). **2014 SRD:** Acolyte only.",
        "- **2024 feats:** 17 SRD feats. **2014 SRD:** Grappler only.",
        "- Hazard wording for Falling, Suffocation, and Malnutrition should be double-checked against the PDF if used in a rules engine; two-column extraction can drop a clause.",
        "- A later SRD 5.2.1 exists on D&D Beyond (May 2025). This dataset uses the official SRD 5.2 PDF dated April 22, 2025, plus 5e-srd-api 2024 JSON fetched 2026-11-25.",
        "",
        "## Validation",
        "",
    ]
    if issues:
        lines.append("Spot-check issues:")
        for i in issues:
            lines.append(f"- {i}")
    else:
        lines.append("Every file parses as JSON. Spot-checks passed for Fireball (3rd-level Evocation, 8d6 Fire, Dexterity save), Longsword (1d8 slashing, versatile 1d10, mastery Sap), Goblin / Goblin Warrior, and Fighter (d10, Str/Con saves, proficiency +2/+3).")
    lines.append("")
    (OUT / "README.md").write_text("\n".join(lines))
    print("wrote README.md")


def build_extras():
    """Copy curated open/original extras and regenerate the SRD 5.2 gold extract."""
    print("Building extras...")
    src = CURATED / "extras"
    dest = OUT / "extras"
    dest.mkdir(parents=True, exist_ok=True)
    if src.exists():
        for path in src.iterdir():
            if path.is_file():
                shutil.copy2(path, dest / path.name)
                print(f"  copied extras/{path.name}")
    # startingWealthSrd52 is already produced into curated or dest by a prior run;
    # refresh it from current 5.2 class data if present.
    classes_path = OUT / "5.2" / "classes.json"
    if classes_path.exists():
        classes = json.loads(classes_path.read_text())["records"]

        def walk(obj, acc=None):
            if acc is None:
                acc = []
            if isinstance(obj, dict):
                if obj.get("optionType") == "money" or obj.get("option_type") == "money":
                    acc.append(obj)
                for v in obj.values():
                    walk(v, acc)
            elif isinstance(obj, list):
                for v in obj:
                    walk(v, acc)
            return acc

        records = []
        for c in classes:
            monies = walk(c.get("startingEquipmentOptions") or [])
            gp = sorted({m["count"] for m in monies if m.get("unit") == "gp" and isinstance(m.get("count"), (int, float))})
            if not gp:
                continue
            records.append({
                "index": c["index"],
                "name": c["name"],
                "kitLeftoverGoldGp": gp[0] if len(gp) > 1 else None,
                "buyoutGoldGp": gp[-1],
                "allGoldOptionsGp": gp,
                "notes": "The larger amount is the SRD 5.2 option to forgo the packaged starting kit and buy equipment with gold.",
            })
        write_file(
            "extras/startingWealthSrd52.json",
            "5.2",
            "SRD 5.2 Starting Gold Options by Class",
            records,
            notes="Convenience extract of gold amounts in 5.2/classes.json starting equipment options.",
        )
    # Ensure extras JSON still parse.
    for path in dest.glob("*.json"):
        json.loads(path.read_text())


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    build_52()
    build_51()
    build_extras()
    print("Validating JSON and spot-checking...")
    issues = validate()
    write_readme(issues)
    return issues


if __name__ == "__main__":
    issues = main()
    sys.exit(1 if issues else 0)
