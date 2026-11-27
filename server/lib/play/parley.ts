/**
 * Meeting monsters: an original attitude rule (CC0; SRD 5.2 leaves it to the DM). Foes met in a room roll
 * 2d6: 2–5 Hostile, 6–9 Indifferent, 10–12 Friendly. Undead, constructs and oozes are always Hostile.
 * Hostile foes bar the way; they do not attack until the party engages (play/turn.ts). A parley is an
 * Influence check (5.2: Persuasion, DC max(15, the monster's INT)) by the best talker among those who
 * picked it, with the others of them helping (play/checks.ts); Advantage if Friendly, Disadvantage if
 * Hostile. Success: the foes let the party be. Failure: their attitude worsens a step. Outside a dungeon,
 * a failure that turns them Hostile starts the fight.
 */
import { dcAgainst } from '../rules/checks.ts';
import { monster } from '../rules/monsters.ts';
import { type Rng, seededRng } from '../rules/rng.ts';
import { groupRoll, type Roll } from './checks.ts';
import { foesNamed, rollName } from './hooks.ts';
import type { PartyState } from './state.ts';

export type Attitude = 'hostile' | 'indifferent' | 'friendly';

const FEARLESS = /undead|construct|ooze/;
const HOSTILE_MAX = 5;
const INDIFFERENT_MAX = 9;

/** The foes' attitude: 2d6 (null for fearless foes, who are always Hostile). */
export function rollAttitude(rng: Rng, monsterIds: readonly string[]): { attitude: Attitude; roll: number | null } {
  if (monsterIds.some((id) => FEARLESS.test(monster(id).type))) return { attitude: 'hostile', roll: null };
  const roll = rng.die(6) + rng.die(6);
  return { attitude: roll <= HOSTILE_MAX ? 'hostile' : roll <= INDIFFERENT_MAX ? 'indifferent' : 'friendly', roll };
}

const WORSE: Readonly<Record<Attitude, Attitude>> = { friendly: 'indifferent', indifferent: 'hostile', hostile: 'hostile' };

export interface Parley {
  party: PartyState; success: boolean; attitude: Attitude; lines: string[];
  /** Who rolled the Influence check (the best talker), and how it went: the whole roll. */
  rolls: Roll[];
  /** The check as the dice log names it ("Persuasion"), its DC, and the names of those whose Help gave Advantage. */
  name: string; dc: number; helpers: string[];
}

const TALK = { ability: 'cha', skill: 'persuasion' } as const;

/** The party talks to the foes; the hardest of them to sway sets the DC. `backers` picked the parley: one of them talks. */
export function parley(party: PartyState, monsterIds: readonly string[], attitude: Attitude, votes: Readonly<Record<string, number>>, backers: readonly string[] = []): Parley {
  const rng = seededRng(party.rng);
  const dc = Math.max(...monsterIds.map((id) => dcAgainst(monster(id), TALK)));
  const heroes = Object.entries(party.sheets).filter(([, s]) => !s.dead).map(([playerId, sheet]) => ({ playerId, sheet }));
  const hook = {
    kind: 'check' as const, ...TALK, dc, mode: 'best' as const,
    advantage: attitude === 'friendly', disadvantage: attitude === 'hostile',
  };
  const rolled = groupRoll(heroes, hook, votes, rng, backers);
  const after = rolled.success ? attitude : WORSE[attitude];
  const outcome = rolled.success ? `The ${foesNamed(monsterIds)} let the party be.` : `The talk goes badly: the ${foesNamed(monsterIds)} turn ${after}.`;
  return { party: { ...party, rng: rng.state() }, success: rolled.success!, attitude: after, lines: [...rolled.lines, outcome],
    rolls: rolled.rolls.filter((r) => r.natural !== null), name: rollName(hook), dc, helpers: rolled.helpers };
}
