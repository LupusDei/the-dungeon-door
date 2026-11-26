/**
 * The rules engine in the LLM DM's prompt: how hooks work, the engine's state, and the dice it rolled.
 * Empty for a game from before the engine.
 */
import { ROAD_EVENTS } from '../play/trek.ts';
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
- The engine rates every foe against this party: puny, weak, even, strong or deadly, and the whole fight
  low, moderate, high or deadly (deadly is worse than high; a fight is never puny). Puny is under half an
  easy fight. Those words are in the dungeon and combat blocks.
  When you mention how hard a foe is, repeat them as given. Never invent or change a rating, and still use
  no numbers in the story.
- Foes the party meets roll an attitude. They do not attack at once. Hostile ones bar the way, and the
  engine replaces your three choices with Engage, Run and Parley: still write the scene. Run backs out the
  way the party came (or slips past wanderers); the room stays uncleared, with no loot and no experience.
  Indifferent or Friendly ones wait (the dungeon block says so). Offer a parley, a fight with them, or a way
  past when they are not Hostile. {"kind":"parley"} is the best talker trying to sway them: success and they
  let the party be, failure sours them a step. If they turn Hostile, the party chooses again; they do not
  attack on their own. Outside a dungeon, {"kind":"parley","monsters":["goblin-warrior"]} talks with
  creatures you name, and a failure that turns them Hostile does start the fight.
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
- THE ROAD: a dungeon game begins on the road from the tavern to the dungeon door: two stretches, one a
  scene (the road block says which, and what is on it). Narrate overland travel: open country, the terrain
  given, weather and the road itself; no corridors, rooms or doors until the party reaches the dungeon door.
  The road has no exits and takes no move hooks: the party travels on by itself after each scene. Foes there
  are met as anywhere (Hostile ones bar the way: Engage, Run to slip past, or Parley; if a parley fails and
  they are still Hostile, they attack). A wandering vendor sells only the wares listed, at those prices: offer
  {"kind":"buy"} with their ids. After the last stretch, the next scene opens at the dungeon door.
- Dungeon levels: the dungeon starts at the party's level and may go a level deeper behind a new door (the
  results say "The way leads deeper"); its monsters, traps and treasure are the engine's, for that level.
  Make the deeper level feel it: older stone, colder air, stranger signs.
- When you resolve, the engine has already rolled: your outcome must match its results. Colour them, never
  change them, and still use no numbers in the story.
- A player may write their own action instead of choosing. You classify those words in a separate call, and
  you still never invent a number: a known action is one of the ids you are given, a check names an ability
  or skill, a tier (easy, medium or hard) and an effect (none, damage of a severity, or a condition with a
  save), and impossible means the fiction cannot allow it. The engine sets the DC (easy 10, medium 15, hard 20),
  the damage and the save. An impossible action does not spend their turn. When you narrate, the
  engine's lines already include any written action, quoting their words: colour them, never change them.
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
  const who = c.combatants.map((x) => {
    const state = x.status === 'up' ? `${x.hp}/${x.maxHp} HP` : x.status;
    return x.toughness ? `${x.name} ${state} (${x.toughness})` : `${x.name} ${state}`;
  }).join('; ');
  return `COMBAT, round ${c.round} (${c.band}): ${who}`;
}

function waitingLine(w: NonNullable<NonNullable<RulesContext['dungeon']>['waiting']>): string {
  const stance = w.attitude === 'hostile' ? 'barring the way' : 'not attacking';
  const each = w.monsters.map((m) => `each ${m.name} is ${m.toughness}`).join(', ');
  const rated = each ? `. ${each[0].toUpperCase()}${each.slice(1)}. The fight is ${w.band}` : '';
  return `. Waiting here, ${stance}: ${w.foes} (${w.attitude})${rated}.`;
}

function roadLine(t: NonNullable<RulesContext['trek']>): string {
  const wares = t.wares.map((w) => `${w.name} (${w.id}, ${w.cost} gp)`).join(', ');
  const what = `${ROAD_EVENTS[t.event]}${wares ? `, selling ${wares}` : ''}`;
  const next = t.stretch < t.of ? 'more road' : 'the dungeon door';
  return `THE ROAD (stretch ${t.stretch} of ${t.of}, ${t.terrain}): ${what}${t.waiting ? waitingLine(t.waiting) : '.'} After it: ${next}.`;
}

function dungeonLine(d: NonNullable<RulesContext['dungeon']>): string {
  const exits = d.exits.map((x) => `${x.id} ${x.connection} to ${x.leadsTo === null ? 'unexplored' : x.leadsTo}`).join('; ') || 'none';
  const foes = d.waiting ? waitingLine(d.waiting) : '';
  return `DUNGEON (${d.kind}, level ${d.level}): the party is in ${d.area}${d.purpose ? ` (${d.purpose})` : ''}. Exits: ${exits}${foes}`;
}

/** For the opening scene: a dungeon game opens on the road from the tavern (play/trek.ts), not at the door. */
export const openingNote = (rules: RulesContext | null): string =>
  (rules?.trek ? 'The party sets out on the road from the tavern to the dungeon door: open on that road (THE ROAD), not at the door. ' : '');

export function rulesBlock(rules: RulesContext | null): string {
  if (!rules) return '';
  return [
    'THE RULES ENGINE (SRD 5.2)',
    ...rules.party.map(heroLine),
    `NOW: ${rules.time}. Light: ${rules.light}`,
    ...(rules.combat ? [combatLine(rules.combat)] : []),
    ...(rules.trek ? [roadLine(rules.trek)] : []),
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
