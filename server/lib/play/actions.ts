/**
 * The third combat choice, as the moment calls for it (5.2 actions): a hero held by a Restrained or Grappled
 * it must escape spends its action to Break Free (its escape check); one beside a dying friend takes the Help
 * action to stabilize them (a Healer's Kit, or a DC 10 Wisdom (Medicine) check); anyone else Dodges.
 */
import { ABILITIES, type Ability } from '../rules/abilities.ts';
import { abilityCheck } from '../rules/checks.ts';
import type { Combatant } from '../rules/combatant.ts';
import { conditionsOf, type TimedCondition, withoutCondition } from '../rules/conditions.ts';
import { parseDice, rollDice } from '../rules/dice.ts';
import { DAMAGE_TYPES } from '../rules/monsters.ts';
import { addCondition, damageAfterDefenses, type Mode, savingThrow, takeDamage } from '../rules/resolve.ts';
import { type Rng, seededRng } from '../rules/rng.ts';
import type { Action, CombatState } from '../rules/scene.ts';
import { srd } from '../rules/srd.ts';
import type { CharacterSheet } from '../rules/sheet.ts';
import { CHOICE_IDS, type ChoiceId } from '../types.ts';
import { signed } from './checks.ts';
import { ABILITY_NAMES, SAVE_CONDITIONS, titleCase, type SaveCondition } from './hooks.ts';

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

// ---- a player writes their own action (docs/rules-design.md, "Freeform turns") ----

/** 5e DCs. The DM names a tier; this is the only place a written check gets its DC. */
export const DC_BY_TIER = { easy: 10, medium: 15, hard: 20 } as const;
export type Tier = keyof typeof DC_BY_TIER;

/** Original improvised damage. The DM names a severity; these are the only dice. */
export const DAMAGE_BY_SEVERITY = { light: '1d6', moderate: '2d6', severe: '4d6' } as const;
export type Severity = keyof typeof DAMAGE_BY_SEVERITY;

const TIERS = Object.keys(DC_BY_TIER) as Tier[];
const SEVERITIES = Object.keys(DAMAGE_BY_SEVERITY) as Severity[];

/** The ids a written line may map onto: the hero's available legal actions (`scene.actions`). */
export function knownActionIds(actions: readonly { id: string; available: boolean }[]): string[] {
  return actions.filter((a) => a.available).map((a) => a.id);
}

/**
 * The choice letter a legal-action id is stored as. An attack is a, a spell is b, and the other ids
 * this knows (common, item, feature, choice) are c, or the choice's own letter.
 * TODO: a later kind, such as a move once a fight has positions, has no letter here.
 */
export function choiceFor(action: string): ChoiceId | null {
  if (action.startsWith('choice:')) {
    const letter = action.slice('choice:'.length);
    return (CHOICE_IDS as readonly string[]).includes(letter) ? letter as ChoiceId : null;
  }
  if (action.startsWith('attack:') || action === 'common:attack') return 'a';
  if (action.startsWith('spell:')) return 'b';
  if (action.startsWith('common:') || action.startsWith('item:') || action.startsWith('feature:') || action.startsWith('skill:') || action.startsWith('ability:')) return 'c';
  return null;
}

/**
 * A check the player took instead of a plot choice: a written action, or a skill picked from the sheet.
 * Words added to a spell or an attack are not one of these (they have no ruling).
 */
export function isPersonalCheck(vote: { actionId?: string; freeform?: { ruling?: { kind?: string } } | null }): boolean {
  const sheetCheck = !vote.actionId || vote.actionId.startsWith('skill:') || vote.actionId.startsWith('ability:');
  return vote.freeform?.ruling?.kind === 'check' && sheetCheck;
}

/** A skill chosen from the sheet: a medium check, DC 15, and no extra effect. The words say what is attempted. */
export function rulingForSkill(sheet: CharacterSheet, skillId: string): CheckRuling | null {
  const ability = srd().skills.get(skillId);
  if (!ability) return null;
  if (!sheet.skills.includes(skillId) && !Object.hasOwn(sheet.skillBonuses, skillId)) return null;
  return { kind: 'check', ability, skill: skillId, tier: 'medium', effect: { category: 'none' } };
}

/** An ability chosen from the sheet: a medium check, no skill. */
export function rulingForAbility(ability: string): CheckRuling | null {
  if (!(ABILITIES as readonly string[]).includes(ability)) return null;
  return { kind: 'check', ability: ability as Ability, skill: null, tier: 'medium', effect: { category: 'none' } };
}

export type ImprovisedEffect =
  | { category: 'none' }
  | { category: 'damage'; severity: Severity; damageType: string }
  | { category: 'condition'; condition: SaveCondition; save: Ability };

/** A check the engine can roll. No DC, dice or other number: those come from the tables above. */
export interface CheckRuling {
  kind: 'check';
  ability: Ability;
  skill: string | null;
  tier: Tier;
  effect: ImprovisedEffect;
}

export type FreeformRuling =
  | { kind: 'known'; action: string }
  | CheckRuling
  | { kind: 'impossible'; narration: string };

/** What the engine says when the classification cannot be read. The turn is not spent. */
export const UNREADABLE = 'The dungeon master cannot make that out, so the moment passes unspent.';
/** What the engine says when an impossible reply smuggles in a number, or says nothing. */
export const REFUSED = 'That cannot be done.';

export interface Settled {
  spent: boolean;
  ruling: FreeformRuling;
  /** Today's choice, when the words mapped onto one. */
  choiceId: ChoiceId | null;
  /** Set when the turn is not spent. */
  narration: string | null;
}

const asText = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const abilityOf = (value: unknown): Ability | null => (ABILITIES.includes(value as Ability) ? value as Ability : null);
const isTier = (value: string): value is Tier => TIERS.includes(value as Tier);
const isSeverity = (value: string): value is Severity => SEVERITIES.includes(value as Severity);

const unreadable = (): Settled => ({ spent: false, ruling: { kind: 'impossible', narration: UNREADABLE }, choiceId: null, narration: UNREADABLE });
const refused = (narration: string): Settled => ({ spent: false, ruling: { kind: 'impossible', narration }, choiceId: null, narration });

/** The DM's classification, checked. Anything the engine cannot read becomes an impossible action. */
export function settleRuling(raw: unknown, allowed: readonly string[]): Settled {
  if (!raw || typeof raw !== 'object') return unreadable();
  const row = raw as Record<string, unknown>;
  if (row.kind === 'impossible') {
    const narration = asText(row.narration);
    return refused(narration && !/\d/.test(narration) ? narration.slice(0, 240) : REFUSED);
  }
  if (row.kind === 'known') {
    const action = asText(row.action);
    const choiceId = choiceFor(action);
    return choiceId && allowed.includes(action) ? { spent: true, ruling: { kind: 'known', action }, choiceId, narration: null } : unreadable();
  }
  if (row.kind !== 'check') return unreadable();
  const ability = abilityOf(row.ability);
  const tier = asText(row.tier);
  const skill = asText(row.skill);
  if (!ability || !isTier(tier)) return unreadable();
  if (skill && !srd().skills.has(skill)) return unreadable();
  const effect = effectOf(row);
  if (!effect) return unreadable();
  const ruling: CheckRuling = { kind: 'check', ability, skill: skill || null, tier, effect };
  return { spent: true, ruling, choiceId: null, narration: null };
}

function effectOf(row: Record<string, unknown>): ImprovisedEffect | null {
  const effect = asText(row.effect) || 'none';
  if (effect === 'none') return { category: 'none' };
  if (effect === 'damage') {
    const severity = asText(row.severity);
    if (!isSeverity(severity)) return null;
    const named = asText(row.damageType);
    if (named && !DAMAGE_TYPES.includes(named)) return null;
    return { category: 'damage', severity, damageType: named || 'bludgeoning' };
  }
  if (effect === 'condition') {
    const condition = asText(row.condition);
    const save = abilityOf(row.save);
    if (!save || !SAVE_CONDITIONS.includes(condition as SaveCondition)) return null;
    return { category: 'condition', condition: condition as SaveCondition, save };
  }
  return null;
}

export interface Adjudicated { text: string; foe: Combatant | null; success: boolean }

const quoted = (text: string) => text.replaceAll('"', "'");

function faces(natural: number, rolls: number[], mode: Mode): string {
  if (mode === 'normal') return `${natural}`;
  const dropped = rolls[0] === natural ? rolls[1] : rolls[0];
  return `${natural} (${mode === 'advantage' ? 'Advantage' : 'Disadvantage'} over ${dropped})`;
}

/** The check named the way the dice log names every other one: "Athletics", "Strength". */
function checkName(ruling: CheckRuling): string {
  return ruling.skill ? titleCase(ruling.skill) : ABILITY_NAMES[ruling.ability];
}

/**
 * Rolls a written check with the player's d20 (`natural`, the same die a vote keeps) and applies the
 * effect. `foe` is the creature it lands on in a fight, or null outside one. The returned foe is that
 * creature after the effect; null when there was none.
 */
export function adjudicateCheck(rng: Rng, sheet: CharacterSheet, text: string, ruling: CheckRuling, natural: number, foe: Combatant | null): Adjudicated {
  const dc = DC_BY_TIER[ruling.tier];
  const roll = abilityCheck(rng, sheet, { ability: ruling.ability, skill: ruling.skill }, { natural });
  const head = `${sheet.name} ("${quoted(text)}"): ${checkName(ruling)} ${faces(roll.natural, roll.rolls, roll.mode)} ${signed(roll.bonus)} = ${roll.total} vs DC ${dc}, ${roll.total >= dc ? 'success' : 'failure'}`;
  const success = roll.total >= dc;
  if (!success || ruling.effect.category === 'none') return { text: `${head}.`, foe, success };
  if (ruling.effect.category === 'damage') return { ...strike(rng, head, ruling.effect, foe), success };
  return { ...afflict(rng, head, ruling.effect, dc, foe), success };
}

function strike(rng: Rng, head: string, effect: Extract<ImprovisedEffect, { category: 'damage' }>, foe: Combatant | null): Omit<Adjudicated, 'success'> {
  const rolled = rollDice(rng, parseDice(DAMAGE_BY_SEVERITY[effect.severity])).total;
  if (!foe) return { text: `${head}. Improvised damage ${rolled} ${effect.damageType}.`, foe: null };
  const taken = damageAfterDefenses(foe, rolled, effect.damageType);
  const told = taken > 0 ? `takes ${effect.damageType} damage` : 'is unharmed'; // a foe's hit points are hidden (rules/wounds.ts)
  return { text: `${head}. ${foe.name} ${told}.`, foe: takeDamage(foe, taken, false) };
}

function afflict(rng: Rng, head: string, effect: Extract<ImprovisedEffect, { category: 'condition' }>, dc: number, foe: Combatant | null): Omit<Adjudicated, 'success'> {
  const name = titleCase(effect.condition);
  if (!foe) return { text: `${head}. A ${ABILITY_NAMES[effect.save]} save against DC ${dc} would leave them ${name}.`, foe: null };
  const save = savingThrow(rng, foe, effect.save, dc, {});
  const told = save.roll
    ? `${foe.name}: ${ABILITY_NAMES[effect.save]} save ${save.roll.natural} ${signed(foe.saveBonuses[effect.save])} = ${save.roll.total} vs DC ${dc}, ${save.success ? 'success' : 'failure'}`
    : `${foe.name} automatically fails the ${ABILITY_NAMES[effect.save]} save`;
  if (save.success) return { text: `${head}. ${told}.`, foe };
  const next = addCondition(foe, effect.condition);
  const landed = next.conditions.length > foe.conditions.length;
  return { text: `${head}. ${told}: ${landed ? name : 'unaffected'}.`, foe: next };
}
