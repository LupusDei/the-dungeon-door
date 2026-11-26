/**
 * A combat round as one player sees it (docs/api.md, "Written for you"): the same three choices, saying
 * what that player's own hero will do with them. The words follow play/fight.ts, which decides the action:
 * the best weapon, the best damaging spell (a healer's healing spell while a friend is dying), the most
 * wounded foe (several of them for an area spell), and Second Wind or a healing potion first for a hero at
 * half its hit points or less.
 */
import { spellDamage } from '../attacks.ts';
import type { Combatant } from '../rules/combatant.ts';
import { item } from '../rules/items.ts';
import type { CharacterSheet } from '../rules/sheet.ts';
import { slotsLeft, spellHealingDice, strikesAt } from '../rules/spells.ts';
import type { SrdSpell } from '../rules/srd.ts';
import { CHOICE_IDS, type ChoiceView } from '../types.ts';
import { thirdChoice, thirdWords } from './actions.ts';
import { rangedShot } from '../rules/bands.ts';
import { bestSpell, bestWeapon, bonusHeal, castPlan, COMBAT_CHOICES, healingSpell, mostWounded, strikePlan, weaponType } from './fight.ts';
import { ABILITY_NAMES } from './hooks.ts';
import type { CombatState } from './state.ts';

/** Can this player's hero take an action this round? Outside a fight everyone has a say. */
export const canAct = (combat: CombatState | null, playerId: string): boolean =>
  combat === null || combat.combatants[playerId]?.status === 'up';

/** "+5", "-1": the way a sheet writes a bonus. */
const signed = (n: number) => (n < 0 ? `${n}` : `+${n}`);

const view = (choices: readonly { label: string; detail: string }[]): ChoiceView[] =>
  choices.map((c, i) => ({ id: CHOICE_IDS[i], label: c.label, detail: c.detail, rules: null }));

/** The round's choices as written for everyone: for a player whose hero cannot act. */
export const anyonesChoices = (): ChoiceView[] => view(COMBAT_CHOICES);

function strike(combat: CombatState, me: Combatant) {
  const weapon = bestWeapon(me);
  const plan = strikePlan(combat, me);
  const foe = plan.target ?? mostWounded(combat, me.side, weaponType(me));
  const damage = weapon.damage.map((d) => `${d.dice} ${d.type}`).join(' + ');
  if (!plan.target) return { label: 'Move closer', detail: `${foe.name} is too far to strike. Move to ${foe.place?.band === 'far' ? 'near' : 'engage them'}.` };
  const shot = weapon.ranged ? rangedShot(me, foe, weapon) : null;
  const penalty = me.place?.band === 'engaged' && weapon.ranged ? ' Disadvantage while engaged.' : shot?.longRange ? ' Disadvantage at long range.' : '';
  const step = plan.approach?.to === 'engaged' ? ` You move to engage ${foe.name}.` : '';
  return { label: `Attack with ${weapon.name}`, detail: `${signed(weapon.bonus)} to hit, ${damage}, at ${foe.name}.${step}${penalty}` };
}

/** " Uses a level 1 slot (2 left)." for a spell that spends one; nothing for a cantrip. */
function slotNote(spell: SrdSpell, sheet: CharacterSheet): string {
  if (spell.level === 0) return '';
  const left = slotsLeft(sheet);
  const level = left.findIndex((n, i) => i >= spell.level - 1 && n > 0) + 1;
  return ` Uses a level ${level} slot (${left[level - 1]} left).`;
}

/** "A", "A and B", "A, B and C". */
const listed = (names: readonly string[]) =>
  (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** Who the spell is aimed at, after the one-band step it takes when it needs one. */
function aim(spell: SrdSpell, combat: CombatState, me: Combatant, sheet: CharacterSheet): { names: string; step: string } {
  const plan = castPlan(combat, me, spell, sheet);
  const names = plan.targets.length
    ? listed([...new Set(plan.targets)].map((id) => combat.combatants[id].name))
    : mostWounded(combat, me.side, spell.damage?.type).name;
  const engaged = plan.approach?.engage?.map((id) => combat.combatants[id].name) ?? [];
  const step = plan.approach?.to === 'engaged' && engaged.length ? ` You move to engage ${listed(engaged)}.` : plan.targets.length ? '' : ' Too far: you move closer.';
  return { names, step };
}

/** "3 darts of 1d4+1 force that never miss". */
const darts = (spell: SrdSpell, sheet: CharacterSheet) => `${strikesAt(spell, spell.level, sheet.level)} darts of ${spell.damage!.dice} ${spell.damage!.type} that never miss`;

function cast(spell: SrdSpell, sheet: CharacterSheet, aimAt: { names: string; step: string }) {
  const { attackBonus, saveDc } = sheet.spellcasting!;
  const damage = spellDamage(spell, sheet.level);
  const how = spell.darts ? darts(spell, sheet) : spell.attack
    ? `${signed(attackBonus)} to hit, ${damage}`
    : `${damage}, ${ABILITY_NAMES[spell.save!]} save DC ${saveDc}${spell.halfOnSave ? ' for half' : ''}`;
  return { label: `Cast ${spell.name}`, detail: `${how}, at ${aimAt.names}.${aimAt.step}${slotNote(spell, sheet)}` };
}

/** Cast with a friend dying: the healer's healing spell on them (play/fight.ts, healAction), or null when Cast attacks. */
function heal(combat: CombatState, sheet: CharacterSheet, me: Combatant) {
  const dying = Object.values(combat.combatants).find((c) => c.side === me.side && c.status === 'dying');
  const spell = dying ? healingSpell(sheet) : null;
  if (!dying || !spell) return null;
  const slot = slotsLeft(sheet).findIndex((n, i) => n > 0 && i + 1 >= spell.level) + 1;
  const { attackBonus } = sheet.spellcasting!;
  return { label: `Cast ${spell.name}`, detail: `Heals ${dying.name}, who is dying: ${spellHealingDice(spell, slot)}${signed(attackBonus - sheet.proficiencyBonus)} hit points.${slotNote(spell, sheet)}` };
}

/** " First uses Second Wind." or " First drinks a Potion of Healing." when the engine will do that before the hero acts. */
function bonusNote(me: Combatant, sheet: CharacterSheet): string {
  const bonus = bonusHeal(me, sheet);
  if (bonus === null) return '';
  return bonus.kind === 'second-wind' ? ' First uses Second Wind.' : ` First drinks a ${item(bonus.id).name}.`;
}

/** Attack, Cast and the third choice (Dodge, Break Free or Help: play/actions.ts) as this hero would do them now. */
export function yourChoices(combat: CombatState, sheet: CharacterSheet, playerId: string): ChoiceView[] {
  const me = combat.combatants[playerId];
  const attack = strike(combat, me);
  const spell = bestSpell(sheet);
  const bonus = bonusNote(me, sheet);
  const third = thirdWords(thirdChoice(combat, sheet, playerId), combat, sheet, COMBAT_CHOICES[2]);
  const second = heal(combat, sheet, me) ?? (spell ? cast(spell, sheet, aim(spell, combat, me, sheet)) : attack);
  return view([attack, second, third].map((c) => ({ ...c, detail: c.detail + bonus })));
}
