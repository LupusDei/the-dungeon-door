/**
 * Conditions outside a fight (rules/conditions.ts): once a turn each living hero tries to end what a save
 * or a check ends (a Restrained hero tries to break free, a Paralyzed one saves). Timed ones wear off as
 * time passes (play/time.ts); Long Rest ones at a Long Rest.
 */
import { abilityCheck } from '../rules/checks.ts';
import { conditionsOf, type TimedCondition, withoutCondition } from '../rules/conditions.ts';
import { d20Modifier } from '../rules/rests.ts';
import { rollD20 } from '../rules/resolve.ts';
import { type Rng, seededRng } from '../rules/rng.ts';
import type { CharacterSheet } from '../rules/sheet.ts';
import type { PartyState } from './state.ts';

type Tried = Extract<TimedCondition['until'], { kind: 'save' | 'escape' }>;
const title = (s: string) => s[0].toUpperCase() + s.slice(1);
const titled = (skill: string) => skill.split('-').map(title).join(' ');

function attempt(rng: Rng, sheet: CharacterSheet, until: Tried): { total: number; what: string } {
  if (until.kind === 'escape') return { total: abilityCheck(rng, sheet, { ability: until.ability, skill: until.skill }).total, what: titled(until.skill) };
  return { total: rollD20(rng, sheet.saveBonuses[until.ability] + d20Modifier(sheet), 'normal').total, what: `${until.ability.toUpperCase()} save` };
}

function tryEach(rng: Rng, sheet: CharacterSheet, lines: string[]): CharacterSheet {
  return conditionsOf(sheet).reduce((s, c) => {
    if (c.until.kind !== 'save' && c.until.kind !== 'escape') return s;
    const { total, what } = attempt(rng, s, c.until);
    const roll = `(${what} ${total} vs DC ${c.until.dc})`;
    if (total < c.until.dc) { lines.push(`${s.name} is still ${title(c.condition)} ${roll}.`); return s; }
    lines.push(c.until.kind === 'escape' ? `${s.name} breaks free ${roll}.` : `${s.name} shakes off ${title(c.condition)} ${roll}.`);
    return withoutCondition(s, c.condition);
  }, sheet);
}

const tries = (s: CharacterSheet) => !s.dead && conditionsOf(s).some((c) => c.until.kind === 'save' || c.until.kind === 'escape');

/** Each living hero tries once to end each condition a save or check ends. */
export function shakeOff(party: PartyState): { party: PartyState; lines: string[] } {
  if (!Object.values(party.sheets).some(tries)) return { party, lines: [] };
  const rng = seededRng(party.rng);
  const lines: string[] = [];
  const sheets = Object.fromEntries(Object.entries(party.sheets).map(([id, s]) => [id, tries(s) ? tryEach(rng, s, lines) : s]));
  return { party: { ...party, rng: rng.state(), sheets }, lines };
}
