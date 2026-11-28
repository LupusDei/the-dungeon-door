/**
 * Step helpers for features/action_xp.feature. Outside a fight a scene is resolved through the engine's own
 * step (play/table.ts engineStep), with the hero's bonus and the DC set so the odds are round numbers. In a
 * round the d20s are given as the engine logs them (rules/scene.ts CombatEvent), read by play/odds.ts and
 * paid by play/xp.ts, so an armour class and a bonus no monster has can be put on the table; the last
 * scenario plays a real round, for who counts as having acted.
 */
import assert from 'node:assert/strict';
import { heroSheet } from '../lib/characters.ts';
import type { Resolution } from '../lib/dm/types.ts';
import { startFight } from '../lib/play/fight.ts';
import type { RulesHook } from '../lib/play/hooks.ts';
import { diceOfRound } from '../lib/play/odds.ts';
import type { TurnResult } from '../lib/play/result.ts';
import type { PartyState } from '../lib/play/state.ts';
import { engineStep, storedChoice } from '../lib/play/table.ts';
import type { RulesState } from '../lib/play/turn.ts';
import { sceneXp, XP_LABELS, type XpAward } from '../lib/play/xp.ts';
import type { CombatEvent } from '../lib/rules/scene.ts';
import type { CharacterSheet } from '../lib/rules/sheet.ts';
import type { StoredScene, Vote } from '../lib/types.ts';

const SCENE = 4;
const unquoted = (text: string) => text.replace(/^"|"$/g, '');

interface Played { awards: XpAward[]; lines: string[]; result: TurnResult | null }

export class ActionXpSteps {
  private sheets: Record<string, CharacterSheet> = {};
  private hook: RulesHook | null = null;
  private votes: Vote[] = [];
  /** A round given as the engine logs it: its events, and who declared (and whether the clock threw their die). */
  private events: CombatEvent[] = [];
  private inRound = false;
  private idle = new Set<string>();
  /** A real fight, for the scenario that plays one. */
  private fight: RulesState | null = null;
  private played: Played | null = null;

  private idOf(name: string): string {
    return `p-${name.toLowerCase()}`;
  }

  private add(name: string, bonus = 0): void {
    const sheet = heroSheet({ id: name, name, race: 'human', characterClass: 'fighter' });
    this.sheets[this.idOf(name)] = { ...sheet, skillBonuses: { ...sheet.skillBonuses, athletics: bonus } };
  }

  private party(): PartyState {
    return { version: 1, rng: 1, sheets: this.sheets };
  }

  // ---- outside a fight ----

  heroWithBonus(name: string, bonus: number): void {
    this.add(name, bonus);
  }

  choiceIsACheck(dc: number): void {
    this.hook = { kind: 'check', ability: 'str', skill: 'athletics', dc };
  }

  withAdvantage(): void {
    assert.ok(this.hook && this.hook.kind === 'check', 'there is no check to give Advantage to');
    this.hook = { ...this.hook, advantage: true };
  }

  choiceRollsNothing(): void {
    this.hook = null;
  }

  takesIt(name: string, roll: number): void {
    this.votes.push({ playerId: this.idOf(name), choiceId: 'a', roll });
    this.resolveScene();
  }

  takesItByClock(name: string, roll: number): void {
    this.votes.push({ playerId: this.idOf(name), choiceId: 'a', roll, autoRolled: true });
    this.resolveScene();
  }

  private resolveScene(): void {
    const choice = storedChoice({ id: 'a', label: 'The way on', detail: '' }, this.hook);
    const step = engineStep({ party: this.party(), combat: null, dungeon: null }, this.scene([choice]), this.resolution());
    this.played = { awards: step.state.party.xpAwards ?? [], lines: step.state.party.results ?? [], result: step.result };
  }

  private scene(choices: StoredScene['choices']): StoredScene {
    return { index: SCENE, title: '', narration: '', imagePrompt: '', imageUrl: null, voices: {}, choices, isFinale: false, votes: this.votes, outcome: null, chosenChoiceId: null, createdAt: '' };
  }

  private resolution(): Resolution {
    const votes = this.votes.map((v) => ({ playerId: v.playerId, characterName: this.sheets[v.playerId].name, choiceId: v.choiceId, choiceLabel: 'The way on', roll: v.roll }));
    const tally = { a: 0, b: 0, c: 0 };
    for (const v of votes) tally[v.choiceId] += 1;
    const leaders = (['a', 'b', 'c'] as const).filter((id) => tally[id] > 0 && tally[id] === Math.max(tally.a, tally.b, tally.c));
    return { scene: {} as Resolution['scene'], votes, tally, leaders, abstained: [], rules: null };
  }

  // ---- a round, as the engine logs it ----

  heroInARound(name: string): void {
    this.add(name);
    this.inRound = true;
  }

  clockThrew(name: string): void {
    this.idle.add(this.idOf(name));
  }

  private log(event: Record<string, unknown>): void {
    this.events.push({ round: 1, ...event } as unknown as CombatEvent);
    this.played = null;
  }

  dodges(name: string): void {
    this.log({ kind: 'dodge', actor: this.idOf(name) });
  }

  /** An attack roll as 5.2 judges it: a natural 1 misses, a natural 20 hits, else the total against the armour class. */
  private attackEvent(name: string, ac: number, bonus: number, natural: number, reaction: boolean): void {
    const hit = natural === 20 || (natural !== 1 && natural + bonus >= ac);
    const actor = this.idOf(name);
    this.log({
      kind: 'attack', actor, ...(reaction ? { reaction: true } : {}),
      result: { attacker: actor, target: 'foe-1', attack: 'Longsword', roll: { natural, rolls: [natural], total: natural + bonus }, ac, hit, critical: natural === 20, damage: hit ? 5 : 0 },
    });
  }

  attacks(name: string, ac: number, bonus: number, roll: number): void {
    this.attackEvent(name, ac, bonus, roll, false);
  }

  opportunityAttack(name: string, ac: number, bonus: number, roll: number): void {
    this.attackEvent(name, ac, bonus, roll, true);
  }

  private spellDc = 13;

  foeSaves(bonus: number, name: string, dc: number, roll: number): void {
    this.spellDc = dc;
    this.log({
      kind: 'spell', actor: this.idOf(name), spellId: 'sacred-flame',
      outcomes: [{ target: 'foe-1', attack: null, save: { roll: { natural: roll, rolls: [roll], total: roll + bonus }, success: roll + bonus >= dc }, damage: 0, healed: 0 }],
    });
  }

  castsDarts(name: string): void {
    this.log({ kind: 'spell', actor: this.idOf(name), spellId: 'magic-missile', outcomes: [{ target: 'foe-1', attack: null, save: null, damage: 3, healed: 0 }] });
  }

  private playRound(): Played {
    const party = this.party();
    const actors = [...new Set(this.events.filter((e) => !('reaction' in e && e.reaction)).map((e) => e.actor))]
      .filter((id) => Object.hasOwn(this.sheets, id)).map((playerId) => ({ playerId, idle: this.idle.has(playerId) }));
    const rolls = diceOfRound(this.events, (id) => Object.hasOwn(this.sheets, id), () => this.spellDc);
    const paid = sceneXp(party, { sceneIndex: SCENE, actors, rolls, events: [], tag: null, round: true });
    return { awards: paid.awards, lines: paid.lines, result: null };
  }

  // ---- a real round ----

  fightingAGoblin(first: string, second: string): void {
    this.add(first);
    this.add(second);
    const started = startFight(this.party(), ['goblin-warrior']);
    this.fight = { party: started.party, combat: started.combat, dungeon: null };
  }

  hasFallen(name: string): void {
    const id = this.idOf(name);
    const combat = this.fight!.combat!;
    this.fight = { ...this.fight!, combat: { ...combat, combatants: { ...combat.combatants, [id]: { ...combat.combatants[id], hp: 0, status: 'dying' } } } };
  }

  roundIsPlayed(): void {
    this.votes = Object.keys(this.sheets).map((playerId) => ({ playerId, choiceId: 'c' as const, roll: 10 }));
    const step = engineStep(this.fight!, this.scene([]), this.resolution());
    this.played = { awards: step.state.party.xpAwards ?? [], lines: step.state.party.results ?? [], result: step.result };
  }

  // ---- what was earned ----

  private seen(): Played {
    if (!this.played) {
      assert.ok(this.inRound, 'nothing has been played');
      this.played = this.playRound();
    }
    return this.played;
  }

  private award(name: string): XpAward | undefined {
    return this.seen().awards.find((a) => a.playerId === this.idOf(name));
  }

  earnsFor(name: string, xp: number, label: string): void {
    const reasons = (this.award(name)?.reasons ?? []).map((r) => [XP_LABELS[r.reason], r.xp]);
    assert.ok(reasons.some(([l, n]) => l === unquoted(label) && n === xp), `${name} earned ${JSON.stringify(reasons)}`);
  }

  earnsInAll(name: string, xp: number): void {
    assert.equal(this.award(name)?.xp ?? 0, xp, JSON.stringify(this.award(name)));
  }

  earnsNothing(name: string): void {
    assert.equal(this.award(name), undefined);
    const hero = this.seen().result?.heroes.find((h) => h.playerId === this.idOf(name));
    if (hero) assert.equal(hero.xp, null);
  }

  hadChances(name: string, chances: number): void {
    const chance = this.award(name)?.chance;
    assert.ok(chance !== undefined, `no d20 decided what ${name} earned`);
    assert.equal(Math.round(chance * 100), chances, `${chance}`);
  }

  noDieDecided(name: string): void {
    assert.equal(this.award(name)?.chance, undefined);
  }

  logTells(line: string): void {
    assert.ok(this.seen().lines.includes(unquoted(line)), this.seen().lines.join(' | '));
  }

  logTellsNoXp(): void {
    assert.deepEqual(this.seen().lines.filter((l) => /^\+\d+ XP: /.test(l)), []);
  }

  resultGives(name: string, xp: number, first: string, a: number, second: string, b: number): void {
    const hero = this.seen().result?.heroes.find((h) => h.playerId === this.idOf(name));
    assert.ok(hero?.xp, `the result has no XP for ${name}`);
    assert.deepEqual([hero.xp.total, hero.xp.idle, hero.xp.reasons.map((r) => [r.label, r.xp])], [xp, false, [[unquoted(first), a], [unquoted(second), b]]]);
    assert.equal(hero.xp.chance?.toFixed(2), this.award(name)?.chance?.toFixed(2), 'the chance of what happened is on the result too');
  }
}
