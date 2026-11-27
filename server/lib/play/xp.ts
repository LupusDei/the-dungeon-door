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
 */
import { awardXp } from '../rules/leveling.ts';
import { encounterBudget } from '../rules/monsters.ts';
import type { PartyState } from './state.ts';

export const XP_TAGS = ['discovery', 'social', 'puzzle', 'milestone'] as const;
/** What the DM may say a choice is, for the engine to pay XP for. */
export type XpTag = (typeof XP_TAGS)[number];

/** A tag the DM wrote, if it is one; anything else ("none", a typo) is no tag. */
export const xpTag = (value: unknown): XpTag | null =>
  ((XP_TAGS as readonly unknown[]).includes(value) ? (value as XpTag) : null);

export type XpReason = 'took-part' | 'success' | 'brave-failure' | 'trap' | 'puzzle' | 'social' | 'discovery' | 'new-ground' | 'chapter' | 'deeper' | 'quest';

/** Each reason's share of the hero's unit, in the order the lines are told. */
export const XP_SHARES: Readonly<Record<XpReason, number>> = {
  'took-part': 0.1,
  success: 0.2,
  'brave-failure': 0.1,
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
  success: 'a success',
  'brave-failure': 'a brave failure',
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
const TAGGED: Readonly<Record<XpTag, XpReason>> = { discovery: 'discovery', social: 'social', puzzle: 'puzzle', milestone: 'chapter' };

/** Scenes from one chapter milestone to the next. */
export const CHAPTER_EVERY = 3;

/** A hero's unit: the SRD 5.2 Low encounter budget for its level. Everything but a milestone is capped at one a scene. */
export const xpUnit = (level: number): number => encounterBudget([level], 'low');
export const xpFor = (reason: XpReason, level: number): number => Math.round(xpUnit(level) * XP_SHARES[reason]);

/** What the engine saw happen that the whole party shares. */
export type XpEvent = 'trap' | 'social' | 'new-ground' | 'deeper';

/** A hero who declared this scene. idle: the server threw their die for them (the window ran out, or the host advanced). */
export interface Actor { playerId: string; idle: boolean }

export interface Deeds {
  sceneIndex: number;
  actors: readonly Actor[];
  /** The d20s the engine rolled for heroes outside a fight this scene (checks, saves, a parley, a written check). */
  rolls: readonly { playerId: string; success: boolean }[];
  events: readonly XpEvent[];
  /** The chosen choice's tag, already dropped when its dice failed. */
  tag: XpTag | null;
  /** A round of a fight: the fight pays its own XP, so the heroes who acted are only counted as having taken part. */
  round?: boolean;
}

/** One hero's XP for the scene, reason by reason. */
export interface XpAward { playerId: string; xp: number; idle: boolean; reasons: { reason: XpReason; xp: number }[] }

export interface Awarded { party: PartyState; awards: XpAward[]; lines: string[] }

function reasonsOf(actor: Actor, deeds: Deeds, chapterOpen: boolean): XpReason[] {
  const mine = deeds.rolls.filter((r) => r.playerId === actor.playerId);
  const roll: XpReason[] = mine.length === 0 ? [] : mine.some((r) => r.success) ? ['success'] : ['brave-failure'];
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

const award = (playerId: string, idle: boolean, reasons: XpAward['reasons']): XpAward =>
  ({ playerId, idle, reasons, xp: reasons.reduce((n, r) => n + r.xp, 0) });

/** The scene's XP for each hero who declared, added to their sheets; the awards replace the last scene's. */
export function sceneXp(party: PartyState, deeds: Deeds): Awarded {
  const actors = deeds.actors.filter((a, i) => Object.hasOwn(party.sheets, a.playerId) && !party.sheets[a.playerId].dead
    && deeds.actors.findIndex((b) => b.playerId === a.playerId) === i);
  if (deeds.round) return { party: { ...pay(party, [], actors.map((a) => a.playerId)), xpAwards: [] }, awards: [], lines: [] };
  const open = party.chapterAt === undefined || deeds.sceneIndex - party.chapterAt >= CHAPTER_EVERY;
  const awards = actors
    .map((a) => award(a.playerId, a.idle, amounts(reasonsOf(a, deeds, open), party.sheets[a.playerId].level, a.idle)))
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
    byHero.set(a.playerId, had ? award(a.playerId, had.idle, [...had.reasons, ...a.reasons]) : a);
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
