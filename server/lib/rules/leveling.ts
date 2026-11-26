/**
 * Leveling: XP awards, the SRD 5.2 thresholds, and level-up (hit points, proficiency bonus, class and
 * subclass features, the subclass, Ability Score Improvements and feats). See docs/rules-design.md.
 */
import { ABILITIES, type Ability, type AbilityScores } from './abilities.ts';
import { rederive } from './character.ts';
import { xpForCr } from './monsters.ts';
import type { Rng } from './rng.ts';
import { type CharacterSheet, MAX_LEVEL, parseCharacterSheet } from './sheet.ts';
import { type Srd, type SrdClass, type SrdFeat, srd as bundledSrd } from './srd.ts';
import { lookup, require } from './violation.ts';

export type Improvement =
  /** The Ability Score Improvement feat: +2 to one score or +1 to two, to at most 20. */
  | { kind: 'abilityScores'; increases: Partial<Record<Ability, number>> }
  /** Another feat the hero qualifies for, with the score its +1 goes to (when it grants one). */
  | { kind: 'feat'; featId: string; increase?: Ability };

export interface LevelUpChoices {
  /** The hit die's fixed value (die / 2 + 1) or a roll of it. */
  hp: 'average' | 'roll';
  /** Required at the class's subclass level, and only then. */
  subclassId?: string;
  /** Required at a level that brings an Ability Score Improvement or Epic Boon, and only then. */
  improvement?: Improvement;
}

/** XP: the hero levels when its XP reaches the next threshold. Milestone: the DM says when. */
export interface LevelUpOptions { advancement?: 'xp' | 'milestone' }

const ASI_LIMIT = 20;
const ASI_POINTS = 2;
const IMPROVEMENT_FEATURES = ['-ability-score-improvement', '-epic-boon'];
const EPIC_BOON = '-epic-boon';

const thresholdOf = (level: number, data: Srd) => data.advancement[level - 1].xp;

/** The level an XP total has reached. */
export function levelForXp(xp: number, data: Srd = bundledSrd()): number {
  return data.advancement.filter((a) => a.xp <= xp).length;
}

/** What a group of monsters is worth, by challenge rating. */
export const encounterXp = (crs: readonly number[]): number => crs.reduce((sum, cr) => sum + xpForCr(cr), 0);

/** Each hero's share of an award; the remainder is lost. */
export function splitXp(total: number, heroes: number): number {
  require(heroes >= 1, 'XP is split among at least one hero');
  return Math.floor(total / heroes);
}

export function awardXp(sheet: CharacterSheet, xp: number): CharacterSheet {
  require(xp >= 0, 'XP awards cannot be negative');
  return { ...sheet, xp: sheet.xp + xp };
}

/** Whether the hero's XP has reached its next level (never past 20: the table ends there). */
export const canLevelUp = (sheet: CharacterSheet, data: Srd = bundledSrd()): boolean => levelForXp(sheet.xp, data) > sheet.level;

function hitDie(choice: LevelUpChoices['hp'], die: number, rng: Rng): number {
  return choice === 'roll' ? rng.die(die) : die / 2 + 1;
}

function subclassFor(cls: SrdClass, level: number, sheet: CharacterSheet, chosen: string | undefined): string | null {
  if (level !== cls.subclassLevel) {
    require(chosen === undefined, `a ${cls.name} chooses a subclass at level ${cls.subclassLevel}`);
    return sheet.subclassId;
  }
  require(chosen !== undefined, `choose a ${cls.name} subclass: ${cls.subclasses.join(', ')}`);
  require(cls.subclasses.includes(chosen), `${chosen} is not a ${cls.name} subclass`);
  return chosen;
}

function raise(scores: AbilityScores, ability: Ability, by: number, max: number): AbilityScores {
  require(scores[ability] + by <= max, `${ability} cannot go above ${max}`);
  return { ...scores, [ability]: scores[ability] + by };
}

function abilityScoreImprovement(scores: AbilityScores, increases: Partial<Record<Ability, number>>): AbilityScores {
  const raised = ABILITIES.filter((a) => increases[a] !== undefined);
  const amounts = raised.map((a) => increases[a]!);
  const valid = amounts.reduce((sum, n) => sum + n, 0) === ASI_POINTS && amounts.every((n) => n >= 1);
  require(valid, 'an Ability Score Improvement is +2 to one score or +1 to two');
  return raised.reduce((s, a) => raise(s, a, increases[a]!, ASI_LIMIT), scores);
}

/** The feats open at a level: general feats at an ASI level, and epic boons too at an Epic Boon level. */
function featAllowed(feat: SrdFeat, epic: boolean, level: number): boolean {
  const types = epic ? ['general', 'epic-boon'] : ['general'];
  return types.includes(feat.type) && feat.minLevel <= level && feat.id !== 'ability-score-improvement';
}

function takeFeat(sheet: CharacterSheet, choice: Extract<Improvement, { kind: 'feat' }>, epic: boolean, level: number, data: Srd): CharacterSheet {
  const feat = lookup(data.feats, choice.featId, 'feat');
  require(featAllowed(feat, epic, level), `${feat.name} is not a feat you can take at level ${level}`);
  require(!sheet.feats.includes(feat.id), `${sheet.name} already has ${feat.name}`);
  const pre = feat.prerequisite;
  require(!pre || pre.abilities.some((a) => sheet.abilityScores[a] >= pre.minimum), `${feat.name} needs ${pre?.abilities.join(' or ')} ${pre?.minimum}`);
  require(!feat.needsSpellcasting || sheet.spellcasting !== null, `${feat.name} needs Spellcasting`);
  const increase = feat.increase;
  if (!increase) return { ...sheet, feats: [...sheet.feats, feat.id] };
  require(choice.increase !== undefined && increase.from.includes(choice.increase), `${feat.name} raises ${increase.from.join(' or ')}`);
  return { ...sheet, feats: [...sheet.feats, feat.id], abilityScores: raise(sheet.abilityScores, choice.increase, 1, increase.max) };
}

function improve(sheet: CharacterSheet, cls: SrdClass, level: number, improvement: Improvement | undefined, data: Srd): CharacterSheet {
  const features = cls.levels[level - 1].features;
  const due = features.some((f) => IMPROVEMENT_FEATURES.some((suffix) => f.id.endsWith(suffix)));
  if (!due) {
    require(improvement === undefined, `level ${level} brings no Ability Score Improvement`);
    return sheet;
  }
  require(improvement !== undefined, `level ${level} brings an Ability Score Improvement or a feat`);
  if (improvement.kind === 'abilityScores') return { ...sheet, abilityScores: abilityScoreImprovement(sheet.abilityScores, improvement.increases) };
  return takeFeat(sheet, improvement, features.some((f) => f.id.endsWith(EPIC_BOON)), level, data);
}

function featuresAt(cls: SrdClass, subclassId: string | null, level: number, data: Srd): string[] {
  const subclass = subclassId ? data.subclasses.get(subclassId)!.features.filter((f) => f.level === level) : [];
  return [...cls.levels[level - 1].features, ...subclass].map((f) => f.name);
}

/**
 * Takes a hero up one level. With XP advancement (the default) its XP must have reached the threshold;
 * with milestones its XP is raised to it. The hero gains the new hit points without healing the rest.
 */
export function levelUp(sheet: CharacterSheet, choices: LevelUpChoices, rng: Rng, options: LevelUpOptions = {}, data: Srd = bundledSrd()): CharacterSheet {
  const level = sheet.level + 1;
  require(sheet.level < MAX_LEVEL, `${sheet.name} is already level ${MAX_LEVEL}`);
  const threshold = thresholdOf(level, data);
  require(options.advancement === 'milestone' || sheet.xp >= threshold, `${sheet.name} needs ${threshold} XP to reach level ${level}`);
  const cls = data.classes.get(sheet.classId)!;
  const subclassId = subclassFor(cls, level, sheet, choices.subclassId);
  const improved = improve(sheet, cls, level, choices.improvement, data);
  const next = rederive({
    ...improved, level, subclassId, xp: Math.max(sheet.xp, threshold),
    hpRolls: [...sheet.hpRolls, hitDie(choices.hp, cls.hitDie, rng)],
    features: [...sheet.features, ...featuresAt(cls, subclassId, level, data)],
  }, data);
  return parseCharacterSheet({ ...next, hp: sheet.hp + next.maxHp - sheet.maxHp });
}
