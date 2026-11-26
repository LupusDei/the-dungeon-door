/**
 * Monster morale: an original rule for this game (CC0; SRD 5.2 has none). When a band of foes is shaken
 * (its first death, half its total HP gone, its leader down) it rolls d20 + its best WIS save vs DC 10.
 * On a failure the foes flee, and each standing hero with a melee weapon gets an Opportunity Attack (5.2);
 * failing by 5 or more, they surrender. Undead, constructs and oozes never break. See docs/rules-design.md.
 */
import type { Combatant } from '../rules/combatant.ts';
import { rollD20 } from '../rules/resolve.ts';
import { seededRng } from '../rules/rng.ts';
import { type CombatState, reactionAttack } from '../rules/scene.ts';
import { signed } from './checks.ts';

export const MORALE_DC = 10;
/** Failing the morale check by this much or more is a surrender. */
const SURRENDER = 5;

export type Break = 'flee' | 'surrender';
export interface Morale { combat: CombatState; lines: string[]; broke: Break | null }

const foesOf = (s: CombatState) => Object.values(s.combatants).filter((c) => c.side === 'foes');
const fallen = (c: Combatant) => c.status === 'dead';
const strength = (foes: Combatant[]) => foes.reduce((n, c) => n + c.hp, 0);

/** What shook the foes between `before` and `after`, each only as it happens. */
export function shaken(before: CombatState, after: CombatState): string[] {
  const [was, now] = [foesOf(before), foesOf(after)];
  const total = now.reduce((n, c) => n + c.maxHp, 0);
  const leader = now.reduce((top, c) => (c.xp > top.xp ? c : top));
  return [
    !was.some(fallen) && now.some(fallen) && 'their first death',
    strength(was) * 2 > total && strength(now) * 2 <= total && 'half their strength gone',
    !fallen(before.combatants[leader.id]) && fallen(leader) && `${leader.name} down`,
  ].filter((r): r is string => r !== false);
}

const mostWounded = (foes: Combatant[]) => foes.reduce((low, c) => (c.hp < low.hp ? c : low));

/** Each standing hero with a melee weapon strikes the most wounded fleeing foe with its best one; a foe that Disengages draws none. */
function opportunityAttacks(state: CombatState): CombatState {
  let s = state;
  for (const id of state.order) {
    const hero = s.combatants[id];
    const melee = hero.attacks.filter((a) => !a.ranged);
    const fleeing = foesOf(s).filter((c) => !fallen(c) && !c.disengages);
    if (hero.side === 'foes' || hero.status !== 'up' || melee.length === 0 || fleeing.length === 0) continue;
    const weapon = melee.reduce((best, a) => (a.bonus > best.bonus ? a : best));
    s = reactionAttack(s, id, weapon.name, mostWounded(fleeing).id);
  }
  return s;
}

/** After a round: if the foes were shaken, their morale check, and what came of it. */
export function morale(before: CombatState, after: CombatState): Morale {
  const standing = foesOf(after).filter((c) => !fallen(c));
  const reasons = after.outcome === 'ongoing' ? shaken(before, after) : [];
  if (reasons.length === 0 || standing.some((c) => c.fearless)) return { combat: after, lines: [], broke: null };
  const rng = seededRng(after.rng);
  const bonus = Math.max(...standing.map((c) => c.saveBonuses.wis));
  const roll = rollD20(rng, bonus, 'normal');
  const rolled = { ...after, rng: rng.state() };
  const told = `Morale (${reasons.join(', ')}): ${roll.natural} ${signed(bonus)} = ${roll.total} vs DC ${MORALE_DC}: the foes`;
  if (roll.total >= MORALE_DC) return { combat: rolled, lines: [`${told} stand firm.`], broke: null };
  if (roll.total <= MORALE_DC - SURRENDER) return { combat: rolled, lines: [`${told} throw down their arms and surrender.`], broke: 'surrender' };
  const slip = standing.filter((c) => c.disengages).map((c) => c.name);
  const away = slip.length ? [`${slip.join(', ')} ${slip.length > 1 ? 'Disengage' : 'Disengages'} as a Bonus Action: no Opportunity Attacks.`] : [];
  return { combat: opportunityAttacks(rolled), lines: [`${told} break and flee.`, ...away], broke: 'flee' };
}
