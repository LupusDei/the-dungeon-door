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

/** The id a legal-actions list uses for this move, so a vote can play it. */
export function moveKey(move: Move): string {
  const flags = `${move.dash ? ':dash' : ''}${move.disengage ? ':disengage' : ''}`;
  const who = move.engage?.length ? `:${move.engage.join(',')}` : '';
  return `move:${move.to}${flags}${who}`;
}

/** The move named by `moveKey`, or null when the id is not one. */
export function parseMoveKey(id: string): Move | null {
  if (!id.startsWith('move:')) return null;
  const parts = id.split(':');
  const to = parts[1];
  if (to !== 'engaged' && to !== 'near' && to !== 'far') return null;
  const rest = parts.slice(2);
  const who = rest.find((part) => part !== 'dash' && part !== 'disengage');
  const engage = who ? who.split(',').filter(Boolean) : undefined;
  if (to === 'engaged' && !engage?.length) return null;
  return {
    to,
    ...(engage?.length ? { engage } : {}),
    ...(rest.includes('dash') ? { dash: true } : {}),
    ...(rest.includes('disengage') ? { disengage: true } : {}),
  };
}
