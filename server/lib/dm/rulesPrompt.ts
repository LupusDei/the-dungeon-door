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
  hard, 30 nearly impossible. A hook has every field: fill the ones its kind uses (as in these examples) and
  leave the others empty ("", 0, false, [] or "none").
- Checks: pick the skill (an SRD 5.2 skill id) and, where a tool does the work, "tool" ("thieves-tools"). Use
  "mode":"best" when one hero acts and the others can only help (picking a lock), "group" when everyone must
  (sneaking past together). Set "advantage" or "disadvantage" for circumstances. Against a creature, give
  "against": its monster id and leave "dc" at 0: the engine uses its passive score or the Influence DC.
- Goods: {"kind":"buy","items":["potion-of-healing"]} (SRD item ids; each is bought by the richest hero who can
  pay, at SRD prices), {"kind":"sell","items":["gemstone"]} (everyone sells all they hold of it: gear at half
  price, gems and jewellery at full value), {"kind":"use","item":"potion-of-healing"} (the most hurt hero
  drinks). Only offer buying and selling where there is someone to trade with. Treasure the party finds is
  already in their packs.
- Traps and hazards: {"kind":"trap","trap":"poisoned-needle"} (one of collapsing-roof, falling-net,
  fire-casting-statue, hidden-pit, poisoned-darts, poisoned-needle, rolling-stone, spiked-pit: the SRD 5.2
  example traps; the engine checks the party's passive scores, disarms or springs it, and scales it to their
  level), or {"kind":"hazard","hazard":"falling","feet":30} (also burning; suffocation with "minutes";
  extreme-cold or extreme-heat with "hours"; dehydration; malnutrition with "days").
- When you resolve, the engine has already rolled: your outcome must match its results. Colour them, never
  change them, and still use no numbers in the story.
- During combat the engine replaces your choices with Attack, Cast and Dodge; narrate the round and set up the
  next one (still write three choices; they are ignored).`;

const slots = (left: number[]) => {
  const last = left.findLastIndex((n) => n > 0);
  return last < 0 ? '' : `, spell slots left ${left.slice(0, last + 1).join('/')}`;
};

function heroLine(h: RulesContext['party'][number]): string {
  const hp = h.dead ? 'DEAD (only Revivify, Raise Dead or the like brings them back)' : h.hp === 0 ? `DOWN (0/${h.maxHp} HP)` : `${h.hp}/${h.maxHp} HP`;
  const passive = `, passive Perception ${h.passivePerception}, passive Insight ${h.passiveInsight}`;
  const goods = `, ${h.gp} gp${h.dragging ? ', overloaded (Speed 5 ft)' : ''}; carries ${h.items || 'nothing'}`;
  return `- ${h.name}: level ${h.level}, ${hp}, AC ${h.armorClass}${h.exhaustion ? `, exhaustion ${h.exhaustion}` : ''}${slots(h.slotsLeft)}${passive}${goods}`;
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
