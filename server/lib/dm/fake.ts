import { fakeDelay } from '../models.ts';
import type { DMChoice, DMContext, RulesContext, DungeonMaster, FinaleScene, NextScene, OpeningScene, Resolution } from './types.ts';

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

function hooksFor(rules: RulesContext) {
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

function names(ctx: DMContext) {
  return ctx.party.map((p) => p.name).join(', ') || 'The party';
}

export const fakeDungeonMaster: DungeonMaster = {
  async openingScene(ctx): Promise<OpeningScene> {
    await fakeDelay();
    const place = PLACES[0];
    return {
      adventureTitle: `The Secret of ${ctx.archetype.name.replace(/^The /, '')}'s Door`,
      title: 'Behind the Dungeon Door',
      narration: `${names(ctx)} stand before an old oak door carved with runes.\n\nBeyond it lies ${place}, and something inside is humming a song you almost remember.`,
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
      narration: `The path leads ${names(ctx)} to ${place}.\n\nThe air smells of old magic and fresh trouble.`,
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
};
