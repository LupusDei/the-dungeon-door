/**
 * The quest: every adventure with a set length has a goal, chosen from the seed when it starts and sized to
 * the party: a high fight for its level by the SRD 5.2 encounter budget (rules/encounter.ts; a lone hero at
 * levels 1–2 meets no more than a moderate one). Slay or drive off its master, recover an item from its
 * keepers, or rescue a captive. The adventure ends when the goal is reached, when every hero falls, or when
 * the host calls the ending. The scene count is pacing: the goal is placed so the shortest way to it fits the
 * scenes planned; wrong turns, fights on the way and rests take longer, for as many scenes again (overtime),
 * and then the ending is called. A fixed map holds the goal in a room on its main path; an explore dungeon
 * reveals it in the first room entered once the party is far enough in; a tale told brings on its foes when
 * the DM's choice carries the goal hook. See docs/rules-design.md.
 */
import { atLevel, startingLevel } from '../rules/depth.ts';
import { type Dungeon, type DungeonNode, magicItemPool, type RoomContents, rollTreasure } from '../rules/dungeon.ts';
import { candidates, composeEncounter, foeCap, stockedBudget, worthwhile } from '../rules/encounter.ts';
import { habitat, kindIdOf } from '../rules/habitats.ts';
import { monster } from '../rules/monsters.ts';
import { derivedRng, pick, type Rng } from '../rules/rng.ts';
import { claimTreasure } from './delve.ts';
import { startFight } from './fight.ts';
import type { StoredChoice } from '../types.ts';
import { foesNamed, hookLabel } from './hooks.ts';
import type { DungeonState, PartyState } from './state.ts';
import { lightLevel } from './time.ts';
import type { RulesState, RulesTurn } from './turn.ts';

export const QUEST_KINDS = ['slay', 'recover', 'rescue'] as const;
export type QuestKind = (typeof QUEST_KINDS)[number];

export interface Quest {
  kind: QuestKind;
  /** What the party is after: the foes' master (slay), a magic item (recover), a captive (rescue). */
  target: string;
  /** The goal's foes, monster ids: a high fight for the party. */
  foes: string[];
  /** Their XP together. */
  xp: number;
  /** The goal's room: on a fixed map from the start, in an explore dungeon once found; null in a tale told. */
  at: string | null;
  /** The tale's scenes the host planned, the epilogue included: pacing, not the end. */
  planned: number;
  /** Explore mode: the goal is the first room entered once this many areas past the entrance are visited. */
  findAfter?: number;
  /** A tale told: the goal's fight is on. */
  fighting?: true;
  reached: boolean;
  /** The ending was called, by the host or the cap, the goal not reached: no overtime (questClosed). */
  called?: true;
}

const CAPTIVES = ['a captured merchant', 'the miller’s daughter', 'a lost acolyte', 'a kidnapped scout', 'the reeve’s son'];

/** The scenes the goal is planned to take before it: the door (or the tale's opening) scene and the epilogue. */
const AROUND_THE_GOAL = 2;

const toughest = (ids: readonly string[]) => monster(ids.reduce((a, b) => (monster(b).xp > monster(a).xp ? b : a))).name;

/** The quest for a new adventure of `planned` tale scenes, and the dungeon with its goal room held, if a fixed map. */
export function planQuest(seed: number, levels: number[], planned: number, dungeon: DungeonState | null): { quest: Quest; dungeon: DungeonState | null } {
  const rng = derivedRng(seed, 'quest');
  const kind = pick(rng, QUEST_KINDS);
  const level = dungeon?.map.level ?? startingLevel(levels);
  const foeLevels = dungeon ? atLevel(levels.length, level) : levels;
  const encounter = goalFoes(rng, foeLevels, dungeon ? habitat(kindIdOf(dungeon.map.kind)) : undefined);
  const target = kind === 'slay' ? toughest(encounter.monsters) : kind === 'recover' ? pick(rng, magicItemPool(level)) : pick(rng, CAPTIVES);
  const quest: Quest = { kind, target, foes: encounter.monsters, xp: encounter.xp, at: null, planned, reached: false };
  if (!dungeon) return { quest, dungeon };
  if (dungeon.map.mode === 'explore') return { quest: { ...quest, findAfter: Math.max(1, planned - AROUND_THE_GOAL) }, dungeon };
  const at = goalRoom(dungeon.map, planned);
  return { quest: { ...quest, at }, dungeon: { ...dungeon, map: holding(dungeon.map, dungeon.map.nodes[at], { ...quest, at }, rng) } };
}

/**
 * The goal's foes, a high fight for these levels: a boss, one of the toughest kinds the budget affords, and
 * its band from what is left, up to the foe cap (rules/encounter.ts).
 */
function goalFoes(rng: Rng, levels: readonly number[], pool: readonly string[] | undefined): { xp: number; monsters: string[] } {
  const budget = stockedBudget(levels, 'high');
  const kinds = candidates(levels, pool).filter((m) => m.xp <= budget);
  const most = Math.max(...kinds.map((m) => m.xp));
  const boss = pick(rng, kinds.filter((m) => m.xp === most));
  const cap = foeCap(levels.length, Math.max(...levels)) - 1;
  const rest = kinds.filter((m) => m.xp <= budget - boss.xp);
  const band = cap > 0 && rest.length > 0 ? composeEncounter(rng, budget - boss.xp, worthwhile(rest, budget - boss.xp, cap), cap) : { xp: 0, monsters: [] };
  return { xp: boss.xp + band.xp, monsters: [boss.id, ...band.monsters] };
}

/** The fixed map's path room `planned - 2` moves from the entrance (one at least, its last room at most). */
function goalRoom(map: Dungeon, planned: number): string {
  const last = Number(map.goal!.slice(1));
  return `r${Math.min(last, Math.max(1, planned - AROUND_THE_GOAL))}`;
}

/** The map with the goal in this room: the goal's foes and its treasure (the item to recover among it). */
function holding(map: Dungeon, node: DungeonNode, quest: Quest, rng: Rng): Dungeon {
  const treasure = node.contents?.treasure ?? rollTreasure(rng, node.depth);
  const contents: RoomContents = {
    kind: 'monster', encounter: { difficulty: 'high', budget: quest.xp, xp: quest.xp, monsters: [...quest.foes] }, trap: null, special: null,
    treasure: quest.kind === 'recover' ? { ...treasure, magicItem: quest.target } : treasure, dressing: node.contents?.dressing ?? '',
  };
  return { ...map, goal: node.id, nodes: { ...map.nodes, [node.id]: { ...node, contents } } };
}

/** Explore mode: the room just entered becomes the goal, if it is a room, the goal is not yet found, and the party is far enough in. */
export function goalFound(quest: Quest, dungeon: DungeonState, node: DungeonNode): { quest: Quest; dungeon: DungeonState; node: DungeonNode } {
  const due = quest.at === null && quest.findAfter !== undefined && dungeon.visited.length - 1 >= quest.findAfter;
  if (!due || node.type !== 'room') return { quest, dungeon, node };
  const found = { ...quest, at: node.id };
  const map = holding(dungeon.map, node, found, derivedRng(dungeon.map.seed, `goal:${node.id}`));
  return { quest: found, dungeon: { ...dungeon, map }, node: map.nodes[node.id] };
}

const withQuest = (party: PartyState, quest: Quest): PartyState => ({ ...party, quest });

/** The quest after a turn: reached when its room is dealt with, or in a tale told when its fight is won or its foes flee. */
export function questAfter(t: RulesTurn): RulesTurn {
  const quest = t.party.quest;
  if (!quest || quest.reached) return t;
  const { fighting, ...rest } = quest;
  const fought = fighting ? t.fight : null;
  if (fought === 'defeat') return { ...t, party: withQuest(t.party, rest) };
  return goalReached(quest, t, fought) ? questDone(t, rest) : t;
}

/** Its room cleared, or in a tale told its fight won or its foes fled. */
const goalReached = (quest: Quest, t: RulesTurn, fought: RulesTurn['fight']): boolean =>
  quest.at !== null ? t.dungeon?.cleared.includes(quest.at) === true : fought === 'victory' || fought === 'fled';

/** The goal reached: said, and in a tale told the item recovered goes into the packs. */
function questDone(t: RulesTurn, quest: Quest): RulesTurn {
  const done = withQuest(t.party, { ...quest, reached: true });
  const loot = quest.at === null && quest.kind === 'recover' ? claimTreasure(done, { sp: 0, gp: 0, gems: 0, jewellery: 0, magicItem: quest.target }) : { party: done, lines: [] };
  return { ...t, party: loot.party, lines: [...t.lines, `The quest is done: ${goalText(quest)}.`, ...loot.lines] };
}

const said = (s: RulesState, line: string): RulesTurn => ({ ...s, lines: [line], success: null, fight: null, rolled: [], checks: [] });

/** A tale told: the DM's goal hook brings on the goal's foes. */
export function confrontGoal(s: RulesState): RulesTurn {
  const quest = s.party.quest;
  if (!quest) return said(s, 'There is no quest.');
  if (quest.reached) return said(s, 'The quest is already done.');
  if (s.dungeon || quest.at !== null) return said(s, 'The quest’s goal is in the dungeon, not here.');
  const started = startFight(withQuest(s.party, { ...quest, fighting: true }), quest.foes, lightLevel(s));
  return { ...s, party: started.party, combat: started.combat, lines: started.lines, success: null, fight: 'started', rolled: [], checks: [] };
}

/** The scenes past the plan the party has to reach the goal: as many again while it is open; none once reached or called. */
export const overtime = (quest: Quest | undefined): number => (questOpen(quest) ? quest!.planned : 0);

/** The ending called, by the host or by the cap (or every hero fallen): a quest still open is closed, its goal not reached. */
export const questClosed = (party: PartyState): PartyState => (questOpen(party.quest) ? withQuest(party, { ...party.quest!, called: true }) : party);

/** The goal not yet reached, and the ending not called: the scene count is only the plan. */
export const questOpen = (quest: Quest | undefined): boolean => !!quest && !quest.reached && !quest.called;

const GOALS: Readonly<Record<QuestKind, (q: Quest) => string>> = {
  slay: (q) => `Slay or drive off the ${q.target}${q.foes.length > 1 ? ` and its band (${foesNamed(q.foes)})` : ''}`,
  recover: (q) => `Recover the ${q.target} from its keepers (${foesNamed(q.foes)})`,
  rescue: (q) => `Rescue ${q.target} from the captors (${foesNamed(q.foes)})`,
};

/** "Slay or drive off the Owlbear and its band (Owlbear, Wolf ×2)". */
export const goalText = (quest: Quest): string => GOALS[quest.kind](quest);

/** The quest as the table and the DM see it. Null for a game with no set length, which has none. */
export interface QuestView {
  kind: QuestKind;
  /** "Slay or drive off the Ogre and its band (…)". */
  goal: string;
  reached: boolean;
  /** "in the well room" (its room's purpose), "deeper in the dungeon" until an explore dungeon reveals it, or null in a tale told. */
  where: string | null;
}

export function questView(s: RulesState): QuestView | null {
  const quest = s.party.quest;
  if (!quest) return null;
  const room = quest.at !== null ? s.dungeon?.map.nodes[quest.at] : undefined;
  const where = room ? `in the ${(room.purpose ?? room.name).toLowerCase()}` : s.dungeon ? 'deeper in the dungeon' : null;
  return { kind: quest.kind, goal: goalText(quest), reached: quest.reached, where };
}

/**
 * A tale told past its plan (`next` at or past the planned epilogue of `sceneCount`), the goal still open: the
 * first choice faces the goal, unless the DM already offers it. A dungeon's goal is walked to instead.
 */
export function towardTheGoal(choices: StoredChoice[], s: RulesState, next: number, sceneCount: number): StoredChoice[] {
  const quest = s.party.quest;
  const pressed = questOpen(quest) && !s.dungeon && quest!.at === null && next >= sceneCount - 1;
  if (!pressed || choices.some((c) => c.hook?.kind === 'goal')) return choices;
  const hook = { kind: 'goal' as const };
  return [{ id: choices[0].id, label: 'Face the goal', detail: `${goalText(quest!)}.`, hook, rules: hookLabel(hook) }, ...choices.slice(1)];
}
