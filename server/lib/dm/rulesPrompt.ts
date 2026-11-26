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
- A save may bring a condition on a failure: "condition":"poisoned" (any SRD 5.2 condition but exhaustion) with
  "minutes" for how long (0: until a long rest). The engine tracks it: Poisoned or Frightened heroes have
  Disadvantage on checks, a Blinded one sees nothing, a Restrained one tries to break free each turn.
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
- Foes the party meets in a room roll an attitude: Hostile ones attack at once; Indifferent or Friendly ones
  wait (the dungeon block says so). Offer {"kind":"parley"} (the best talker tries to sway them: success and
  they let the party be, failure sours them and Hostile foes attack), a fight with them, or a way past. Outside
  a dungeon, {"kind":"parley","monsters":["goblin-warrior"]} talks with creatures you name.
- In a fight the foes check morale when shaken (first death, half their strength gone, leader down): they may
  stand, flee (the heroes get Opportunity Attacks) or surrender. Slain heroes stay dead unless a party caster
  Revivifies them on the spot (the engine does that). Where there is a temple or shrine, {"kind":"revive"}
  raises every dead hero (Raise Dead: a party caster's 500 gp diamond, or the temple's 2,500 gp) while the
  party's gold lasts.
- Time and light: the engine keeps the clock (each choice takes about ten minutes, a rest its length) and the
  party's light (a torch burns an hour, a lantern's oil six; they are lit from the packs as needed). Describe
  only what the heroes can see: bright light shows everything; dim light shapes and shadows; a hero who
  cannot see (darkness, no darkvision) knows only what they hear, smell and touch. In the dark, Perception and
  Investigation fail and fighters are Blinded. When the light runs low, let the party find or buy more.
- Corridors and wanderers: ways between rooms may run through corridors (passages, junctions, stairs; the
  exits say so), passed on the way and possibly trapped. The engine rolls for wandering monsters every half
  hour in a dungeon and after noise (a fight, a trap going off); when they come, its results say who they
  are and whether they attack or go their way. Don't invent wandering monsters yourself.
- Dungeon levels: the dungeon starts at the party's level and may go a level deeper behind a new door (the
  results say "The way leads deeper"); its monsters, traps and treasure are the engine's, for that level.
  Make the deeper level feel it: older stone, colder air, stranger signs.
- When you resolve, the engine has already rolled: your outcome must match its results. Colour them, never
  change them, and still use no numbers in the story.
- During combat the engine replaces your choices with Attack, Cast and Dodge; narrate the round and set up the
  next one (still write three choices; they are ignored).`;

const slots = (left: number[]) => {
  const last = left.findLastIndex((n) => n > 0);
  return last < 0 ? '' : `, spell slots left ${left.slice(0, last + 1).join('/')}`;
};

const SEES = { clear: '', dim: '; sees only dimly', none: '; CANNOT SEE (darkness)' } as const;

function heroLine(h: RulesContext['party'][number]): string {
  const hp = h.dead ? 'DEAD (only Revivify, Raise Dead or the like brings them back)' : h.hp === 0 ? `DOWN (0/${h.maxHp} HP)` : `${h.hp}/${h.maxHp} HP`;
  const passive = `, passive Perception ${h.passivePerception}, passive Insight ${h.passiveInsight}`;
  const goods = `, ${h.gp} gp${h.dragging ? ', overloaded (Speed 5 ft)' : ''}; carries ${h.items || 'nothing'}`;
  return `- ${h.name}: level ${h.level}, ${hp}, AC ${h.armorClass}${h.exhaustion ? `, exhaustion ${h.exhaustion}` : ''}${slots(h.slotsLeft)}${passive}${goods}${h.conditions ? `; ${h.conditions}` : ''}${SEES[h.sees]}`;
}

function combatLine(c: NonNullable<RulesContext['combat']>): string {
  return `COMBAT, round ${c.round}: ${c.combatants.map((x) => `${x.name} ${x.status === 'up' ? `${x.hp}/${x.maxHp} HP` : x.status}`).join('; ')}`;
}

function dungeonLine(d: NonNullable<RulesContext['dungeon']>): string {
  const exits = d.exits.map((x) => `${x.id} ${x.connection} to ${x.leadsTo === null ? 'unexplored' : x.leadsTo}`).join('; ') || 'none';
  const foes = d.waiting ? `. Waiting here, not attacking: ${d.waiting.foes} (${d.waiting.attitude})` : '';
  return `DUNGEON (${d.kind}, level ${d.level}): the party is in ${d.area}${d.purpose ? ` (${d.purpose})` : ''}. Exits: ${exits}${foes}`;
}

export function rulesBlock(rules: RulesContext | null): string {
  if (!rules) return '';
  return [
    'THE RULES ENGINE (SRD 5.2)',
    ...rules.party.map(heroLine),
    `NOW: ${rules.time}. Light: ${rules.light}`,
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
