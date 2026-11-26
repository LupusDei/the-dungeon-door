/**
 * A combat round as one player sees it (docs/api.md, "Written for you"): the same three choices, saying
 * what that player's own hero will do with them. The words follow play/fight.ts, which decides the action:
 * the best weapon, the best damaging spell, the most wounded foe.
 */
import { spellDamage } from '../attacks.ts';
import type { Combatant } from '../rules/combatant.ts';
import type { CharacterSheet } from '../rules/sheet.ts';
import { slotsLeft } from '../rules/spells.ts';
import type { SrdSpell } from '../rules/srd.ts';
import { CHOICE_IDS, type ChoiceView } from '../types.ts';
import { bestSpell, bestWeapon, COMBAT_CHOICES, mostWounded } from './fight.ts';
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

function strike(me: Combatant, foe: string) {
  const weapon = bestWeapon(me);
  const damage = weapon.damage.map((d) => `${d.dice} ${d.type}`).join(' + ');
  return { label: `Attack with ${weapon.name}`, detail: `${signed(weapon.bonus)} to hit, ${damage}, at ${foe}.` };
}

/** " Uses a level 1 slot (2 left)." for a spell that spends one; nothing for a cantrip. */
function slotNote(spell: SrdSpell, sheet: CharacterSheet): string {
  if (spell.level === 0) return '';
  const left = slotsLeft(sheet);
  const level = left.findIndex((n, i) => i >= spell.level - 1 && n > 0) + 1;
  return ` Uses a level ${level} slot (${left[level - 1]} left).`;
}

function cast(spell: SrdSpell, sheet: CharacterSheet, foe: string) {
  const { attackBonus, saveDc } = sheet.spellcasting!;
  const damage = spellDamage(spell, sheet.level);
  const how = spell.attack
    ? `${signed(attackBonus)} to hit, ${damage}`
    : `${damage}, ${ABILITY_NAMES[spell.save!]} save DC ${saveDc}${spell.halfOnSave ? ' for half' : ''}`;
  return { label: `Cast ${spell.name}`, detail: `${how}, at ${foe}.${slotNote(spell, sheet)}` };
}

/** Attack, Cast and Dodge as this hero would do them now. */
export function yourChoices(combat: CombatState, sheet: CharacterSheet, playerId: string): ChoiceView[] {
  const me = combat.combatants[playerId];
  const foe = mostWounded(combat, me.side).name;
  const attack = strike(me, foe);
  const spell = bestSpell(sheet);
  return view([attack, spell ? cast(spell, sheet, foe) : attack, COMBAT_CHOICES[2]]);
}
