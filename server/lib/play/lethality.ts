/**
 * How fights go for a party, played straight through the play layer (no DM, no HTTP): every hero votes Cast
 * each round (its best damaging spell, its healing spell for a dying friend, or its best weapon). The
 * Phase 5 lethality test and `npm run fights` use it. See docs/rules-design.md (Phase 5).
 */
import { heroSheet } from '../characters.ts';
import type { LightLevel } from '../rules/light.ts';
import { awardXp } from '../rules/leveling.ts';
import { monsters } from '../rules/monsters.ts';
import { srd } from '../rules/srd.ts';
import { autoLevelUp, fightRound, startFight, type FightEnd } from './fight.ts';
import type { PartyState } from './state.ts';

export interface Tally { fights: number; won: number; fled: number; lost: number; dead: number; heroes: number; rounds: number; foes: number; xp: number }

/** A fresh hero of this class at this level (average hit points, the SRD subclass). */
export function heroAt(characterClass: string, n: number, level: number, race = 'human') {
  const sheet = heroSheet({ id: `fights-${characterClass}-${n}`, name: `${characterClass} ${n}`, race, characterClass });
  return autoLevelUp(awardXp(sheet, srd().advancement[level - 1].xp)).sheet;
}

/** Hero `i`'s d20 in round `round` of fight `f`: spread over 1–20, fresh for each hero and round. */
export const voteRoll = (f: number, round: number, i: number) => 1 + ((f * 7919 + round * 104729 + i * 31) % 20);

/** One fight to its end, every hero voting Cast; fight `f`'s dice are its own. */
export function playFight(party: PartyState, foes: readonly string[], f: number, light: LightLevel = 'bright'): { ended: FightEnd; party: PartyState; rounds: number } {
  const started = startFight(party, foes, light);
  let { party: p, combat } = started;
  for (;;) {
    const votes = Object.fromEntries(Object.keys(p.sheets).map((id, i) => [id, { choiceId: 'b' as const, roll: voteRoll(f, combat.round, i) }]));
    const round = fightRound(p, combat, votes);
    p = round.party; combat = round.combat;
    if (round.ended) return { ended: round.ended, party: p, rounds: combat.round };
  }
}

const KEY: Record<FightEnd, 'won' | 'fled' | 'lost'> = { victory: 'won', fled: 'fled', defeat: 'lost' };

/** `fights` fights, each a fresh party of these classes at this level against the next encounter. */
export function tally(classes: readonly string[], level: number, encounters: Iterator<string[]>, fights: number, light: LightLevel = 'bright', race = 'human'): Tally {
  const t: Tally = { fights, won: 0, fled: 0, lost: 0, dead: 0, heroes: classes.length, rounds: 0, foes: 0, xp: 0 };
  for (let f = 0; f < fights; f++) {
    const foes = encounters.next().value as string[];
    const sheets = Object.fromEntries(classes.map((c, i) => [`p${i}`, heroAt(c, i, level, race)]));
    const fight = playFight({ version: 1, rng: 1000 + f, sheets }, foes, f, light);
    t[KEY[fight.ended]]++;
    t.dead += Object.values(fight.party.sheets).filter((s) => s.dead).length;
    t.rounds += fight.rounds;
    t.foes += foes.length;
    t.xp += foes.reduce((sum, id) => sum + monsters().get(id)!.xp, 0);
  }
  return t;
}
