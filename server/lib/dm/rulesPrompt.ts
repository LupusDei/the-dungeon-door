/**
 * The rules engine in the LLM DM's prompt: how hooks work, the engine's state, and the dice it rolled.
 * Empty for a game from before the engine.
 */
import { ROAD_END, ROAD_EVENTS } from '../play/trek.ts';
import type { QuestView } from '../play/quest.ts';
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
- A foe's hit points are hidden from you and the players. The combat block gives each foe's wound word:
  Unhurt, Scratched, Bleeding, Bloodied (half or less), Staggering, Gasping (the undead crumble, constructs
  crack and oozes dissolve in their own words). Show the wound in the story (a limp, ragged breath, a
  cracked shell) so the players see their progress; never its hit points, and no damage totals. The
  results tell a hit on a foe without its damage ("hit."), and a hero's with it ("hit for 6.").
- Foes the party meets roll an attitude. They do not attack at once. Hostile ones bar the way, and the
  engine replaces your three choices with Engage, Run and Parley: still write the scene. Run backs out the
  way the party came (or slips past wanderers); the room stays uncleared, with no loot and no experience.
  Indifferent or Friendly ones wait (the dungeon block says so). Offer a parley, a fight with them, or a way
  past when they are not Hostile. {"kind":"parley"} is the best talker among the heroes who pick it trying to sway them: success and they
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
- THE ROAD: every game begins on the road from the tavern: in a dungeon game to the dungeon door, in a tale
  told (no dungeon) to where the tale begins. Two stretches, one a scene (the road block says which, what is
  on it, and what comes after). Narrate overland travel: open country, the terrain given, weather and the
  road itself; no corridors, rooms or doors until the party reaches the dungeon door.
  Do not invent what the heroes say, feel, or decide on the road: the world, the weather, NPCs and monsters,
  and the physical result of the chosen action, then hand the moment back. The road has no exits and takes no
  move hooks: the party travels on by itself after each scene. Foes there
  are met as anywhere (Hostile ones bar the way: Engage, Run to slip past, or Parley; if a parley fails and
  they are still Hostile, they attack). A wandering vendor sells only the wares listed, at those prices: offer
  {"kind":"buy"} with their ids. After the last stretch, the next scene opens at the dungeon door, or in a
  tale told where its story begins.
- THE QUEST: an adventure of a set length has a goal, sized to the party (the QUEST line). Its scene count is
  a plan, not a limit: lay the goal's trail from the opening so the party can reach it in the planned scenes,
  and make it the climax. In a dungeon the goal lies in the area named (deeper in, until the party finds it);
  dealing with its foes there (won, driven off or talked down) reaches it. In a tale told, offer
  {"kind":"goal"} as a choice when the party confronts it: the engine brings on its foes, and beating them or
  driving them off reaches it. Wrong turns, rests and fights may take longer than planned; past the plan,
  steer the party back to the goal (the engine calls the ending if it takes much longer). Once the goal is
  reached, the next scene is the epilogue. An epilogue with the quest not reached tells how the goal slipped away.
- Dungeon levels: the dungeon starts at the party's level and may go a level deeper behind a new door (the
  results say "The way leads deeper"); its monsters, traps and treasure are the engine's, for that level.
  Make the deeper level feel it: older stone, colder air, stranger signs.
- When you resolve, the engine has already rolled: your outcome must match its results. Colour them as what
  happened in the world, never change them, and still use no numbers in the story. Do not add feelings,
  dialogue or extra deeds for the heroes.
- A player may write their own action instead of choosing. You classify those words in a separate call, and
  you still never invent a number: a known action is one of the ids you are given, a check names an ability
  or skill, a tier (easy, medium or hard) and an effect (none, damage of a severity, or a condition with a
  save), and impossible means the fiction cannot allow it. The engine sets the DC (easy 10, medium 15, hard 20),
  the damage and the save. An impossible action does not spend their turn. When you narrate, the
  engine's lines already include any written action, quoting their words: colour that result, and do not add
  speech, feelings, or deeds beyond the words they wrote.
- Experience: the engine gives the heroes XP for what they do outside fights too: a little for each hero who
  acts in a scene, more for a check that comes good (and some for a brave failure), most when a roll goes
  against the odds (its results name it: "a long shot that landed", "a sure thing that slipped", and you may
  tell that moment as the surprise it was), for a trap overcome, a
  parley won, new ground in a dungeon, and a milestone at the adventure's end. Tag a choice's "reward" when
  taking it would be a discovery (a secret, a hidden place, lost lore), social (winning someone over), a
  puzzle (a riddle, a mechanism, a lock of wits) or a milestone (it closes a chapter of the story; rarely,
  never two scenes running); most choices are "none". The engine sets every amount, caps it, and pays a tag
  only when the party takes that choice and its dice do not fail. Its results then say so ("+25 XP: a clever
  parley (Bryn)"): you may let the heroes feel they have grown, but put no XP numbers in the story.
- During combat the engine replaces your choices with Attack, Cast and Dodge: a few tactical lines, not every
  weapon, spell, or square. Still write two or three choices that move the fight's story. Players take other
  attacks and spells from the sheet and movement from the map. Narrate the round and set up the next one.`;

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

function stood(x: NonNullable<RulesContext['combat']>['combatants'][number]): string {
  if (x.position === 'engaged' && x.engagedWith.length) return `, engaged with ${x.engagedWith.join(' and ')}`;
  return `, ${x.position}`;
}

function combatLine(c: NonNullable<RulesContext['combat']>): string {
  const who = c.combatants.map((x) => {
    const state = x.status !== 'up' ? x.status : x.wound ? x.wound.toLowerCase() : `${x.hp}/${x.maxHp} HP`;
    const where = stood(x);
    return x.toughness ? `${x.name} ${state}${where} (${x.toughness})` : `${x.name} ${state}${where}`;
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
  const next = t.stretch < t.of ? 'more road' : ROAD_END[t.leadsTo];
  return `THE ROAD (stretch ${t.stretch} of ${t.of}, ${t.terrain}): ${what}${t.waiting ? waitingLine(t.waiting) : '.'} After it: ${next}.`;
}

function dungeonLine(d: NonNullable<RulesContext['dungeon']>): string {
  const exits = d.exits.map((x) => `${x.id} ${x.connection} to ${x.leadsTo === null ? 'unexplored' : x.leadsTo}`).join('; ') || 'none';
  const foes = d.waiting ? waitingLine(d.waiting) : '';
  return `DUNGEON (${d.kind}, level ${d.level}): the party is in ${d.area}${d.purpose ? ` (${d.purpose})` : ''}. Exits: ${exits}${foes}`;
}

const OPENING_ROAD = {
  door: 'Open on the road from the tavern to the dungeon door (THE ROAD), not at the door.',
  tale: 'Open on the road from the tavern (THE ROAD); the tale proper begins where it ends.',
} as const;

/** For the opening scene: a game opens on the road from the tavern (play/trek.ts), not at the door or in the tale. */
export const openingNote = (rules: RulesContext | null): string =>
  (rules?.trek ? `${OPENING_ROAD[rules.trek.leadsTo]} The heroes are present; do not speak, feel, or choose for them. ` : '');

const questLine = (q: QuestView): string =>
  `QUEST: ${q.goal}${q.where ? ` (${q.where})` : ''}. ${q.reached ? 'Done: the next scene is the epilogue.' : 'Not reached yet.'}`;

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
    ...(rules.quest ? [questLine(rules.quest)] : []),
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
