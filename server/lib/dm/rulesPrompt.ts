/**
 * The rules engine in the LLM DM's prompt: how hooks work, the engine's state, and the dice it rolled.
 * Empty for a game from before the engine.
 */
import type { RulesContext, RulesResults } from './types.ts';

export const RULES_INSTRUCTIONS = `
THE RULES ENGINE (SRD 5.2, the 2024 rules)
- The engine owns the numbers; you propose and narrate. Give a choice a "rules" hook when it calls for dice:
  {"kind":"check","ability":"str","skill":"athletics","dc":12}, {"kind":"save","ability":"dex","dc":13,
  "damage":"2d6","damageType":"fire"}, {"kind":"fight","monsters":["goblin-warrior"]} (ids from the list you
  are given), {"kind":"rest","rest":"short"} or "long", or {"kind":"move","exit":"r2"} (an exit id, in a
  dungeon). Leave "rules" null for a pure story choice. DCs: 5 very easy, 10 easy, 15 medium, 20 hard, 25 very
  hard, 30 nearly impossible.
- When you resolve, the engine has already rolled: your outcome must match its results. Colour them, never
  change them, and still use no numbers in the story.
- During combat the engine replaces your choices with Attack, Cast and Dodge; narrate the round and set up the
  next one (still write three choices; they are ignored).`;

const slots = (left: number[]) => {
  const last = left.findLastIndex((n) => n > 0);
  return last < 0 ? '' : `, spell slots left ${left.slice(0, last + 1).join('/')}`;
};

function heroLine(h: RulesContext['party'][number]): string {
  const hp = h.hp === 0 ? `DOWN (0/${h.maxHp} HP)` : `${h.hp}/${h.maxHp} HP`;
  return `- ${h.name}: level ${h.level}, ${hp}, AC ${h.armorClass}${h.exhaustion ? `, exhaustion ${h.exhaustion}` : ''}${slots(h.slotsLeft)}`;
}

function combatLine(c: NonNullable<RulesContext['combat']>): string {
  return `COMBAT, round ${c.round}: ${c.combatants.map((x) => `${x.name} ${x.status === 'up' ? `${x.hp}/${x.maxHp} HP` : x.status}`).join('; ')}`;
}

function dungeonLine(d: NonNullable<RulesContext['dungeon']>): string {
  const exits = d.exits.map((x) => `${x.id} ${x.connection} to ${x.leadsTo === null ? 'unexplored' : x.leadsTo}`).join('; ') || 'none';
  return `DUNGEON (${d.kind}): the party is in ${d.area}${d.purpose ? ` (${d.purpose})` : ''}. Exits: ${exits}`;
}

export function rulesBlock(rules: RulesContext | null): string {
  if (!rules) return '';
  return [
    'THE RULES ENGINE (SRD 5.2)',
    ...rules.party.map(heroLine),
    ...(rules.combat ? [combatLine(rules.combat)] : []),
    ...(rules.dungeon ? [dungeonLine(rules.dungeon)] : []),
    `Monsters for fights: ${rules.monsters.join(', ')}`,
  ].join('\n');
}

const FIGHT_NEWS = {
  started: 'A fight has begun.',
  victory: 'The party won the fight.',
  defeat: 'Every hero has fallen: the adventure ends here.',
  fled: 'The foes fled.',
};

function headline(r: RulesResults): string {
  const what = r.fight ? FIGHT_NEWS[r.fight] : r.success === null ? '' : `The check or save ${r.success ? 'succeeded' : 'failed'}.`;
  return [r.chosen ? `The party goes with (${r.chosen}).` : 'A combat round.', what].filter(Boolean).join(' ');
}

export function resultsBlock(results: RulesResults | null): string {
  if (!results) return '';
  return ['THE ENGINE’S RESULTS (narrate these; never change them)', headline(results), ...results.lines].join('\n');
}
