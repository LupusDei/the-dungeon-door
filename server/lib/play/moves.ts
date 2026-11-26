/**
 * The moves a hero can take, as actions a per-hero legal-actions list can offer beside Attack, Cast and Dodge.
 * One band is a move (the action can still be taken); Dash spends the action and covers two. See rules/bands.ts.
 */
import { legalMoves, type Move } from '../rules/bands.ts';
import type { Action, CombatState } from '../rules/scene.ts';

const names = (state: CombatState, ids: readonly string[]) => ids.map((id) => state.combatants[id]?.name ?? id);
const listed = (words: readonly string[]) => (words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`);

function label(state: CombatState, move: Move): string {
  const how = move.dash ? 'Dash' : move.disengage ? 'Disengage' : 'Move';
  if (move.to === 'engaged') return `${how} to engage ${listed(names(state, move.engage ?? []))}`;
  return `${how} to ${move.to}`;
}

/** Every legal move for this combatant, each already an action the fight can resolve. */
export function moveActions(state: CombatState, id: string): { label: string; action: Action }[] {
  return legalMoves(state, id).map((move) => ({ label: label(state, move), action: { kind: 'move', ...move } }));
}
