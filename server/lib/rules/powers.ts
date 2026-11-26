/**
 * A monster's save abilities ("powers"): breath weapons, webs, glares. A target makes the saving throw
 * instead of the monster rolling to hit; a failure takes the damage (a success half, or none) and may bring a
 * condition. A power can be at will, recharge on a d6 roll, or so many uses a day (in this game, a fight).
 * Read from the SRD action text; see docs/rules-design.md.
 */
import type { Ability } from './abilities.ts';
import { type Condition, CONDITIONS, type TimedCondition } from './conditions.ts';
import type { AreaShape } from './srd.ts';

export interface PowerDamage { dice: string; type: string }
/** A condition a failed save brings, and how it ends (as on a hero's sheet). */
export interface Lasting { condition: Condition; until: TimedCondition['until'] }
export type Uses = { kind: 'recharge'; min: number } | { kind: 'per-day'; times: number } | null;
export interface Power {
  name: string; ability: Ability; dc: number;
  /** A success takes half the damage (else none). */
  half: boolean;
  damage: PowerDamage[];
  uses: Uses;
  /** Its area, or null for one target. */
  area: { shape: AreaShape; feet: number } | null;
  lasting: Lasting | null;
}

/** The parts of an SRD monster action a power is read from. */
export interface PowerSource {
  name: string; desc: string; attackBonus?: number;
  damage?: { damageDice: string; damageType: { index: string } }[];
  dc?: { dcType: { index: string }; dcValue: number; successType: string };
  usage?: { type: string; minValue?: number; times?: number };
}

const AREA = /(\d+)-foot(?:-long, \d+-foot-?wide)? (Sphere|Cone|Cube|Line|Cylinder|Emanation)/;
const HAS = /has the (\w+) condition([^.]*)/;
const ROUND = 6;
const SPANS: Record<string, number> = { minute: 60, hour: 3600 };

/** How the condition ends, from the text: an escape DC, a repeated save, the next turn, a minute or an hour; Prone until it stands (its turn). */
function untilOf(desc: string, after: string, condition: Condition, ability: Ability, dc: number): TimedCondition['until'] {
  const escape = /escape DC (\d+)/.exec(after);
  if (escape || /destroyed/.test(after)) return { kind: 'escape', ability: 'str', skill: 'athletics', dc: escape ? Number(escape[1]) : dc };
  if (/repeats the save/.test(desc)) return { kind: 'save', ability, dc };
  const span = /for 1 (minute|hour)/.exec(after);
  if (span) return { kind: 'time', left: SPANS[span[1]] };
  return { kind: 'time', left: /next turn/.test(after) || condition === 'prone' ? ROUND : SPANS.minute };
}

export function lastingOf(desc: string, ability: Ability, dc: number): Lasting | null {
  const has = HAS.exec(desc);
  const condition = has?.[1].toLowerCase() as Condition | undefined;
  if (!has || !CONDITIONS.includes(condition!)) return null;
  return { condition: condition!, until: untilOf(desc, has[2], condition!, ability, dc) };
}

function usesOf(usage: PowerSource['usage']): Uses {
  if (usage?.type === 'recharge on roll') return { kind: 'recharge', min: usage.minValue! };
  return usage?.type === 'per day' ? { kind: 'per-day', times: usage.times! } : null;
}

/** The monster's save abilities: the actions with a save DC and no attack roll. */
export function powersOf(actions: readonly PowerSource[]): Power[] {
  return actions.filter((a) => a.dc && a.attackBonus === undefined).map((a) => {
    const ability = a.dc!.dcType.index as Ability;
    const area = AREA.exec(a.desc);
    return {
      name: a.name, ability, dc: a.dc!.dcValue, half: a.dc!.successType === 'half',
      damage: (a.damage ?? []).map((d) => ({ dice: d.damageDice, type: d.damageType.index })),
      uses: usesOf(a.usage), area: area ? { shape: area[2] as AreaShape, feet: Number(area[1]) } : null,
      lasting: lastingOf(a.desc, ability, a.dc!.dcValue),
    };
  });
}

/** A condition an attack brings when it hits: after a save (`save`), or at once ("it has the Grappled condition"). */
export interface Rider { ability: Ability; dc: number; save: boolean; lasting: Lasting }

/** The rider of an attack-roll action with a save DC and a condition in its text; null without one. */
export function riderOf(a: PowerSource): Rider | null {
  if (!a.dc || a.attackBonus === undefined) return null;
  const ability = a.dc.dcType.index as Ability;
  const lasting = lastingOf(a.desc, ability, a.dc.dcValue);
  if (!lasting) return null;
  const onHit = a.desc.slice(a.desc.indexOf('Hit:'));
  return { ability, dc: a.dc.dcValue, save: onHit.indexOf('Saving Throw') !== -1 && onHit.indexOf('Saving Throw') < onHit.indexOf('has the '), lasting };
}
