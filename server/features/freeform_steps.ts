/**
 * Step helpers for features/freeform_turns.feature. The fake dungeon master classifies
 * the words; the engine rolls and keeps the numbers.
 */
import assert from 'node:assert/strict';
import { heroSheet } from '../lib/characters.ts';
import { classifyFreeform } from '../lib/dm/fake.ts';
import { adjudicateCheck, attackStartsFight, DAMAGE_BY_SEVERITY, knownActionIds, settleRuling, type CheckRuling, type Settled } from '../lib/play/actions.ts';
import { fightRound, startFight } from '../lib/play/fight.ts';
import { legalActions, type LegalInput } from '../lib/play/legal.ts';
import type { LegalAction } from '../lib/types.ts';
import { scriptedRng } from '../lib/rules/rng.ts';
import type { CharacterSheet } from '../lib/rules/sheet.ts';
import type { CombatState } from '../lib/rules/scene.ts';

const NATURAL = 15;

export class FreeformSteps {
  private inCombat = false;
  private sheet: CharacterSheet = this.hero();
  private legal: LegalAction[] = [];
  private combat: CombatState | null = null;
  private foeHp = 0;
  private settled: Settled | null = null;
  /** The ids of the choices that start a fight if the party takes them. */
  private fights: string[] = [];
  private log = '';
  private dice = '';

  private hero(): CharacterSheet {
    const sheet = heroSheet({ id: 'p1', name: 'Bryn', race: 'human', characterClass: 'fighter' });
    return { ...sheet, abilityScores: { ...sheet.abilityScores, str: 16 }, skillBonuses: { ...sheet.skillBonuses, athletics: 5 } };
  }

  fightUnderway(): void {
    this.inCombat = true;
    this.fights = [];
    this.sheet = this.hero();
    const started = startFight({ version: 1, rng: 1, sheets: { p1: this.sheet } }, ['goblin-warrior']);
    this.combat = started.combat;
    this.foeHp = started.combat.combatants['foe-1'].hp;
    this.legal = this.list();
  }

  noFight(): void {
    this.inCombat = false;
    this.fights = [];
    this.combat = null;
    this.sheet = this.hero();
    this.legal = this.list();
  }

  /** One of the scene's choices starts a fight with a goblin. */
  fightOnOffer(choice: string): void {
    this.fights = [`choice:${choice}`];
  }

  private list(): LegalAction[] {
    const input: LegalInput = {
      combat: this.combat, sheet: this.sheet, playerId: 'p1', canAct: true,
      choices: this.inCombat ? [] : [
        { id: 'a', label: 'Charge straight in', detail: '' },
        { id: 'b', label: 'Find a quieter way', detail: '' },
        { id: 'c', label: 'Parley first', detail: '' },
      ],
    };
    return legalActions(input);
  }

  playerWritesTheirAttack(): void {
    const attack = this.legal.find((a) => a.kind === 'attack' && a.available);
    if (!attack) throw new Error('no attack on the legal list');
    this.playerWrites(attack.label);
  }

  playerWrites(text: string): void {
    const actions = knownActionIds(this.legal);
    const choices = this.legal.filter((a) => a.available).map((a) => ({ id: a.id, label: a.label, ...(this.fights.includes(a.id) ? { fight: 'Goblin Warrior' } : {}) }));
    const read = settleRuling(classifyFreeform({ characterName: 'Bryn', text, inCombat: this.inCombat, actions, choices }), actions);
    this.settled = attackStartsFight(read, this.fights, this.inCombat);
    this.dice = '';
    this.log = '';
    if (this.settled.ruling.kind !== 'check') return;
    this.dice = this.settled.ruling.effect.category === 'damage' ? DAMAGE_BY_SEVERITY[this.settled.ruling.effect.severity] : '';
    this.log = this.combat ? this.inTheFight(text, this.settled.ruling) : adjudicateCheck(scriptedRng([1, 1]), this.sheet, text, this.settled.ruling, NATURAL, null).text;
  }

  unreadable(): void {
    this.settled = settleRuling({ kind: 'nope' }, knownActionIds(this.legal));
    this.log = '';
  }

  mapsTo(choice: string): void {
    assert.equal(this.settled!.choiceId, choice);
  }

  mapsToNoChoice(): void {
    assert.equal(this.settled!.choiceId, null);
  }

  turnIsSpent(): void {
    assert.equal(this.settled!.spent, true);
  }

  turnIsNotSpent(): void {
    assert.equal(this.settled!.spent, false);
  }

  againstDc(dc: number): void {
    assert.match(this.log, new RegExp(`vs DC ${dc}`));
  }

  damageDice(dice: string): void {
    assert.equal(this.dice, dice);
  }

  logContains(fragment: string): void {
    assert.ok(this.log.includes(fragment), this.log);
  }

  narrationRefuses(): void {
    assert.equal(this.settled!.narration, 'That cannot be done.');
  }

  foeHasLostHitPoints(): void {
    const foe = this.combat!.combatants['foe-1'];
    assert.ok(foe.hp < this.foeHp, `${foe.hp} is not below ${this.foeHp}`);
  }

  private inTheFight(text: string, ruling: CheckRuling): string {
    const round = fightRound(
      { version: 1, rng: this.combat!.rng, sheets: { p1: this.sheet } },
      this.combat!,
      { p1: { choiceId: 'c', roll: NATURAL, text, freeform: ruling } },
    );
    this.combat = round.combat;
    return round.lines.join('\n');
  }
}
