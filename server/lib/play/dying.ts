/**
 * Death and dying out of the fight (SRD 5.2). A hero at 0 HP is dying: a friend's Spare the Dying or
 * Healer's Kit stabilizes them, or the best healer tries a DC 10 Wisdom (Medicine) check (Help; up to
 * three tries), and after each failure the dying hero makes a death save. Alone they roll death saves
 * until stable, dead, or a 20 brings them back with 1 HP. A stable hero wakes with 1 HP after 1d4 hours.
 * The dead stay dead (sheet.dead) until revived.
 */
import { type Combatant, heroCombatant } from '../rules/combatant.ts';
import { deathSave } from '../rules/resolve.ts';
import type { Rng } from '../rules/rng.ts';
import { seededRng } from '../rules/rng.ts';
import type { CharacterSheet } from '../rules/sheet.ts';
import { groupRoll, type Hero } from './checks.ts';
import type { CombatState, PartyState } from './state.ts';
import { counted } from '../rules/counted.ts';

export interface Settled { party: PartyState; lines: string[] }

const MEDICINE_TRIES = 3;
/** A hero fresh from heroCombatant: no death saves yet. */
const dying = (c: Combatant): Combatant => ({ ...c, status: 'dying' });

/** A friend who can stabilize without a check: the spell first, then the kit. */
function saver(friends: readonly Hero[]): string | null {
  const caster = friends.find((h) => h.sheet.spellcasting?.cantrips.includes('spare-the-dying'));
  if (caster) return `${caster.sheet.name} casts Spare the Dying`;
  const kit = friends.find((h) => h.sheet.equipment.some((e) => e.id === 'healers-kit'));
  return kit ? `${kit.sheet.name} uses a Healer's Kit` : null;
}

const SAVE_WORDS = (face: number) => (face === 20 ? '20: back up with 1 HP' : face === 1 ? 'two failures' : face >= 10 ? 'success' : 'failure');

function rollDeathSave(rng: Rng, c: Combatant, lines: string[]): Combatant {
  const face = rng.die(20);
  lines.push(`${c.name}'s death save: ${face} (${SAVE_WORDS(face)}).`);
  return deathSave(rng, c, face);
}

/** Rolls on until the hero is no longer dying. With no friends standing, the Medicine tries are no one's and roll nothing. */
export function settleOne(rng: Rng, start: Combatant, friends: readonly Hero[]): { c: Combatant; lines: string[] } {
  const lines = [`${start.name} is dying.`];
  const help = saver(friends);
  if (help) { lines.push(`${help}: ${start.name} is stable.`); return { c: { ...start, status: 'stable' }, lines }; }
  let c = start;
  for (let tries = 0; c.status === 'dying'; tries++) {
    if (tries < MEDICINE_TRIES) {
      const check = groupRoll([...friends], { kind: 'check', ability: 'wis', skill: 'medicine', dc: 10, mode: 'best' }, {}, rng);
      lines.push(...check.lines);
      if (check.success) { lines.push(`${start.name} is stable.`); return { c: { ...c, status: 'stable' }, lines }; }
    }
    c = rollDeathSave(rng, c, lines);
  }
  return { c, lines };
}

export function outcome(rng: Rng, c: Combatant, sheet: CharacterSheet): { sheet: CharacterSheet; line: string } {
  if (c.status === 'dead') return { sheet: { ...sheet, dead: true }, line: `${sheet.name} dies.` };
  if (c.status === 'up') return { sheet: { ...sheet, hp: 1 }, line: `${sheet.name} is back on their feet.` };
  const hours = rng.die(4);
  return { sheet: { ...sheet, hp: 1 }, line: `${sheet.name} wakes with 1 HP after ${counted(hours, 'hour')}.` };
}

/** Settles these fallen heroes (dying or stable combatants), with the standing heroes as friends. */
function settle(party: PartyState, fallen: readonly Combatant[], before: string[]): Settled {
  if (fallen.length === 0) return { party, lines: before };
  const rng = seededRng(party.rng);
  const friends = Object.entries(party.sheets).filter(([, s]) => s.hp > 0 && !s.dead).map(([playerId, sheet]) => ({ playerId, sheet }));
  const sheets = { ...party.sheets };
  const lines = [...before];
  for (const f of fallen) {
    const settled = f.status === 'dying' ? settleOne(rng, f, friends) : { c: f, lines: [] };
    const end = outcome(rng, settled.c, sheets[f.id]);
    sheets[f.id] = end.sheet;
    lines.push(...settled.lines, end.line);
  }
  return { party: { ...party, rng: rng.state(), sheets }, lines };
}

/** After harm outside combat (a trap, a hazard, a save): heroes left at 0 HP are dying. */
export function afterHarm(party: PartyState): Settled {
  const down = Object.entries(party.sheets).filter(([, s]) => s.hp === 0 && !s.dead).map(([id, s]) => dying(heroCombatant(id, s)));
  return settle(party, down, []);
}

/** After a fight that ended: the slain heroes are dead; the dying and stable are settled. */
export function afterFight(party: PartyState, combat: CombatState): Settled {
  const heroes = Object.keys(party.sheets).filter((id) => Object.hasOwn(combat.combatants, id)).map((id) => combat.combatants[id]);
  const slain = heroes.filter((c) => c.status === 'dead');
  const sheets = { ...party.sheets, ...Object.fromEntries(slain.map((c) => [c.id, { ...party.sheets[c.id], hp: 0, dead: true }])) };
  const fallen = heroes.filter((c) => c.status === 'dying' || c.status === 'stable');
  return settle({ ...party, sheets }, fallen, slain.map((c) => `${c.name} is dead.`));
}
