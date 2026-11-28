/**
 * Experience without a fight (docs/rules-design.md, "Experience without a fight"). The 2014 DMG gives a
 * non-combat challenge the XP of a fight of the same difficulty, and a milestone that of an easy (minor) or
 * hard (major) fight; the 2024 rules keep that. Here a hero's unit is the SRD 5.2 Low encounter budget for
 * its own level (50 XP at level 1), and every reason pays a share of it, so the awards grow with the hero.
 *
 * The engine owns every number. The DM may tag a choice it offers (discovery, social, puzzle, milestone);
 * the tag pays only when the party takes that choice and its dice do not fail. Only heroes who declared
 * something this scene earn; a hero whose die was left to the clock earns half. Everything but a milestone
 * is capped at one unit per hero per scene, and a chapter milestone comes at most once every three scenes.
 * The heroes still level up only at the quest's end (play/table.ts endQuest).
 *
 * Experience from actions (docs/rules-design.md, "Experience from actions"): a hero's d20 is paid by how
 * likely its result was (play/odds.ts), in place of a flat success or failure. A sure thing earns very
 * little; a success against the odds, a long shot that landed, a failure that should not have happened earn
 * more, the rarer the more. A round of a fight pays every hero who acted a little, and the same surprises a
 * quarter of what they earn outside one: the fight still pays its own XP at its end.
 */
import { awardXp } from '../rules/leveling.ts';
import { encounterBudget } from '../rules/monsters.ts';
import { likelihood, rarityOf } from './odds.ts';
import type { PartyState } from './state.ts';

export const XP_TAGS = ['discovery', 'social', 'puzzle', 'milestone'] as const;
/** What the DM may say a choice is, for the engine to pay XP for. */
export type XpTag = (typeof XP_TAGS)[number];

/** A tag the DM wrote, if it is one; anything else ("none", a typo) is no tag. */
export const xpTag = (value: unknown): XpTag | null =>
  ((XP_TAGS as readonly unknown[]).includes(value) ? (value as XpTag) : null);

export type XpReason = 'took-part' | 'sure-thing' | 'success' | 'against-odds' | 'long-shot' | 'brave-failure' | 'hard-lesson' | 'sure-slip' | 'in-fight'
  | 'trap' | 'puzzle' | 'social' | 'discovery' | 'new-ground' | 'chapter' | 'deeper' | 'quest';

/**
 * Each reason's share of the hero's unit, in the order the lines are told. A hero's d20 earns one of the seven
 * after taking part, by the chance its result had: a success at 9 in 10 or better, plainly, at 1 in 4 or
 * worse, at 1 in 10 or worse; a failure plainly, or one that had 1 chance in 4 or worse, 1 in 10 or worse. An
 * unlikely failure earns three quarters of the success at the same odds.
 */
export const XP_SHARES: Readonly<Record<XpReason, number>> = {
  'took-part': 0.1,
  'sure-thing': 0.05,
  success: 0.2,
  'against-odds': 0.4,
  'long-shot': 0.8,
  'brave-failure': 0.1,
  'hard-lesson': 0.3,
  'sure-slip': 0.6,
  'in-fight': 0.02,
  trap: 0.5,
  puzzle: 0.5,
  social: 0.5,
  discovery: 0.2,
  'new-ground': 0.1,
  chapter: 0.5,
  deeper: 0.5,
  quest: 1,
};

export const XP_LABELS: Readonly<Record<XpReason, string>> = {
  'took-part': 'taking part',
  'sure-thing': 'a sure thing',
  success: 'a success',
  'against-odds': 'against the odds',
  'long-shot': 'a long shot that landed',
  'brave-failure': 'a brave failure',
  'hard-lesson': 'a hard lesson',
  'sure-slip': 'a sure thing that slipped',
  'in-fight': 'in the fight',
  trap: 'a trap overcome',
  puzzle: 'a puzzle solved',
  social: 'a clever parley',
  discovery: 'a discovery',
  'new-ground': 'new ground',
  chapter: 'a chapter closed',
  deeper: 'deeper into the dungeon',
  quest: 'the adventure’s end',
};

const ORDER = Object.keys(XP_SHARES) as XpReason[];
const MILESTONES: readonly XpReason[] = ['chapter', 'deeper', 'quest'];
/** The results that were not the likely one: these are what a round of a fight pays for, and tells in its lines. */
const SURPRISES: readonly XpReason[] = ['against-odds', 'long-shot', 'hard-lesson', 'sure-slip'];
/** A round is six seconds of a fight that pays for itself: a surprise in one earns a quarter of what it does outside a fight. */
export const ROUND_SCALE = 0.25;
const TAGGED: Readonly<Record<XpTag, XpReason>> = { discovery: 'discovery', social: 'social', puzzle: 'puzzle', milestone: 'chapter' };

/** Scenes from one chapter milestone to the next. */
export const CHAPTER_EVERY = 3;

/** A hero's unit: the SRD 5.2 Low encounter budget for its level. Everything but a milestone is capped at one a scene. */
export const xpUnit = (level: number): number => encounterBudget([level], 'low');
export const xpFor = (reason: XpReason, level: number): number => Math.round(xpUnit(level) * XP_SHARES[reason]);
/** What a hero's action earns in a round of a fight: a surprise at a quarter, anything else "in the fight". */
export const roundXpFor = (reason: XpReason, level: number): number =>
  (SURPRISES.includes(reason) ? Math.round(xpUnit(level) * XP_SHARES[reason] * ROUND_SCALE) : xpFor('in-fight', level));

/** A d20 rolled for a hero: whether it came good, and the chance it had of doing so (play/odds.ts). Without a chance it is paid plainly. */
export interface Rolled { playerId: string; success: boolean; chance?: number }

/** What a d20 earns, by the chance its result had. */
export function rollReason(die: Pick<Rolled, 'success' | 'chance'>): XpReason {
  if (die.chance === undefined) return die.success ? 'success' : 'brave-failure';
  const rarity = rarityOf(likelihood({ success: die.success, chance: die.chance }));
  if (die.success) return rarity === 'rare' ? 'long-shot' : rarity === 'unlikely' ? 'against-odds' : rarity === 'sure' ? 'sure-thing' : 'success';
  return rarity === 'rare' ? 'sure-slip' : rarity === 'unlikely' ? 'hard-lesson' : 'brave-failure';
}

/** Of a hero's d20s this turn, the one that earns most: an action is paid once, for its most telling die. */
function telling(dice: readonly Rolled[]): { reason: XpReason; chance?: number } | null {
  let best: { reason: XpReason; chance?: number } | null = null;
  for (const die of dice) {
    const reason = rollReason(die);
    if (best === null || XP_SHARES[reason] > XP_SHARES[best.reason]) {
      best = { reason, ...(die.chance === undefined ? {} : { chance: likelihood({ success: die.success, chance: die.chance }) }) };
    }
  }
  return best;
}

/** What the engine saw happen that the whole party shares. */
export type XpEvent = 'trap' | 'social' | 'new-ground' | 'deeper';

/** A hero who declared this scene. idle: the server threw their die for them (the window ran out, or the host advanced). */
export interface Actor { playerId: string; idle: boolean }

export interface Deeds {
  sceneIndex: number;
  actors: readonly Actor[];
  /**
   * The d20s that decided the heroes' actions this turn, each with the chance it had: outside a fight a check,
   * a save, a parley, a written check; in a round an attack, a spell attack, a foe's save against a hero's spell.
   */
  rolls: readonly Rolled[];
  events: readonly XpEvent[];
  /** The chosen choice's tag, already dropped when its dice failed. */
  tag: XpTag | null;
  /**
   * A round of a fight: the fight pays its own XP at its end, so nothing here is shared or tagged. Each hero
   * who acted earns for the action alone: a little, or a quarter of what a surprise earns outside a fight.
   * `actors` are then the heroes who could act and declared.
   */
  round?: boolean;
}

/**
 * One hero's XP for the scene or round, reason by reason. `chance`: for the reason their d20 earned, the
 * chance its result had (0 to 1); absent when no d20 decided it.
 */
export interface XpAward { playerId: string; xp: number; idle: boolean; reasons: { reason: XpReason; xp: number }[]; chance?: number }

export interface Awarded { party: PartyState; awards: XpAward[]; lines: string[] }

/** The hero's own d20s this turn. */
const diceOf = (actor: Actor, deeds: Deeds) => deeds.rolls.filter((r) => r.playerId === actor.playerId);

function reasonsOf(actor: Actor, deeds: Deeds, chapterOpen: boolean): XpReason[] {
  const told = telling(diceOf(actor, deeds));
  const roll: XpReason[] = told ? [told.reason] : [];
  const shared: XpReason[] = [...deeds.events, ...(deeds.tag ? [TAGGED[deeds.tag]] : [])];
  const all = new Set<XpReason>(['took-part', ...roll, ...shared]);
  const milestone = chapterOpen ? shared.find((r) => MILESTONES.includes(r)) : undefined;
  return ORDER.filter((r) => all.has(r) && (!MILESTONES.includes(r) || r === milestone));
}

/** The amounts for one hero: everything but a milestone within one unit, then halved for an idle hero. */
function amounts(reasons: readonly XpReason[], level: number, idle: boolean): XpAward['reasons'] {
  let room = xpUnit(level);
  return reasons.flatMap((reason) => {
    const full = xpFor(reason, level);
    const capped = MILESTONES.includes(reason) ? full : Math.min(full, room);
    if (!MILESTONES.includes(reason)) room -= capped;
    const xp = idle ? Math.floor(capped / 2) : capped;
    return xp > 0 ? [{ reason, xp }] : [];
  });
}

/** "+25 XP: a clever parley (Bryn, Cleo)", one line per reason and amount. */
export function xpLines(awards: readonly XpAward[], party: PartyState): string[] {
  return ORDER.flatMap((reason) => {
    const groups = new Map<string, string[]>();
    for (const a of awards) {
      const got = a.reasons.find((r) => r.reason === reason);
      if (!got) continue;
      const key = `${got.xp}|${a.idle}`;
      groups.set(key, [...(groups.get(key) ?? []), party.sheets[a.playerId].name]);
    }
    return [...groups].map(([key, names]) => {
      const [xp, idle] = key.split('|');
      return `+${xp} XP: ${XP_LABELS[reason]}${idle === 'true' ? ', halved: their die was left to the clock' : ''} (${names.join(', ')}).`;
    });
  });
}

function pay(party: PartyState, awards: readonly XpAward[], counted: readonly string[]): PartyState {
  const sheets = { ...party.sheets };
  const earned = { ...(party.earned ?? {}) };
  for (const id of counted) earned[id] = earned[id] ?? 0;
  for (const a of awards) {
    sheets[a.playerId] = awardXp(sheets[a.playerId], a.xp);
    earned[a.playerId] = (earned[a.playerId] ?? 0) + a.xp;
  }
  return { ...party, sheets, earned };
}

const award = (playerId: string, idle: boolean, reasons: XpAward['reasons'], chance?: number): XpAward =>
  ({ playerId, idle, reasons, xp: reasons.reduce((n, r) => n + r.xp, 0), ...(chance === undefined ? {} : { chance }) });

/** The chance of the result a hero's d20 was paid for, when one of the reasons is the d20's. */
const chanceOfRoll = (actor: Actor, deeds: Deeds): number | undefined => telling(diceOf(actor, deeds))?.chance;

/** A round of a fight: the hero's action alone, halved for a die the clock threw. A surprise is told in the lines; "in the fight" is not. */
function roundAward(actor: Actor, deeds: Deeds, level: number): XpAward {
  const told = telling(diceOf(actor, deeds));
  const reason: XpReason = told && SURPRISES.includes(told.reason) ? told.reason : 'in-fight';
  const full = roundXpFor(reason, level);
  const xp = actor.idle ? Math.floor(full / 2) : full;
  return award(actor.playerId, actor.idle, xp > 0 ? [{ reason, xp }] : [], reason === 'in-fight' ? undefined : told?.chance);
}

/** The scene's XP for each hero who declared, added to their sheets; the awards replace the last scene's. */
export function sceneXp(party: PartyState, deeds: Deeds): Awarded {
  const actors = deeds.actors.filter((a, i) => Object.hasOwn(party.sheets, a.playerId) && !party.sheets[a.playerId].dead
    && deeds.actors.findIndex((b) => b.playerId === a.playerId) === i);
  if (deeds.round) {
    const earned = actors.map((a) => roundAward(a, deeds, party.sheets[a.playerId].level)).filter((a) => a.xp > 0);
    const told = earned.filter((a) => a.reasons.some((r) => SURPRISES.includes(r.reason)));
    return { party: { ...pay(party, earned, actors.map((a) => a.playerId)), xpAwards: earned }, awards: earned, lines: xpLines(told, party) };
  }
  const open = party.chapterAt === undefined || deeds.sceneIndex - party.chapterAt >= CHAPTER_EVERY;
  const awards = actors
    .map((a) => award(a.playerId, a.idle, amounts(reasonsOf(a, deeds, open), party.sheets[a.playerId].level, a.idle), chanceOfRoll(a, deeds)))
    .filter((a) => a.xp > 0);
  const paid = pay(party, awards, actors.map((a) => a.playerId));
  const chaptered = awards.some((a) => a.reasons.some((r) => r.reason === 'chapter' || r.reason === 'deeper'));
  return { party: { ...paid, xpAwards: awards, ...(chaptered ? { chapterAt: deeds.sceneIndex } : {}) }, awards, lines: xpLines(awards, party) };
}

/** Two awards to one hero in the same scene, as one. */
function merged(awards: readonly XpAward[]): XpAward[] {
  const byHero = new Map<string, XpAward>();
  for (const a of awards) {
    const had = byHero.get(a.playerId);
    byHero.set(a.playerId, had ? award(a.playerId, had.idle, [...had.reasons, ...a.reasons], had.chance ?? a.chance) : a);
  }
  return [...byHero.values()];
}

/** The quest is over: each living hero who took part in it gets the major milestone, before it levels up. */
export function questXp(party: PartyState): Awarded {
  const earned = party.earned ?? {};
  const awards = Object.entries(party.sheets)
    .filter(([id, s]) => !s.dead && Object.hasOwn(earned, id))
    .map(([id, s]) => award(id, false, [{ reason: 'quest', xp: xpFor('quest', s.level) }]));
  const paid = pay(party, awards, []);
  return { party: { ...paid, xpAwards: merged([...(party.xpAwards ?? []), ...awards]) }, awards, lines: xpLines(awards, party) };
}
