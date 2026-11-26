/** Test helper: heroes leveled the simple way. */
import { ABILITIES } from './abilities.ts';
import { type LevelUpChoices, levelUp } from './leveling.ts';
import { seededRng } from './rng.ts';
import type { CharacterSheet } from './sheet.ts';
import { srd } from './srd.ts';

const milestone = { advancement: 'milestone' as const };

/** Level a hero up to `level` by milestones, taking the class's first subclass and +1 to its two lowest scores. */
export function climb(sheet: CharacterSheet, level: number): CharacterSheet {
  while (sheet.level < level) {
    const next = srd().classes.get(sheet.classId)!.levels[sheet.level];
    const choices: LevelUpChoices = { hp: 'average' };
    if (sheet.level + 1 === srd().classes.get(sheet.classId)!.subclassLevel) choices.subclassId = srd().classes.get(sheet.classId)!.subclasses[0];
    if (next.features.some((f) => f.id.endsWith('-ability-score-improvement') || f.id.endsWith('-epic-boon'))) {
      const [a, b] = [...ABILITIES].sort((x, y) => sheet.abilityScores[x] - sheet.abilityScores[y]);
      choices.improvement = { kind: 'abilityScores', increases: { [a]: 1, [b]: 1 } };
    }
    sheet = levelUp(sheet, choices, seededRng(sheet.level), milestone);
  }
  return sheet;
}
