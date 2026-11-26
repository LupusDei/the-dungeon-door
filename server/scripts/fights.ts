/**
 * How the fights a mapped dungeon rolls go for a party, played straight through the play layer (no DM, no
 * HTTP): every hero votes Cast (its best damaging spell, or its best weapon). Costs nothing.
 *
 *   npm run fights                         # 400 fights each for a few level-1 parties
 *   npm run fights -- --fights 2000 --party fighter,cleric --level 3
 *   npm run fights -- --light dark --race human    # in an unlit room (bright unless given): who is Blinded
 */
import { tally } from '../lib/play/lethality.ts';
import { generateDungeon } from '../lib/rules/dungeon.ts';
import type { LightLevel } from '../lib/rules/light.ts';
import { encounterBudget } from '../lib/rules/monsters.ts';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const FIGHTS = Number(arg('fights', '400'));
const LEVEL = Number(arg('level', '1'));
const LIGHT = arg('light', 'bright') as LightLevel;
const RACE = arg('race', 'human');
const PARTIES = process.argv.includes('--party')
  ? [arg('party', 'fighter').split(',')]
  : [['fighter'], ['wizard'], ['rogue', 'cleric'], ['fighter', 'rogue', 'cleric', 'wizard'], ['barbarian', 'bard', 'druid', 'monk', 'paladin', 'warlock']];

/** The encounters of mapped dungeons rolled for these levels, seed after seed. */
function* encounters(levels: number[]): Generator<string[]> {
  for (let seed = 1; ; seed++) {
    for (const node of Object.values(generateDungeon(seed, 'standard', levels).nodes)) {
      if (node.contents?.encounter) yield node.contents.encounter.monsters;
    }
  }
}

const pct = (n: number, of: number) => `${Math.round((100 * n) / of)}%`.padStart(5);

console.log(`${FIGHTS} fights each, level ${LEVEL} heroes, every hero votes Cast each round\n`);
console.log('party                                       won   foes fled   lost   heroes dead   rounds   foes   foes\' XP / moderate budget');
for (const classes of PARTIES) {
  const levels = classes.map(() => LEVEL);
  const t = tally(classes, LEVEL, encounters(levels), FIGHTS, LIGHT, RACE);
  const budget = encounterBudget(levels, 'moderate');
  console.log([
    classes.join(',').padEnd(42), pct(t.won, FIGHTS), pct(t.fled, FIGHTS).padStart(11), pct(t.lost, FIGHTS).padStart(6),
    pct(t.dead, FIGHTS * classes.length).padStart(13), (t.rounds / FIGHTS).toFixed(1).padStart(8), (t.foes / FIGHTS).toFixed(1).padStart(6),
    `${Math.round(t.xp / FIGHTS)} / ${budget}`.padStart(14),
  ].join(' '));
}
