/**
 * Bringing the dead back in play (SRD 5.2). A hero who dies is Revivified on the spot (within the minute) if a
 * standing party caster can cast Revivify and the party has a 300 GP diamond's worth of gold. A revive hook
 * (a temple, a shrine) raises every dead hero dead no longer than 10 days (by the game clock): Raise Dead by a
 * party caster (500 GP diamond) or the temple's service (2,500 GP with the diamond). The richest hero who can pays. Between games, reviveCharacter
 * (lib/characters.ts) buys the temple's Raise Dead.
 */
import { canCast, DIAMOND, type Revival, revive, TEMPLE_RAISE_DEAD } from '../rules/revive.ts';
import type { CharacterSheet } from '../rules/sheet.ts';
import { castSpell } from '../rules/spells.ts';
import type { PartyState } from './state.ts';
import { clockOf } from './time.ts';

export interface Revived { party: PartyState; lines: string[] }
type Sheets = Record<string, CharacterSheet>;

/** The heroes dead in `after` who were not in `before`. */
export const newlyDead = (before: PartyState, after: PartyState): string[] =>
  Object.keys(after.sheets).filter((id) => after.sheets[id].dead === true && before.sheets[id].dead !== true);

/** The richest standing hero who has `gp`; null if nobody does. */
function payer(sheets: Sheets, gp: number): string | null {
  const able = Object.keys(sheets).filter((id) => !sheets[id].dead && sheets[id].hp > 0 && sheets[id].gp >= gp);
  return able.reduce<string | null>((top, id) => (top === null || sheets[id].gp > sheets[top].gp ? id : top), null);
}

const casterOf = (sheets: Sheets, spell: Revival) => Object.keys(sheets).find((id) => canCast(sheets[id], spell));
const pay = (sheets: Sheets, id: string, gp: number): Sheets => ({ ...sheets, [id]: { ...sheets[id], gp: sheets[id].gp - gp } });
const cast = (sheets: Sheets, id: string, spell: Revival): Sheets => ({ ...sheets, [id]: castSpell(sheets[id], spell).sheet });
const ORDEAL = ', weakened by the ordeal (-4 on D20 Tests, easing with each Long Rest)';

/** Those just slain, brought back by a party caster's Revivify where there is gold for the diamond. */
export function revivify(party: PartyState, slain: readonly string[]): Revived {
  let sheets = party.sheets;
  const lines: string[] = [];
  for (const id of slain) {
    const caster = casterOf(sheets, 'revivify');
    const purse = payer(sheets, DIAMOND.revivify);
    if (caster === undefined || purse === null) continue;
    const paid = pay(cast(sheets, caster, 'revivify'), purse, DIAMOND.revivify);
    sheets = { ...paid, [id]: revive(paid[id], 'revivify') };
    lines.push(`${sheets[caster].name} casts Revivify on ${sheets[id].name}, using up a ${DIAMOND.revivify} gp diamond: ${sheets[id].name} lives again with 1 HP.`);
  }
  return { party: { ...party, sheets }, lines };
}

/** Raise Dead reaches a creature dead no longer than 10 days (5.2). */
export const RAISE_DEAD_DAYS = 10;
const DAY = 86_400;

/** One dead hero raised by a party caster or the temple, if it has not been dead too long and someone can pay. */
function raiseOne(sheets: Sheets, id: string, now: number): { sheets: Sheets; line: string } {
  const name = sheets[id].name;
  if (now - (sheets[id].diedAt ?? now) > RAISE_DEAD_DAYS * DAY) return { sheets, line: `${name} has been dead more than ${RAISE_DEAD_DAYS} days: Raise Dead cannot reach them.` };
  const caster = casterOf(sheets, 'raise-dead');
  const cost = caster === undefined ? TEMPLE_RAISE_DEAD : DIAMOND['raise-dead'];
  const purse = payer(sheets, cost);
  if (purse === null) return { sheets, line: `Nobody can pay the ${cost} gp to raise ${name}.` };
  const paid = pay(caster === undefined ? sheets : cast(sheets, caster, 'raise-dead'), purse, cost);
  const who = caster === undefined ? `The temple raises ${name} for ${cost} gp` : `${sheets[caster].name} casts Raise Dead on ${name}, using up a ${cost} gp diamond`;
  return { sheets: { ...paid, [id]: revive(paid[id], 'raise-dead') }, line: `${who} (paid by ${sheets[purse].name}): ${name} lives again with 1 HP${ORDEAL}.` };
}

/** The revive hook: every dead hero is raised, while the gold lasts. */
export function raiseTheDead(party: PartyState): Revived {
  const dead = Object.keys(party.sheets).filter((id) => party.sheets[id].dead === true);
  if (dead.length === 0) return { party, lines: ['Nobody here needs raising.'] };
  let sheets = party.sheets;
  const lines: string[] = [];
  for (const id of dead) {
    const raised = raiseOne(sheets, id, clockOf(party));
    sheets = raised.sheets;
    lines.push(raised.line);
  }
  return { party: { ...party, sheets }, lines };
}
