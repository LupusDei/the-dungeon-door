/**
 * Range bands: where a combatant stands when the fight has no grid (an original rule, CC0).
 * Engaged is melee with specific creatures (about 5 ft, and a reach weapon still needs it). Near is about
 * 30 ft. Far is the next band, about 60 ft. A move changes one band; Dash, which spends the action, changes
 * two. See docs/rules-design.md.
 */
import type { Attack, Combatant } from './combatant.ts';
import type { Power } from './powers.ts';
import type { AreaShape, SrdSpell } from './srd.ts';
import { require } from './violation.ts';

export type Band = 'engaged' | 'near' | 'far';
export const BANDS: readonly Band[] = ['engaged', 'near', 'far'];

/** Feet the band stands in for, when a range is checked. */
export const BAND_FEET: Readonly<Record<Band, number>> = { engaged: 5, near: 30, far: 60 };

export interface Place {
  band: Band;
  /** Who this combatant is in melee with. Empty unless engaged. The relation is symmetric. */
  with: string[];
}

/** A move along the bands. `dash` spends the action and covers two bands. `disengage` leaves melee with no opportunity attack. */
export interface Move {
  to: Band;
  /** Who to close with. Required when `to` is engaged. */
  engage?: string[];
  dash?: boolean;
  disengage?: boolean;
}

/** The combatants a move is judged against. `moved` is who has already used their move this turn. */
export interface Field {
  round: number;
  combatants: Record<string, Combatant>;
  reacted?: readonly string[];
  moved?: readonly string[];
}

const INDEX: Readonly<Record<Band, number>> = { engaged: 0, near: 1, far: 2 };

export const isBand = (value: string): value is Band => (BANDS as readonly string[]).includes(value);

/** A move off a vote. Undefined when the vote carries none. Throws when the shape is wrong. */
export function parseMove(raw: unknown): Move | undefined {
  if (raw === undefined || raw === null) return undefined;
  require(typeof raw === 'object' && !Array.isArray(raw), 'move must say where to.');
  const body = raw as Record<string, unknown>;
  require(typeof body.to === 'string' && isBand(body.to), 'move.to must be "engaged", "near" or "far".');
  require(body.engage === undefined || (Array.isArray(body.engage) && body.engage.every((id) => typeof id === 'string' && id.length > 0)), 'move.engage must be a list of ids.');
  require(body.dash === undefined || typeof body.dash === 'boolean', 'move.dash must be true or false.');
  require(body.disengage === undefined || typeof body.disengage === 'boolean', 'move.disengage must be true or false.');
  const engage = body.engage as string[] | undefined;
  return {
    to: body.to,
    ...(engage?.length ? { engage } : {}),
    ...(body.dash ? { dash: true } : {}),
    ...(body.disengage ? { disengage: true } : {}),
  };
}

/** Bands between two positions on the line engaged—near—far. */
export const bandSteps = (from: Band, to: Band): number => Math.abs(INDEX[from] - INDEX[to]);

/** One band toward `to`. */
export function stepToward(from: Band, to: Band): Band {
  if (from === to) return from;
  return BANDS[INDEX[from] + Math.sign(INDEX[to] - INDEX[from])];
}

export const engagedWith = (c: Combatant, id: string): boolean => !!c.place?.with.includes(id);

/**
 * Bands of movement to get into melee with a creature at `foe`. Already in melee with them costs nothing.
 * From engaged to far is three: out to near, on to far, then in. Two is a Dash; three cannot be done in a turn.
 */
export function stepsToEngage(from: Band, foe: Band, already: boolean): number {
  if (already) return 0;
  if (from === 'engaged') return foe === 'far' ? 3 : 1;
  if (foe === 'engaged') return INDEX[from];
  if (from === foe) return 1;
  return bandSteps(from, foe) + 1;
}

/**
 * Feet between two combatants. Engaged with each other: 5. Otherwise the farther band, and at least a near
 * band apart when they are not in melee (two melees, or two creatures both near, are about 30 ft apart;
 * anything involving far is about 60). No place stored: null, and the caller skips the check.
 */
export function distanceFeet(a: Combatant, b: Combatant): number | null {
  if (!a.place || !b.place) return null;
  if (engagedWith(a, b.id) || engagedWith(b, a.id)) return BAND_FEET.engaged;
  const zone = (p: Place) => (p.band === 'far' ? BAND_FEET.far : p.band === 'near' ? BAND_FEET.near : 0);
  return Math.max(zone(a.place), zone(b.place), BAND_FEET.near);
}

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id) => b.includes(id));

/** How many bands `move` costs from where `me` is. 0: it changes nothing. */
function moveCost(field: Field, me: Combatant, move: Move): number {
  const from = me.place?.band ?? 'near';
  if (move.to !== 'engaged') return bandSteps(from, move.to);
  const engage = move.engage ?? [];
  if (from === 'engaged' && me.place && sameIds(me.place.with, engage)) return 0;
  const costs = engage.map((fid) => stepsToEngage(from, field.combatants[fid].place?.band ?? 'near', engagedWith(me, fid)));
  const leaving = (me.place?.with ?? []).filter((id) => !engage.includes(id));
  const close = Math.max(0, ...costs);
  if (from === 'engaged' && close === 0 && leaving.length > 0) return 1;
  return close;
}

const leaving = (me: Combatant, move: Move): boolean => {
  const was = me.place?.with ?? [];
  if (was.length === 0) return false;
  return move.to !== 'engaged' || was.some((id) => !(move.engage ?? []).includes(id));
};

/** Throws a RuleViolation when `id` cannot make `move` now. */
export function validateMove(field: Field, id: string, move: Move): void {
  const me = field.combatants[id];
  require(me !== undefined, `there is no combatant ${id}`);
  require(me.status === 'up', `${me.name} cannot move.`);
  require(isBand(move.to), `${me.name} cannot move to ${move.to}.`);
  if (move.to === 'engaged') {
    const engage = move.engage ?? [];
    require(engage.length > 0, `${me.name} must name who to engage.`);
    for (const fid of engage) {
      const foe = field.combatants[fid];
      require(foe !== undefined && fid !== id, `${me.name} cannot engage ${fid}.`);
      require(foe.status !== 'dead', `${foe.name} is already dead.`);
    }
  } else {
    require((move.engage ?? []).length === 0, `${me.name} engages someone only by moving to engaged.`);
  }
  const cost = moveCost(field, me, move);
  require(cost > 0, move.to === 'engaged' ? `${me.name} is already engaged with them.` : `${me.name} is already ${move.to}.`);
  require(cost <= 2, `${me.name} cannot get there this turn.`);
  require(!!move.dash === (cost === 2), cost === 2 ? `${me.name} needs to Dash to get there.` : `A move is enough; Dash covers two bands.`);
  require(!move.disengage || leaving(me, move), `${me.name} is not leaving anyone's reach.`);
}

/** Foes who can take an opportunity attack as `id` makes this move. Disengage, and a monster that Disengages as a Bonus Action, draw none. */
export function provokedBy(field: Field, id: string, move: Move): string[] {
  const me = field.combatants[id];
  if (!me || move.disengage || me.disengages || !leaving(me, move)) return [];
  const kept = move.to === 'engaged' ? (move.engage ?? []) : [];
  return (me.place?.with ?? []).filter((fid) => {
    if (kept.includes(fid)) return false;
    const foe = field.combatants[fid];
    return !!foe && foe.status === 'up' && foe.attacks.some((a) => !a.ranged) && !(field.reacted ?? []).includes(fid);
  });
}

/** Places after the move. Engagement is kept symmetric; a creature left with nobody drops back to near. */
export function placesAfter(combatants: Record<string, Combatant>, id: string, move: Move): Record<string, Combatant> {
  const next = { ...combatants };
  const me = next[id];
  const oldWith = me.place?.with ?? [];
  const drop = (fid: string) => {
    const foe = next[fid];
    if (!foe) return;
    const withFoe = (foe.place?.with ?? []).filter((x) => x !== id);
    next[fid] = { ...foe, place: withFoe.length ? { band: 'engaged', with: withFoe } : { band: 'near', with: [] } };
  };
  if (move.to !== 'engaged') {
    for (const fid of oldWith) drop(fid);
    next[id] = { ...me, place: { band: move.to, with: [] } };
    return next;
  }
  const engage = [...new Set(move.engage ?? [])];
  for (const fid of oldWith) if (!engage.includes(fid)) drop(fid);
  next[id] = { ...next[id], place: { band: 'engaged', with: engage } };
  for (const fid of engage) {
    const foe = next[fid];
    const withFoe = [...new Set([...(foe.place?.with ?? []).filter((x) => x !== id), id])];
    next[fid] = { ...foe, place: { band: 'engaged', with: withFoe } };
  }
  return next;
}

export interface Opening {
  surprise?: 'party' | 'foes';
  /** Where both sides start when nobody is surprised. A room is near; the road is far. */
  band?: 'near' | 'far';
}

const openingOf = (opening?: Opening | 'party' | 'foes'): Opening | undefined =>
  (opening === 'party' || opening === 'foes' ? { surprise: opening } : opening);

/** Where everyone starts. No surprise: both sides at `band` (near in a room, far on the road). Surprise: the fight begins in melee. */
export function openingPlaces(combatants: readonly Combatant[], opening?: Opening | 'party' | 'foes'): Record<string, Place> {
  const start = openingOf(opening);
  const band = start?.band === 'far' ? 'far' : 'near';
  if (!start?.surprise) return Object.fromEntries(combatants.map((c) => [c.id, { band, with: [] }]));
  const up = combatants.filter((c) => c.status === 'up');
  return Object.fromEntries(combatants.map((c) => {
    const withThem = up.filter((o) => o.side !== c.side).map((o) => o.id);
    return [c.id, c.status === 'up' && withThem.length ? { band: 'engaged' as const, with: withThem } : { band, with: [] }];
  }));
}

/** Foes (or, with `allies`, anyone) this combatant can step into melee with, plus whoever they already hold. */
export function meleeCluster(field: Field, id: string, allies = false): string[] {
  const me = field.combatants[id];
  const from = me.place?.band ?? 'near';
  const alive = (c: Combatant | undefined) => !!c && c.status !== 'dead';
  const already = (me.place?.with ?? []).filter((fid) => alive(field.combatants[fid]));
  const closing = Object.values(field.combatants).filter((c) =>
    c.id !== id && alive(c) && (allies || c.side !== me.side) && stepsToEngage(from, c.place?.band ?? 'near', engagedWith(me, c.id)) === 1,
  ).map((c) => c.id);
  return [...new Set([...already, ...closing])];
}

const maxRange = (attack: Attack): number => {
  if (attack.normal === undefined && attack.long == null) return Infinity;
  return attack.long ?? attack.normal ?? Infinity;
};

/** A ranged attack past normal range and inside long range has disadvantage. Past long range it cannot be made. */
export function rangedShot(attacker: Combatant, target: Combatant, attack: Attack): { ok: boolean; longRange: boolean } {
  const d = distanceFeet(attacker, target);
  if (d === null || !attack.ranged) return { ok: true, longRange: false };
  const normal = attack.normal ?? Infinity;
  return { ok: d <= maxRange(attack), longRange: attack.long != null && d > normal };
}

/** A cone, line, emanation, or an area of range Self comes from the caster. A sphere, cylinder or cube with a range is placed. */
export const areaFromSelf = (spell: { range: number; area: { shape: AreaShape; feet: number } | null }): boolean =>
  !!spell.area && (spell.range === 0 || spell.area.shape === 'Cone' || spell.area.shape === 'Line' || spell.area.shape === 'Emanation');

/** Whether `target` is inside the spell's reach from `caster` (a placed area: inside the spell's range, where its centre may go). */
export function spellHits(caster: Combatant, target: Combatant, spell: Pick<SrdSpell, 'range' | 'attack' | 'area'>): boolean {
  const d = distanceFeet(caster, target);
  if (d === null) return true;
  if (areaFromSelf(spell)) return d <= spell.area!.feet;
  if (spell.attack === 'melee') return d <= BAND_FEET.engaged;
  return d <= spell.range;
}

/** A power reaches from the monster: its area's size, else the "within N feet" of its text, else melee. */
export function powerHits(attacker: Combatant, target: Combatant, power: Power): boolean {
  const d = distanceFeet(attacker, target);
  if (d === null) return true;
  return d <= (power.area ? power.area.feet : power.range ?? BAND_FEET.engaged);
}

/**
 * The one-band move an attack, spell or power still needs, or null when it can be made from here (or cannot
 * be made by moving one band). A ranged monster steps out of melee first. A melee attack steps into the
 * whole cluster it can reach. Dash is never chosen here: it would spend the action.
 */
export function neededApproach(field: Field, actor: Combatant, kind: 'attack' | 'spell' | 'power', detail: {
  attack?: Attack; target?: Combatant; spell?: Pick<SrdSpell, 'range' | 'attack' | 'area'>; power?: Power; targets?: readonly string[];
}): Move | null {
  if (!actor.place || (field.moved ?? []).includes(actor.id)) return null;
  if (kind === 'attack' && detail.attack && detail.target?.place) {
    if (!detail.attack.ranged) {
      if (engagedWith(actor, detail.target.id)) return null;
      const engage = meleeCluster(field, actor.id);
      return engage.includes(detail.target.id) ? { to: 'engaged', engage } : null;
    }
    if (actor.side === 'foes' && actor.place.band === 'engaged') {
      return { to: 'near', ...(actor.disengages && actor.place.with.length > 0 ? { disengage: true as const } : {}) };
    }
    return null;
  }
  const ids = detail.targets ?? [];
  const hits = (id: string) => {
    const target = field.combatants[id];
    if (!target) return true;
    return kind === 'spell' && detail.spell ? spellHits(actor, target, detail.spell) : kind === 'power' && detail.power ? powerHits(actor, target, detail.power) : true;
  };
  if (ids.length === 0 || ids.every(hits)) return null;
  const allies = kind === 'spell';
  const engage = meleeCluster(field, actor.id, allies).filter((id) => ids.includes(id) || (kind !== 'spell' || !detail.spell?.area || areaFromSelf(detail.spell)));
  const wanted = ids.filter((id) => engage.includes(id));
  if (wanted.length === 0 || !ids.every((id) => hits(id) || wanted.includes(id))) return null;
  const closed: Combatant = { ...actor, place: { band: 'engaged', with: wanted } };
  const wouldHit = (id: string) => {
    const target = { ...field.combatants[id], place: { band: 'engaged' as const, with: [...(field.combatants[id].place?.with ?? []), actor.id] } };
    return kind === 'spell' && detail.spell ? spellHits(closed, target, detail.spell) : kind === 'power' && detail.power ? powerHits(closed, target, detail.power) : false;
  };
  return ids.every((id) => hits(id) || wouldHit(id)) ? { to: 'engaged', engage: wanted } : null;
}

/** Every legal move, for a per-hero list of actions to offer beside Attack and Cast. */
export function legalMoves(field: Field, id: string): Move[] {
  const me = field.combatants[id];
  if (!me || me.status !== 'up') return [];
  const from = me.place?.band ?? 'near';
  const drafted: Move[] = [];
  for (const to of ['near', 'far'] as const) {
    const cost = bandSteps(from, to);
    if (cost < 1 || cost > 2) continue;
    const dash = cost === 2 ? { dash: true as const } : {};
    drafted.push({ to, ...dash });
    if ((me.place?.with.length ?? 0) > 0) drafted.push({ to, ...dash, disengage: true });
  }
  const others = Object.values(field.combatants).filter((c) => c.id !== id && c.status !== 'dead');
  for (const foe of others) {
    const cost = stepsToEngage(from, foe.place?.band ?? 'near', engagedWith(me, foe.id));
    if (cost < 1 || cost > 2) continue;
    const dash = cost === 2 ? { dash: true as const } : {};
    const dropping = (me.place?.with ?? []).filter((x) => x !== foe.id);
    drafted.push({ to: 'engaged', engage: [foe.id], ...dash, ...(dropping.length ? { disengage: true as const } : {}) });
    if (dropping.length) drafted.push({ to: 'engaged', engage: [...dropping, foe.id], ...dash });
  }
  const one = others.filter((c) => stepsToEngage(from, c.place?.band ?? 'near', engagedWith(me, c.id)) === 1).map((c) => c.id);
  if (one.length > 1) drafted.push({ to: 'engaged', engage: one });
  const out: Move[] = [];
  for (const move of drafted) {
    try {
      validateMove(field, id, move);
      if (!out.some((m) => m.to === move.to && !!m.dash === !!move.dash && !!m.disengage === !!move.disengage && sameIds(m.engage ?? [], move.engage ?? []))) out.push(move);
    } catch {
      // a drafted move that the rule rejects is not offered
    }
  }
  return out;
}
