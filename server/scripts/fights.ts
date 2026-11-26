/**
 * How the fights a mapped dungeon rolls go for a party, played straight through the play layer (no DM, no
 * HTTP): every hero votes Cast (its best damaging spell, or its best weapon). Costs nothing.
 *
 *   npm run fights                         # 400 fights each for a few level-1 parties
 *   npm run fights -- --fights 2000 --party fighter,cleric --level 3
 */
import { heroSheet } from '../lib/characters.ts';
import { autoLevelUp, fightRound, startFight } from '../lib/play/fight.ts';
import type { PartyState } from '../lib/play/state.ts';
import { generateDungeon } from '../lib/rules/dungeon.ts';
import { awardXp } from '../lib/rules/leveling.ts';
import { encounterBudget, monsters } from '../lib/rules/monsters.ts';
import { srd } from '../lib/rules/srd.ts';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const FIGHTS = Number(arg('fights', '400'));
const LEVEL = Number(arg('level', '1'));
const PARTIES = process.argv.includes('--party')
  ? [arg('party', 'fighter').split(',')]
  : [['fighter'], ['wizard'], ['rogue', 'cleric'], ['fighter', 'rogue', 'cleric', 'wizard'], ['barbarian', 'bard', 'druid', 'monk', 'paladin', 'warlock']];

const hero = (characterClass: string, n: number) => {
  const sheet = heroSheet({ id: `fights-${characterClass}-${n}`, name: `${characterClass} ${n}`, race: 'human', characterClass });
  return LEVEL > 1 ? autoLevelUp(awardXp(sheet, srd().advancement[LEVEL - 1].xp)).sheet : sheet;
};

/** The encounters of mapped dungeons rolled for these levels, seed after seed. */
function* encounters(levels: number[]): Generator<string[]> {
  for (let seed = 1; ; seed++) {
    for (const node of Object.values(generateDungeon(seed, 'standard', levels).nodes)) {
      if (node.contents?.encounter) yield node.contents.encounter.monsters;
    }
  }
}

const pct = (n: number, of: number) => `${Math.round((100 * n) / of)}%`.padStart(5);
const xpOf = (ids: string[]) => ids.reduce((sum, id) => sum + monsters().get(id)!.xp, 0);

console.log(`${FIGHTS} fights each, level ${LEVEL} heroes, every hero votes Cast each round\n`);
console.log('party                                       won   foes fled   lost   heroes dead   rounds   foes   foes\' XP / moderate budget');
for (const classes of PARTIES) {
  const levels = classes.map(() => LEVEL);
  const t = { won: 0, fled: 0, lost: 0, dead: 0, rounds: 0, foes: 0, xp: 0 };
  const source = encounters(levels);
  for (let f = 0; f < FIGHTS; f++) {
    const foes = source.next().value as string[];
    const sheets = Object.fromEntries(classes.map((c, i) => [`p${i}`, hero(c, i)]));
    let party: PartyState = { version: 1, rng: 1000 + f, sheets };
    const started = startFight(party, foes);
    party = started.party;
    let combat = started.combat;
    let ended: string | null = null;
    while (ended === null) {
      // Each vote's d20 is the hero's attack roll: a fresh one per hero per round.
      const votes = Object.fromEntries(Object.keys(sheets).map((id, i) => [id, { choiceId: 'b' as const, roll: 1 + ((f * 7919 + combat.round * 104729 + i * 31) % 20) }]));
      const round = fightRound(party, combat, votes);
      party = round.party; combat = round.combat; ended = round.ended;
    }
    t[ended === 'victory' ? 'won' : ended === 'fled' ? 'fled' : 'lost']++;
    t.dead += Object.values(party.sheets).filter((s) => s.dead).length;
    t.rounds += combat.round;
    t.foes += foes.length;
    t.xp += xpOf(foes);
  }
  const budget = encounterBudget(levels, 'moderate');
  console.log([
    classes.join(',').padEnd(42), pct(t.won, FIGHTS), pct(t.fled, FIGHTS).padStart(11), pct(t.lost, FIGHTS).padStart(6),
    pct(t.dead, FIGHTS * classes.length).padStart(13), (t.rounds / FIGHTS).toFixed(1).padStart(8), (t.foes / FIGHTS).toFixed(1).padStart(6),
    `${Math.round(t.xp / FIGHTS)} / ${budget}`.padStart(14),
  ].join(' '));
}
