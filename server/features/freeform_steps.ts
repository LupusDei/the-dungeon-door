/**
 * Step helpers for features/freeform_turns.feature. The fake dungeon master classifies
 * the words; the engine rolls and keeps the numbers.
 */
import assert from 'node:assert/strict';
import { heroSheet } from '../lib/characters.ts';
import { classifyFreeform } from '../lib/dm/fake.ts';
import { adjudicateCheck, DAMAGE_BY_SEVERITY, knownActionIds, settleRuling, type CheckRuling, type Settled } from '../lib/play/actions.ts';
import { fightRound, startFight } from '../lib/play/fight.ts';
import { scriptedRng } from '../lib/rules/rng.ts';
import type { CharacterSheet } from '../lib/rules/sheet.ts';
import type { CombatState } from '../lib/rules/scene.ts';

const NATURAL = 15;

export class FreeformSteps {
  private inCombat = false;
  private sheet: CharacterSheet = this.hero();
  private combat: CombatState | null = null;
  private foeHp = 0;
  private settled: Settled | null = null;
  private log = '';
  private dice = '';

  private hero(): CharacterSheet {
    const sheet = heroSheet({ id: 'p1', name: 'Bryn', race: 'human', characterClass: 'fighter' });
    return { ...sheet, abilityScores: { ...sheet.abilityScores, str: 16 }, skillBonuses: { ...sheet.skillBonuses, athletics: 5 } };
  }

  fightUnderway(): void {
    this.inCombat = true;
    this.sheet = this.hero();
    const started = startFight({ version: 1, rng: 1, sheets: { p1: this.sheet } }, ['goblin-warrior']);
    this.combat = started.combat;
    this.foeHp = started.combat.combatants['foe-1'].hp;
  }

  noFight(): void {
    this.inCombat = false;
    this.combat = null;
    this.sheet = this.hero();
  }

  playerWrites(text: string): void {
    const actions = knownActionIds(this.inCombat);
    const choices = this.inCombat
      ? [{ id: 'attack', label: 'Attack' }, { id: 'cast', label: 'Cast' }, { id: 'dodge', label: 'Dodge' }]
      : [{ id: 'a', label: 'Charge straight in' }, { id: 'b', label: 'Look for another way' }, { id: 'c', label: 'Parley first' }];
    this.settled = settleRuling(classifyFreeform({ characterName: 'Bryn', text, inCombat: this.inCombat, actions, choices }), actions);
    this.dice = '';
    this.log = '';
    if (this.settled.ruling.kind !== 'check') return;
    this.dice = this.settled.ruling.effect.category === 'damage' ? DAMAGE_BY_SEVERITY[this.settled.ruling.effect.severity] : '';
    this.log = this.combat ? this.inTheFight(text, this.settled.ruling) : adjudicateCheck(scriptedRng([1, 1]), this.sheet, text, this.settled.ruling, NATURAL, null).text;
  }

  unreadable(): void {
    this.settled = settleRuling({ kind: 'nope' }, knownActionIds(this.inCombat));
    this.log = '';
  }

  mapsTo(choice: string): void {
    assert.equal(this.settled!.choiceId, choice);
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
