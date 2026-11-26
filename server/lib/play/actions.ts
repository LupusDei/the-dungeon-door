/**
 * The third combat choice, as the moment calls for it (5.2 actions): a hero held by a Restrained or Grappled
 * it must escape spends its action to Break Free (its escape check); one beside a dying friend takes the Help
 * action to stabilize them (a Healer's Kit, or a DC 10 Wisdom (Medicine) check); anyone else Dodges.
 */
import { abilityCheck } from '../rules/checks.ts';
import type { Combatant } from '../rules/combatant.ts';
import { conditionsOf, type TimedCondition, withoutCondition } from '../rules/conditions.ts';
import { type Rng, seededRng } from '../rules/rng.ts';
import type { Action, CombatState } from '../rules/scene.ts';
import type { CharacterSheet } from '../rules/sheet.ts';

type Escape = Extract<TimedCondition['until'], { kind: 'escape' }>;
export type Third =
  | { kind: 'break-free'; condition: TimedCondition['condition']; until: Escape }
  | { kind: 'stabilize'; target: string }
  | { kind: 'dodge' };

export const STABILIZE_DC = 10;
const title = (s: string) => s[0].toUpperCase() + s.slice(1);
const titled = (skill: string) => skill.split('-').map(title).join(' ');
const hasKit = (sheet: CharacterSheet) => sheet.equipment.some((e) => e.id === 'healers-kit');

/** What the third choice does for this hero now. */
export function thirdChoice(combat: CombatState, sheet: CharacterSheet, id: string): Third {
  const held = conditionsOf(sheet).find((c) => c.until.kind === 'escape');
  if (held) return { kind: 'break-free', condition: held.condition, until: held.until as Escape };
  const dying = Object.values(combat.combatants).find((c) => c.side === 'party' && c.id !== id && c.status === 'dying');
  return dying ? { kind: 'stabilize', target: dying.id } : { kind: 'dodge' };
}

/** The choice as the player reads it; Dodge's own words otherwise. */
export function thirdWords(third: Third, combat: CombatState, sheet: CharacterSheet, dodge: { label: string; detail: string }): { label: string; detail: string } {
  if (third.kind === 'break-free') {
    const { ability, skill, dc } = third.until;
    return { label: 'Break Free', detail: `Spend your action to escape being ${title(third.condition)}: ${titled(skill)} (${ability.toUpperCase()}) check against DC ${dc}.` };
  }
  if (third.kind === 'stabilize') {
    const how = hasKit(sheet) ? 'with your Healer\u2019s Kit' : `a DC ${STABILIZE_DC} Wisdom (Medicine) check`;
    return { label: `Help ${combat.combatants[third.target].name}`, detail: `Stabilize them before they die: ${how}.` };
  }
  return dodge;
}

const updated = (combat: CombatState, rng: Rng, ...changed: Combatant[]): CombatState =>
  ({ ...combat, rng: rng.state(), combatants: { ...combat.combatants, ...Object.fromEntries(changed.map((c) => [c.id, c])) } });

function breakFree(combat: CombatState, sheet: CharacterSheet, id: string, third: Extract<Third, { kind: 'break-free' }>) {
  const rng = seededRng(combat.rng);
  const { ability, skill, dc } = third.until;
  const total = abilityCheck(rng, sheet, { ability, skill }).total;
  const roll = `(${titled(skill)} ${total} vs DC ${dc})`;
  if (total < dc) return { combat: updated(combat, rng), sheet, text: `${sheet.name} strains against being ${title(third.condition)} but cannot break free ${roll}.` };
  const me = combat.combatants[id];
  const free = { ...me, conditions: me.conditions.filter((c) => c !== third.condition), carried: (me.carried ?? []).filter((c) => c !== third.condition) };
  return { combat: updated(combat, rng, free), sheet: withoutCondition(sheet, third.condition), text: `${sheet.name} breaks free ${roll}.` };
}

function stabilize(combat: CombatState, sheet: CharacterSheet, third: Extract<Third, { kind: 'stabilize' }>) {
  const rng = seededRng(combat.rng);
  const friend = combat.combatants[third.target];
  const total = hasKit(sheet) ? null : abilityCheck(rng, sheet, { ability: 'wis', skill: 'medicine' }).total;
  const how = total === null ? 'with a Healer\u2019s Kit' : `(Medicine ${total} vs DC ${STABILIZE_DC})`;
  if (total !== null && total < STABILIZE_DC) return { combat: updated(combat, rng), sheet, text: `${sheet.name} tries to stabilize ${friend.name} ${how}, but cannot.` };
  const stable: Combatant = { ...friend, status: 'stable', deathSaves: { successes: 0, failures: 0 } };
  return { combat: updated(combat, rng, stable), sheet, text: `${sheet.name} stabilizes ${friend.name} ${how}.` };
}

/** The third choice taken: Dodge, or the check made now and told; either way it is the hero's action. */
export function takeThird(combat: CombatState, sheet: CharacterSheet, id: string): { action: Action; combat: CombatState; sheet: CharacterSheet } {
  const third = thirdChoice(combat, sheet, id);
  if (third.kind === 'dodge') return { action: { kind: 'dodge' }, combat, sheet };
  const done = third.kind === 'break-free' ? breakFree(combat, sheet, id, third) : stabilize(combat, sheet, third);
  return { action: { kind: 'other', text: done.text }, combat: done.combat, sheet: done.sheet };
}
