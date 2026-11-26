import { fakeDelay } from '../models.ts';
import { ROAD_EVENTS } from '../play/trek.ts';
import type { ActionRequest, DMChoice, DMContext, RulesContext, DungeonMaster, FinaleScene, NextScene, OpeningScene, Resolution } from './types.ts';

/**
 * A deterministic, offline DM for DD_FAKE_AI=1 (local dev and tests). It still reads the votes and rolls
 * the way a real DM should, so the plumbing can be checked end to end without spending anything.
 */

const PLACES = ['a drowned chapel', 'a goblin market under the bridge', 'the clockwork library', 'a frozen lighthouse', 'the hollow hill', 'a ship of bones', 'the moonlit orchard', 'a collapsed dwarven forge'];

/**
 * In a rules-engine game: go on (in a dungeon) or force the way, look around, talk (a parley with foes
 * waiting in the room). It never picks a fight itself (tests that want one register a DM that does), so a fake game keeps the length it was given.
 */
const STORY_HOOKS = [
  { kind: 'check' as const, ability: 'wis' as const, skill: 'perception', dc: 10 },
  { kind: 'check' as const, ability: 'cha' as const, skill: 'persuasion', dc: 15 },
];

/** On the road: hike on, look around, and trade with a vendor or talk to the foes met. */
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

function choicesFor(place: string, ctx: DMContext): DMChoice[] {
  const choices: DMChoice[] = [
    { label: 'Charge straight in', detail: `Burst into ${place} before anything inside can prepare.` },
    { label: 'Look for another way', detail: `Circle ${place} in search of a hidden entrance.` },
    { label: 'Parley first', detail: `Call out and see who — or what — answers from ${place}.` },
  ];
  if (!ctx.rules) return choices;
  const hooks = hooksFor(ctx.rules);
  return choices.map((c, i) => ({ ...c, rules: hooks[i] }));
}

function resolve(ctx: DMContext, r: Resolution) {
  const chosenChoiceId = r.leaders[0];
  const label = r.scene.choices.find((c) => c.id === chosenChoiceId)?.label ?? 'their plan';
  const notes = r.votes.flatMap((v) =>
    v.roll === 20 ? [`${v.characterName} pulls it off brilliantly`] :
    v.roll === 1 ? [`${v.characterName} trips over their own boots`] :
    v.choiceId !== chosenChoiceId ? [`${v.characterName} grumbles but follows`] : []);
  const outcome = `The party chose to ${label.toLowerCase()}` +
    (r.leaders.length > 1 ? ' after a heated, tied debate' : '') +
    (notes.length ? `; ${notes.join(', ')}.` : '.') +
    (r.abstained.length ? ` ${r.abstained.join(' and ')} lagged behind.` : '');
  return { outcome, chosenChoiceId };
}

/** A stretch of the road to the door, told; null off the road. */
function road(ctx: DMContext, opening: string): string | null {
  const t = ctx.rules?.trek;
  return t ? `${opening} ${t.terrain}: ${ROAD_EVENTS[t.event]}.\n\nThe dungeon door lies somewhere ahead.` : null;
}

function names(ctx: DMContext) {
  return ctx.party.map((p) => p.name).join(', ') || 'The party';
}

const empty = { action: '', ability: 'none', skill: '', tier: 'none', effect: 'none', severity: 'none', damageType: '', condition: 'none', save: 'none', narration: '' };

/**
 * The offline classification. "I fly to the moon" cannot be done. A word that is one of today's actions,
 * or that repeats a choice's label, maps onto it. Kicking, shoving or a brazier is a medium Athletics
 * check with moderate damage. Anything else is an easy Perception check with no effect.
 */
export function classifyFreeform(request: ActionRequest): Record<string, string> {
  const text = request.text.trim();
  const lower = text.toLowerCase();
  if (/^impossible\b|fly to the moon/i.test(lower)) return { ...empty, kind: 'impossible', narration: 'That cannot be done.' };
  const byId = request.actions.find((id) => lower === id || lower.startsWith(`${id} `) || lower === `i ${id}`);
  if (byId) return { ...empty, kind: 'known', action: byId };
  const byLabel = request.choices.find((c) => c.label.length > 0 && lower.includes(c.label.toLowerCase()));
  if (byLabel && request.actions.includes(byLabel.id)) return { ...empty, kind: 'known', action: byLabel.id };
  if (/kick|brazier|shove|hurl|smash|throw/.test(lower)) {
    return { ...empty, kind: 'check', ability: 'str', skill: 'athletics', tier: 'medium', effect: 'damage', severity: 'moderate', damageType: 'bludgeoning' };
  }
  return { ...empty, kind: 'check', ability: 'wis', skill: 'perception', tier: 'easy', effect: 'none' };
}

export const fakeDungeonMaster: DungeonMaster = {
  async openingScene(ctx): Promise<OpeningScene> {
    await fakeDelay();
    const place = PLACES[0];
    return {
      adventureTitle: `The Secret of ${ctx.archetype.name.replace(/^The /, '')}'s Door`,
      title: 'Behind the Dungeon Door',
      narration: road(ctx, `${names(ctx)} set out from the tavern along`) ??
        `${names(ctx)} stand before an old oak door carved with runes.\n\nBeyond it lies ${place}, and something inside is humming a song you almost remember.`,
      imagePrompt: `Adventurers before a rune-carved oak door leading to ${place}`,
      featuredCharacters: ctx.party.map((p) => p.name),
      quip: `Welcome, travellers. I am ${ctx.archetype.name}. Mind the door.`,
      choices: choicesFor(place, ctx),
    };
  },

  async nextScene(ctx, resolution): Promise<NextScene> {
    await fakeDelay();
    const place = PLACES[ctx.sceneIndex % PLACES.length];
    return {
      ...resolve(ctx, resolution),
      title: `Scene ${ctx.sceneIndex + 1}: ${place.replace(/^(a|the) /, '').replace(/^./, (c) => c.toUpperCase())}`,
      narration: road(ctx, 'The road goes on along') ?? `The path leads ${names(ctx)} to ${place}.\n\nThe air smells of old magic and fresh trouble.`,
      imagePrompt: `The party arriving at ${place}`,
      featuredCharacters: ctx.party.slice(0, 2).map((p) => p.name),
      quip: resolution.votes.some((v) => v.roll === 20) ? 'A natural 20! The dice gods smile.' : 'Onward!',
      choices: choicesFor(place, ctx),
    };
  },

  async finale(ctx, resolution): Promise<FinaleScene> {
    await fakeDelay();
    return {
      ...resolve(ctx, resolution),
      title: 'Epilogue',
      narration: `And so ${names(ctx)} walk back out through the dungeon door, richer in stories than in gold.\n\nThe door closes softly behind them. It will be waiting.`,
      imagePrompt: 'The party walking into a sunrise, the dungeon door closing behind them',
      featuredCharacters: ctx.party.map((p) => p.name),
      quip: 'Thank you for playing. Until the door opens again…',
    };
  },

  async classifyAction(_ctx, request) {
    await fakeDelay();
    return classifyFreeform(request);
  },
};
