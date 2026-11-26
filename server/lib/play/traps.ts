/**
 * Traps and hazards in play (SRD 5.2). The party's best passive score is checked against the trap's
 * detect DC; a noticed trap is avoided (the 5.2 entry says how), or disarmed when it needs a check (the
 * best hero rolls, with thieves' tools and Help), and a failed disarm springs it on the one who tried. An
 * unnoticed trap goes off: its save, damage (rolled once, half on a success when the trap says so) and
 * condition. Hazards befall every living hero. Where the dungeon places an SRD hazard in a room, how it
 * shows up there is original (CC0): DUNGEON_HAZARDS below.
 */
import { passiveScore } from '../rules/checks.ts';
import { parseDice, rollDice } from '../rules/dice.ts';
import { damageHero } from '../rules/dying.ts';
import { type HazardSpec, sufferHazard } from '../rules/hazards.ts';
import type { Rng } from '../rules/rng.ts';
import { seededRng } from '../rules/rng.ts';
import { type DamagePart, type Trap, isTrap, trapAt } from '../rules/traps.ts';
import { groupRoll, type Hero } from './checks.ts';
import { ABILITY_NAMES, titleCase } from './hooks.ts';
import type { PartyState } from './state.ts';

export interface Sprung { party: PartyState; lines: string[]; success: boolean }
type Votes = Readonly<Record<string, number>>;
type Detect = Trap['detect'];

const heroes = (party: PartyState): Hero[] => Object.entries(party.sheets).map(([playerId, sheet]) => ({ playerId, sheet }));
const living = (party: PartyState) => heroes(party).filter((h) => !h.sheet.dead);
const standing = (party: PartyState) => living(party).filter((h) => h.sheet.hp > 0);
const withSheets = (party: PartyState, hs: readonly Hero[], rng: Rng): PartyState =>
  ({ ...party, rng: rng.state(), sheets: { ...party.sheets, ...Object.fromEntries(hs.map((h) => [h.playerId, h.sheet])) } });

/** The standing hero with the best passive score for the detect check, if it reaches the DC. */
function spotter(party: PartyState, detect: Detect | null): { hero: Hero; score: number } | null {
  if (!detect) return null;
  const scored = standing(party).map((hero) => ({ hero, score: passiveScore(hero.sheet, detect) }));
  const best = scored.reduce<{ hero: Hero; score: number } | null>((top, s) => (top === null || s.score > top.score ? s : top), null);
  return best && best.score >= detect.dc ? best : null;
}

const spotLine = (who: Hero, score: number, detect: Detect, what: string) =>
  `${who.sheet.name} spots ${what} (passive ${titleCase(detect.skill)} ${score} vs DC ${detect.dc}).`;

/** "Damage 3 bludgeoning + 7 piercing" / "Damage 2 darts, 7 poison". */
function rollDamage(rng: Rng, parts: readonly DamagePart[]): { total: number; text: string } {
  const rolled = parts.map((p) => {
    const times = p.times ? rollDice(rng, parseDice(p.times)).total : 1;
    const total = Array.from({ length: times }, () => rollDice(rng, parseDice(p.dice)).total).reduce((a, b) => a + b, 0);
    return { total, text: `${p.times ? `${times} darts, ` : ''}${total} ${p.type}` };
  });
  return { total: rolled.reduce((sum, r) => sum + r.total, 0), text: `Damage ${rolled.map((r) => r.text).join(' + ')}` };
}


interface Taking { hero: Hero; share: number }

/** Damage rolled once; each hero takes their share (all, half on a save that halves it, none on one that doesn't). */
function damageAll(rng: Rng, trap: Trap, taking: readonly Taking[]): { heroes: Hero[]; lines: string[] } {
  const hit = taking.filter((t) => t.share > 0);
  if (trap.damage.length === 0 || hit.length === 0) return { heroes: taking.map((t) => t.hero), lines: [] };
  const damage = rollDamage(rng, trap.damage);
  const taken = (t: Taking) => Math.floor(damage.total * t.share);
  return {
    heroes: taking.map((t) => ({ ...t.hero, sheet: damageHero(t.hero.sheet, taken(t)) })),
    lines: [`${damage.text}: ${hit.map((t) => `${t.hero.sheet.name} takes ${taken(t)}`).join(', ')}`],
  };
}

/** The trap goes off on these heroes: their saves, the damage, and any condition on a failure. */
function trigger(party: PartyState, trap: Trap, targets: readonly Hero[], votes: Votes, rng: Rng): { party: PartyState; lines: string[] } {
  const saves = trap.save ? groupRoll([...targets], { kind: 'save', ability: trap.save.ability, dc: trap.save.dc }, votes, rng) : null;
  const saved = (i: number) => (saves ? saves.rolls[i].success : false);
  const onSave = trap.halfOnSave ? 0.5 : 0;
  const hurtHeroes = damageAll(rng, trap, targets.map((hero, i) => ({ hero, share: saved(i) ? onSave : 1 })));
  const failed = targets.filter((_, i) => !saved(i)).map((h) => h.sheet.name);
  const condition = trap.condition && failed.length ? [conditionLine(trap, failed)] : [];
  return { party: withSheets(party, hurtHeroes.heroes, rng), lines: [...(saves ? saves.lines : []), ...hurtHeroes.lines, ...condition] };
}

function conditionLine(trap: Trap, names: readonly string[]): string {
  const escape = trap.escape ? ` (DC ${trap.escape.dc} ${ABILITY_NAMES[trap.escape.ability]} (${titleCase(trap.escape.skill)}) to break free)` : '';
  return `${names.join(' and ')} ${names.length > 1 ? 'are' : 'is'} ${trap.condition}${escape}.`;
}

/** Who the trap catches: the first hero standing, or everyone standing. */
const targetsOf = (party: PartyState, trap: Trap) => (trap.targets === 'one' ? standing(party).slice(0, 1) : standing(party));

function disarm(party: PartyState, trap: Trap, votes: Votes, rng: Rng, before: string[]): Sprung {
  const d = trap.disarm!;
  const attempt = groupRoll(standing(party), { kind: 'check', ability: d.ability, skill: d.skill, tool: 'thieves-tools', dc: d.dc, mode: 'best' }, votes, rng);
  const lines = [...before, ...attempt.lines];
  if (attempt.success) return { party: { ...party, rng: rng.state() }, lines: [...lines, `The ${trap.name} is disarmed.`], success: true };
  const who = standing(party).filter((h) => h.playerId === attempt.rolls[0].playerId);
  const sprung = trigger(party, trap, who, {}, rng);
  return { party: sprung.party, lines: [...lines, `The ${trap.name} goes off.`, ...sprung.lines], success: false };
}

function springSrdTrap(party: PartyState, trap: Trap, votes: Votes): Sprung {
  const rng = seededRng(party.rng);
  const seen = spotter(party, trap.detect);
  if (seen && trap.disarm) return disarm(party, trap, votes, rng, [spotLine(seen.hero, seen.score, trap.detect, `a ${trap.name}`)]);
  if (seen) return { party, lines: [`${spotLine(seen.hero, seen.score, trap.detect, `a ${trap.name}`)} ${trap.avoid}`], success: true };
  const sprung = trigger(party, trap, targetsOf(party, trap), votes, rng);
  return { party: sprung.party, lines: [`Nobody notices the ${trap.name}.`, ...sprung.lines], success: false };
}

/** A hazard befalls every living hero. */
export function partyHazard(party: PartyState, spec: HazardSpec): { party: PartyState; lines: string[] } {
  const rng = seededRng(party.rng);
  const suffered = living(party).map((h) => ({ playerId: h.playerId, ...sufferHazard(rng, h.sheet, spec) }));
  return { party: withSheets(party, suffered, rng), lines: suffered.map((s) => s.line) };
}

export interface DungeonHazard { detect: Detect | null; spec: HazardSpec; what: string }

const NOTICE: Detect = { ability: 'wis', skill: 'perception', dc: 15 };
/** The Hidden Pit's depths by tier (5.2), for a crumbling floor. */
const FALL_FEET = [{ from: 17, feet: 120 }, { from: 11, feet: 60 }, { from: 5, feet: 30 }, { from: 1, feet: 10 }];

/** How an SRD hazard rolled for a dungeon room shows up there (original, CC0). */
const DUNGEON_HAZARDS: Readonly<Record<string, (level: number) => DungeonHazard>> = {
  falling: (level) => ({ detect: NOTICE, spec: { kind: 'falling', feet: FALL_FEET.find((t) => level >= t.from)!.feet }, what: 'a crumbling floor' }),
  burning: () => ({ detect: NOTICE, spec: { kind: 'burning' }, what: 'a jet of burning oil' }),
  suffocation: () => ({ detect: null, spec: { kind: 'suffocation', minutes: 1 }, what: 'a flooded passage' }),
  dehydration: () => ({ detect: null, spec: { kind: 'dehydration' }, what: 'a long, parched crawl' }),
};

export const dungeonHazard = (id: string, level: number): DungeonHazard | null => (Object.hasOwn(DUNGEON_HAZARDS, id) ? DUNGEON_HAZARDS[id](level) : null);

function springHazard(party: PartyState, h: DungeonHazard): Sprung {
  const seen = spotter(party, h.detect);
  if (seen) return { party, lines: [`${spotLine(seen.hero, seen.score, h.detect!, h.what)} The party finds a way around it.`], success: true };
  const struck = partyHazard(party, h.spec);
  return { party: struck.party, lines: [`The party meets ${h.what}.`, ...struck.lines], success: false };
}

/** A trap or hazard the party runs into (a dungeon room's, or the DM's), at the party's level. */
export function springTrap(party: PartyState, id: string, level: number, votes: Votes): Sprung {
  if (isTrap(id)) return springSrdTrap(party, trapAt(id, level), votes);
  const hazard = dungeonHazard(id, level);
  return hazard ? springHazard(party, hazard) : { party, lines: [], success: true };
}
