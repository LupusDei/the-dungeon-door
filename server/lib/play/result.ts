/**
 * A resolved turn in numbers, for the app's result screen (docs/api.md, TurnResult): which choice the party
 * went with and who picked it, what each hero did, and each d20 under the hero it was rolled for. Pure: it
 * reads what the engine already decided (play/turn.ts) and rolls nothing.
 *
 * Outside a fight the d20s come from the turn's `checks`: the party's choice (its check, save, parley or
 * trap) and each hero's own written action. In a combat round a hero's weapon attacks are read back from the
 * engine's own lines (ATTACK_LINE). Any other d20 (a spell in a fight, a death save, breaking free of a net)
 * stays a line: under its hero in `lines`, and in `notes`.
 */
import type { Mode } from '../rules/resolve.ts';
import type { ChoiceId, StoredChoice, Vote } from '../types.ts';
import { checkName, isPersonalCheck } from './actions.ts';
import { helpLine, type TurnCheck } from './checks.ts';
import type { RulesHook } from './hooks.ts';
import type { RulesState, RulesTurn } from './turn.ts';
import { XP_LABELS, type XpAward, type XpReason } from './xp.ts';
import { canAct } from './your-turn.ts';

/** One d20 rolled for a hero this turn. */
export interface TurnRoll {
  /** The party's choice, the hero's own action, or an attack in a fight. */
  for: 'choice' | 'own' | 'attack';
  /** "Persuasion", "Dexterity save", "Stealth", "Shortbow". */
  name: string;
  /** The face that counted. */
  natural: number;
  /** Both faces under Advantage or Disadvantage; else the one. An attack has only the face that counted. */
  dice: number[];
  /** An attack is always "normal": the engine's line does not say how it was rolled. */
  mode: Mode;
  bonus: number;
  total: number;
  against: { kind: 'dc' | 'ac'; value: number };
  success: boolean;
  /** The table rolled this die for the hero; false when it is the d20 of their own pick or action. */
  fresh: boolean;
  /** The heroes whose Help gave Advantage. */
  helpers: string[];
  /** What a success did beyond passing ("Improvised damage 2 slashing", "critical hit"), or null. */
  detail: string | null;
}

export type HeroDid = 'choice' | 'own' | 'action' | 'nothing' | 'down';

export interface HeroResult {
  playerId: string;
  name: string;
  /**
   * "down": at 0 hit points or dead when the turn began (in a fight: could not act). "action": a combat
   * action. "choice": picked a plot choice. "own": wrote their own action, or used a skill or ability.
   * "nothing": did not act.
   */
  did: HeroDid;
  /** The plot choice they picked. Outside a fight a fallen hero's player still has a say, so "down" may carry one. */
  choiceId?: ChoiceId;
  /** The choice's label, the combat action ("Attack with Shortbow"), or the check's name ("Athletics"). */
  label?: string;
  /** The words they wrote, when they wrote any. */
  text?: string;
  /** Their d20 was left to the clock: the server threw it. */
  byClock: boolean;
  rolls: TurnRoll[];
  /** The engine's lines that are about this hero: those that begin with their name, their dice lines included. */
  lines: string[];
  /** What the hero earned this turn and why (play/xp.ts); null when they earned nothing. Absent on a turn stored before this. */
  xp?: HeroXp | null;
}

/**
 * One hero's XP for the turn, in the words the dice log uses. `chance`: for the reason their d20 earned, the
 * chance its result had (0 to 1), or null when no d20 decided it. The fight's own XP and the adventure's-end
 * award are not here: they are lines.
 */
export interface HeroXp {
  total: number;
  /** Their die was left to the clock: every amount is already halved. */
  idle: boolean;
  reasons: { reason: XpReason; label: string; xp: number }[];
  chance: number | null;
}

export interface ChoiceResult {
  id: ChoiceId;
  label: string;
  rules: string | null;
  backers: string[];
  tally: Record<ChoiceId, number>;
  tie: { between: ChoiceId[]; playerId: string; roll: number } | null;
  success: boolean | null;
}

export interface TurnResult {
  sceneIndex: number;
  combat: boolean;
  choice: ChoiceResult | null;
  heroes: HeroResult[];
  notes: string[];
}

/** A pick the tally counted: a vote for a, b or c from a player at the table, with its d20. */
export interface ChoicePick { playerId: string; choiceId: ChoiceId; roll: number }

/** What a turn's result is built from. */
export interface TurnFacts {
  /** The scene as stored: its choices with their hooks, and every vote (a pick, a named action, a written check). */
  scene: { index: number; choices: readonly StoredChoice[]; votes: readonly Vote[] };
  /** Everyone at the table, in joining order. */
  players: readonly { playerId: string; name: string }[];
  /** The rules state before the turn: whether a fight was on, and who was down or dead. */
  before: Pick<RulesState, 'party' | 'combat'>;
  /** The picks the tally counted (a written action is not one), the tally, and the leaders before the tie-break. */
  picks: readonly ChoicePick[];
  tally: Readonly<Record<ChoiceId, number>>;
  leaders: readonly ChoiceId[];
  /** The choice the engine went with; null when nobody picked one. */
  chosen: ChoiceId | null;
  /** The chosen choice's rules text, as the scene view gives it (play/table.ts choiceView). */
  rules: string | null;
  /** The turn as the engine played it: its lines (without the scene's XP lines), its outcome, its d20s. */
  turn: Pick<RulesTurn, 'lines' | 'success' | 'checks'>;
  /** A combat round: what each hero's action is called ("Attack with Shortbow"), by player id. */
  actions?: Readonly<Record<string, string>>;
  /** What each hero earned this turn (play/xp.ts sceneXp); none given, nobody is shown earning. */
  awards?: readonly XpAward[];
}

/**
 * A weapon attack as play/fight.ts tells it:
 * "Bryn attacks Goblin Warrior with Longsword: 14 (total 19) vs AC 15, hit." The outcome is "hit",
 * "critical hit" or "miss", with " for 7" when the target's hit points are told (a hero's are; a foe's are
 * not), and a hit's rider after the full stop ("Bryn is Grappled."). A reaction is led by "Opportunity
 * Attack: ". Groups: attacker, target, weapon, natural, total, AC, outcome, damage, rider.
 * result.test.ts holds this against the lines a real round writes.
 */
export const ATTACK_LINE = /^(?:Opportunity Attack: )?(.+?) attacks (.+?) with (.+?): (\d+) \(total (-?\d+)\) vs AC (\d+), (critical hit|hit|miss)(?: for (\d+))?\.(?: (.+))?$/;
const REACTION = 'Opportunity Attack: ';

interface Attack { attacker: string; reaction: boolean; roll: TurnRoll }

/** The attack a line tells, or null when the line is not one. */
export function attackOf(line: string): Attack | null {
  const m = ATTACK_LINE.exec(line);
  if (!m) return null;
  const [, attacker, , weapon, natural, total, ac, outcome, damage, rider] = m;
  const told = `${outcome}${damage === undefined ? '' : ` for ${damage}`}`;
  const more = [told === 'hit' || told === 'miss' ? null : told, rider ? rider.replace(/\.$/, '') : null].filter((part): part is string => part !== null);
  return {
    attacker, reaction: line.startsWith(REACTION),
    roll: {
      for: 'attack', name: weapon, natural: Number(natural), dice: [Number(natural)], mode: 'normal',
      bonus: Number(total) - Number(natural), total: Number(total), against: { kind: 'ac', value: Number(ac) },
      success: outcome !== 'miss', fresh: false, helpers: [], detail: more.length ? more.join('. ') : null,
    },
  };
}

const rollOf = (c: TurnCheck): TurnRoll => ({
  for: c.for, name: c.name, natural: c.natural, dice: [...c.dice], mode: c.mode, bonus: c.bonus, total: c.total,
  against: { kind: 'dc', value: c.dc }, success: c.success, fresh: c.fresh, helpers: [...c.helpers], detail: c.detail,
});

/** Hooks whose outcome is a roll the party passes or fails. */
const ROLLED: readonly RulesHook['kind'][] = ['check', 'save', 'parley'];

function choiceOf(f: TurnFacts): ChoiceResult | null {
  const choice = f.before.combat || f.chosen === null ? undefined : f.scene.choices.find((c) => c.id === f.chosen);
  if (!choice) return null;
  const backing = f.picks.filter((p) => p.choiceId === choice.id);
  const top = backing.reduce<ChoicePick | null>((best, p) => (best === null || p.roll > best.roll ? p : best), null);
  return {
    id: choice.id,
    label: choice.label,
    rules: f.rules,
    backers: backing.map((p) => p.playerId),
    tally: { a: f.tally.a, b: f.tally.b, c: f.tally.c },
    tie: f.leaders.length > 1 && top ? { between: [...f.leaders], playerId: top.playerId, roll: top.roll } : null,
    success: choice.hook && ROLLED.includes(choice.hook.kind) ? f.turn.success : null,
  };
}

/** Could this hero act when the turn began? In a fight, a hero who is up; outside one, a hero neither dead nor at 0 hit points. */
function couldAct(before: TurnFacts['before'], playerId: string): boolean {
  if (before.combat) return canAct(before.combat, playerId);
  const sheet = Object.hasOwn(before.party.sheets, playerId) ? before.party.sheets[playerId] : null;
  return !sheet || (!sheet.dead && sheet.hp > 0);
}

/** The line without the words a reaction is led by, so it begins with whoever it is about. */
const told = (line: string) => (line.startsWith(REACTION) ? line.slice(REACTION.length) : line);
/** "Bryn: …", "Bryn attacks …", "Bryn's death save …"; not "Brynhild: …". */
const beginsWith = (line: string, name: string) => name !== '' && line.startsWith(name) && !/[\p{L}\p{N}]/u.test(line.charAt(name.length));

/**
 * Whose line it is: the heroes whose name it begins with, the longest such name winning ("Bryn the Bold"
 * over "Bryn"). Two heroes of one name share their lines; nothing in a line tells them apart.
 */
function ownersOf(line: string, names: ReadonlyMap<string, string>): string[] {
  const subject = told(line);
  const matching = [...names].filter(([, name]) => beginsWith(subject, name));
  const longest = Math.max(0, ...matching.map(([, name]) => name.length));
  return matching.filter(([, name]) => name.length === longest).map(([playerId]) => playerId);
}

interface Rolled { roll: TurnRoll; lines: string[] }

/** A hero's weapon attacks this round, read back from the lines. The first is thrown with their own d20; an extra attack or a reaction is the table's die. */
function attacksOf(lines: readonly string[], name: string): Rolled[] {
  let thrown = false;
  return lines.flatMap((line): Rolled[] => {
    const attack = attackOf(line);
    if (!attack || attack.attacker !== name) return [];
    const fresh = attack.reaction || thrown;
    if (!attack.reaction) thrown = true;
    return [{ roll: { ...attack.roll, fresh }, lines: [line] }];
  });
}

/** The hero's d20s outside a fight: each with its dice line, and the Help line that gave it Advantage. */
const checksOf = (checks: readonly TurnCheck[], playerId: string): Rolled[] =>
  checks.filter((c) => c.playerId === playerId).map((c) => ({ roll: rollOf(c), lines: [c.line, ...(c.helpers.length ? [helpLine(c.helpers)] : [])] }));

function heroOf(f: TurnFacts, player: TurnFacts['players'][number], names: ReadonlyMap<string, string>): { hero: HeroResult; dice: string[] } {
  const { playerId } = player;
  const name = names.get(playerId)!;
  const round = f.before.combat !== null;
  const vote = f.scene.votes.find((v) => v.playerId === playerId);
  const own = vote !== undefined && isPersonalCheck(vote);
  const pick = round ? undefined : f.picks.find((p) => p.playerId === playerId);
  const able = couldAct(f.before, playerId);
  const did: HeroDid = !able ? 'down' : !vote ? 'nothing' : round ? 'action' : own ? 'own' : 'choice';
  const label = own
    ? checkName(vote.freeform!.ruling!)
    : round ? (able && vote ? f.actions?.[playerId] : undefined) : pick && f.scene.choices.find((c) => c.id === pick.choiceId)?.label;
  const words = vote?.freeform?.text;
  const rolled = round ? attacksOf(f.turn.lines, name) : checksOf(f.turn.checks, playerId);
  return {
    hero: {
      playerId, name, did,
      ...(pick ? { choiceId: pick.choiceId } : {}),
      ...(label ? { label } : {}),
      ...(words && words !== label ? { text: words } : {}),
      byClock: vote?.autoRolled === true,
      rolls: rolled.map((r) => r.roll),
      lines: f.turn.lines.filter((line) => ownersOf(line, names).includes(playerId)),
      xp: xpOf(f.awards?.find((a) => a.playerId === playerId)),
    },
    dice: rolled.flatMap((r) => r.lines),
  };
}

/** A hero's award as the result shows it: each reason with the dice log's words for it. */
function xpOf(award: XpAward | undefined): HeroXp | null {
  if (!award || award.xp <= 0) return null;
  return {
    total: award.xp, idle: award.idle,
    reasons: award.reasons.map((r) => ({ reason: r.reason, label: XP_LABELS[r.reason], xp: r.xp })),
    chance: award.chance ?? null,
  };
}

/** The turn's result: the choice, every player at the table as a hero, and what else the engine said. */
export function turnResult(f: TurnFacts): TurnResult {
  const names = new Map(f.players.map((p) => [p.playerId, Object.hasOwn(f.before.party.sheets, p.playerId) ? f.before.party.sheets[p.playerId].name : p.name]));
  const heroes = f.players.map((p) => heroOf(f, p, names));
  const dice = new Set(heroes.flatMap((h) => h.dice));
  return {
    sceneIndex: f.scene.index,
    combat: f.before.combat !== null,
    choice: choiceOf(f),
    heroes: heroes.map((h) => h.hero),
    notes: f.turn.lines.filter((line) => !dice.has(line)),
  };
}
