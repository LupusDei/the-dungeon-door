/**
 * Rests chosen by the party (a choice with a rest hook). SRD 5.2: a Short Rest spends hit dice, a Long Rest
 * restores everything and removes one level of exhaustion. A hero at 0 HP is stable and regains 1 HP as
 * the hours pass, so it can rest too.
 */
import { seededRng, type Rng } from '../rules/rng.ts';
import { longRest, shortRest } from '../rules/rests.ts';
import type { CharacterSheet } from '../rules/sheet.ts';
import type { PartyState } from './state.ts';

const LONG_REST_LINE = 'The party takes a long rest: hit points, hit dice, spell slots and features restored; one level of exhaustion removed.';

const awake = (sheet: CharacterSheet) => (sheet.hp === 0 ? { ...sheet, hp: 1 } : sheet);

/** Spends one hit die at a time while the hero is hurt and has dice left. */
function spendHitDice(sheet: CharacterSheet, rng: Rng): { sheet: CharacterSheet; dice: number } {
  let s = sheet;
  let dice = 0;
  while (s.hp < s.maxHp && s.hitDiceSpent < s.level) {
    s = shortRest(s, rng, { hitDice: 1 }).sheet;
    dice++;
  }
  return { sheet: shortRest(s, rng).sheet, dice };
}

function restLine(before: CharacterSheet, after: CharacterSheet, dice: number): string {
  if (dice > 0) return `${before.name} spends ${dice} hit ${dice === 1 ? 'die' : 'dice'} and regains ${after.hp - before.hp} HP.`;
  return before.hp === 0 ? `${before.name} regains 1 HP.` : `${before.name} rests.`;
}

function shortRests(party: PartyState): { party: PartyState; lines: string[] } {
  const rng = seededRng(party.rng);
  const lines: string[] = [];
  const sheets = Object.fromEntries(Object.entries(party.sheets).map(([id, before]) => {
    const { sheet, dice } = spendHitDice(awake(before), rng);
    lines.push(restLine(before, sheet, dice));
    return [id, sheet];
  }));
  return { party: { ...party, rng: rng.state(), sheets }, lines };
}

export function partyRest(party: PartyState, kind: 'short' | 'long'): { party: PartyState; lines: string[] } {
  if (kind === 'short') return shortRests(party);
  const sheets = Object.fromEntries(Object.entries(party.sheets).map(([id, s]) => [id, longRest(awake(s))]));
  return { party: { ...party, sheets }, lines: [LONG_REST_LINE] };
}
