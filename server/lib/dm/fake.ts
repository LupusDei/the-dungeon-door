import { fakeDelay } from '../models.ts';
import { ROAD_EVENTS } from '../play/trek.ts';
import { isStreamlined } from '../telling.ts';
import { sceneHeading } from './pacing.ts';
import type { ActionRequest, DMChoice, DMContext, RulesContext, DungeonMaster, FinaleScene, NextScene, OpeningScene, Resolution } from './types.ts';

/**
 * A deterministic, offline DM for DD_FAKE_AI=1 (local dev and tests). It still reads the votes and rolls
 * the way a real DM should, so the plumbing can be checked end to end without spending anything.
 */

const PLACES = ['a drowned chapel', 'a goblin market under the bridge', 'the clockwork library', 'a frozen lighthouse', 'the hollow hill', 'a ship of bones', 'the moonlit orchard', 'a collapsed dwarven forge'];

/**
 * In a rules-engine game: press on (in a dungeon) or force the way, take a quieter path, talk (a parley with
 * foes waiting in the room). It never picks a fight itself (tests that want one register a DM that does), so a fake game keeps the length it was given.
 */
const STORY_HOOKS = [
  { kind: 'check' as const, ability: 'wis' as const, skill: 'perception', dc: 10 },
  { kind: 'check' as const, ability: 'cha' as const, skill: 'persuasion', dc: 15 },
];

/** On the road: press on, take a quieter path, and trade with a vendor or talk to the foes met. */
function roadHooks(t: NonNullable<RulesContext['trek']>) {
  const third = t.waiting ? { kind: 'parley' as const } : t.wares.length ? { kind: 'buy' as const, items: [t.wares[0].id] } : STORY_HOOKS[1];
  return [{ kind: 'check' as const, ability: 'wis' as const, skill: 'survival', dc: 10 }, STORY_HOOKS[0], third];
}

function hooksFor(rules: RulesContext) {
  return rules.trek ? roadHooks(rules.trek) : placeHooks(rules);
}

function placeHooks(rules: RulesContext) {
  const exit = rules.dungeon?.exits[0];
  // Local dev only: DD_FAKE_FIGHT=goblin-warrior,goblin-warrior makes the first choice that fight.
  const brawl = process.env.DD_FAKE_FIGHT?.split(',').filter((id) => id);
  if (brawl?.length && !exit) return [{ kind: 'fight' as const, monsters: brawl }, ...STORY_HOOKS];
  return [
    exit ? { kind: 'move' as const, exit: exit.id } : { kind: 'check' as const, ability: 'str' as const, skill: 'athletics', dc: 10 },
    STORY_HOOKS[0],
    rules.dungeon?.waiting ? { kind: 'parley' as const } : STORY_HOOKS[1],
  ];
}

/** The XP tags on the three choices (play/xp.ts): the quieter way finds something, the parley wins someone over. */
const REWARDS = ['none', 'discovery', 'social'];

function choicesFor(place: string, ctx: DMContext): DMChoice[] {
  const choices: DMChoice[] = [
    { label: 'Charge straight in', detail: `Burst into ${place} before anything inside can prepare.` },
    { label: 'Find a quieter way', detail: `Take the side of ${place} that is not watched.` },
    { label: 'Parley first', detail: `Call out and see who — or what — answers from ${place}.` },
  ];
  const offered = isStreamlined(ctx.telling) ? choices.map((c) => ({ ...c, detail: '' })) : choices; // a streamlined choice is its label
  if (!ctx.rules) return offered;
  const hooks = hooksFor(ctx.rules);
  return offered.map((c, i) => ({ ...c, rules: hooks[i], reward: REWARDS[i] }));
}

/**
 * A streamlined game (lib/telling.ts): the same scene in one line, with no aside. The engine would cut a
 * longer one; the fake writes it short, as a real DM is asked to.
 */
function told<T extends { narration: string; quip?: string }>(ctx: DMContext, scene: T, line: string): T {
  if (!isStreamlined(ctx.telling)) return scene;
  const { quip: _quip, ...rest } = scene;
  return { ...rest, narration: line } as T;
}

/** The road in one line: "A forest road: a quiet stretch." */
const roadLine = (ctx: DMContext): string | null => {
  const t = ctx.rules?.trek;
  return t ? `${t.terrain.replace(/^./, (c) => c.toUpperCase())}: ${ROAD_EVENTS[t.event]}.` : null;
};
const before = (place: string) => `${place.replace(/^./, (c) => c.toUpperCase())} lies before you.`;

function resolve(r: Resolution) {
  const chosenChoiceId = r.leaders[0];
  const label = r.scene.choices.find((c) => c.id === chosenChoiceId)?.label ?? 'their plan';
  const flair = r.votes.some((v) => v.roll === 20) ? ' It comes off brilliantly.' : r.votes.some((v) => v.roll === 1) ? ' It goes badly wrong.' : '';
  return { outcome: `The party chose to ${label.toLowerCase()}.${flair}`, chosenChoiceId };
}

const AHEAD = { door: 'The dungeon door lies somewhere ahead.', tale: 'The tale waits somewhere ahead.' } as const;

/** A stretch of the road to the door, told as the world, not as something the heroes decided. Null off the road. */
function road(ctx: DMContext, opening: string): string | null {
  const t = ctx.rules?.trek;
  return t ? `${opening} ${t.terrain}: ${ROAD_EVENTS[t.event]}.\n\n${AHEAD[t.leadsTo]} What do you do?` : null;
}

const empty = { action: '', ability: 'none', skill: '', tier: 'none', effect: 'none', severity: 'none', damageType: '', condition: 'none', save: 'none', narration: '' };

/** Words the offline DM takes for an attack on someone. */
const ATTACKS = /\b(attack|strike|shoot|stab|slash|smite|fight)\b/;

/**
 * The offline classification. "I fly to the moon" cannot be done. A word that is one of today's actions,
 * or that repeats a choice's label, maps onto it. Outside a fight, an attack is the choice on offer that
 * starts a fight. Kicking, shoving or a brazier is a medium Athletics check with moderate damage (which the
 * engine also counts as that choice, outside a fight). Anything else is an easy Perception check with no effect.
 */
export function classifyFreeform(request: ActionRequest): Record<string, string> {
  const text = request.text.trim();
  const lower = text.toLowerCase();
  if (/^impossible\b|fly to the moon/i.test(lower)) return { ...empty, kind: 'impossible', narration: 'That cannot be done.' };
  const byId = request.actions.find((id) => lower === id || lower.startsWith(`${id} `) || lower === `i ${id}`);
  if (byId) return { ...empty, kind: 'known', action: byId };
  const byLabel = [...request.choices].sort((a, b) => b.label.length - a.label.length)
    .find((c) => c.label.length > 0 && lower.includes(c.label.toLowerCase()));
  if (byLabel && request.actions.includes(byLabel.id)) return { ...empty, kind: 'known', action: byLabel.id };
  const fight = request.inCombat ? undefined : request.choices.find((c) => c.fight && request.actions.includes(c.id));
  if (fight && ATTACKS.test(lower)) return { ...empty, kind: 'known', action: fight.id };
  if (/kick|brazier|shove|hurl|smash|throw/.test(lower)) {
    return { ...empty, kind: 'check', ability: 'str', skill: 'athletics', tier: 'medium', effect: 'damage', severity: 'moderate', damageType: 'bludgeoning' };
  }
  return { ...empty, kind: 'check', ability: 'wis', skill: 'perception', tier: 'easy', effect: 'none' };
}

export const fakeDungeonMaster: DungeonMaster = {
  async openingScene(ctx): Promise<OpeningScene> {
    await fakeDelay();
    const place = PLACES[0];
    return told(ctx, {
      adventureTitle: `The Secret of ${ctx.archetype.name.replace(/^The /, '')}'s Door`,
      title: 'Behind the Dungeon Door',
      narration: road(ctx, 'A road leaves the tavern along') ??
        `An old oak door carved with runes waits, shut.\n\nBeyond it lies ${place}, and something inside is humming a song you almost remember. What do you do?`,
      imagePrompt: `Adventurers before a rune-carved oak door leading to ${place}`,
      featuredCharacters: ctx.party.map((p) => p.name),
      quip: `Welcome, travellers. I am ${ctx.archetype.name}. Mind the door.`,
      choices: choicesFor(place, ctx),
    }, roadLine(ctx) ?? `A rune-carved door stands shut before ${place}.`);
  },

  async nextScene(ctx, resolution): Promise<NextScene> {
    await fakeDelay();
    const place = PLACES[ctx.sceneIndex % PLACES.length];
    return told(ctx, {
      ...resolve(resolution),
      title: `${sceneHeading(ctx)}: ${place.replace(/^(a|the) /, '').replace(/^./, (c) => c.toUpperCase())}`,
      narration: road(ctx, 'The road goes on along') ??
        `The path opens onto ${place}.\n\nThe air smells of old magic and fresh trouble. What do you do?`,
      imagePrompt: `The party arriving at ${place}`,
      featuredCharacters: ctx.party.slice(0, 2).map((p) => p.name),
      quip: resolution.votes.some((v) => v.roll === 20) ? 'A natural 20! The dice gods smile.' : 'Onward!',
      choices: choicesFor(place, ctx),
    }, roadLine(ctx) ?? before(place));
  },

  async finale(ctx, resolution): Promise<FinaleScene> {
    await fakeDelay();
    return told(ctx, {
      ...resolve(resolution),
      title: 'Epilogue',
      narration: `The dungeon door stands open on the way home, the story richer than the gold.\n\nThe door closes softly. It will be waiting.`,
      imagePrompt: 'The party walking into a sunrise, the dungeon door closing behind them',
      featuredCharacters: ctx.party.map((p) => p.name),
      quip: 'Thank you for playing. Until the door opens again…',
    }, 'The door closes behind the party, and the road leads home.');
  },

  async classifyAction(_ctx, request) {
    await fakeDelay();
    return classifyFreeform(request);
  },
};
