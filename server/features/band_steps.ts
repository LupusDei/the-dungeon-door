/**
 * Step helpers for features/range_bands.feature. gherclj generates a node:test that calls these.
 */
import assert from 'node:assert/strict';
import { heroSheet } from '../lib/characters.ts';
import { type Move, validateMove } from '../lib/rules/bands.ts';
import type { Combatant } from '../lib/rules/combatant.ts';
import { RuleViolation } from '../lib/rules/violation.ts';
import { heroAction, startFight } from '../lib/play/fight.ts';
import type { PartyState } from '../lib/play/state.ts';
import { act, type CombatState, relocate } from '../lib/rules/scene.ts';

const fighter = () => heroSheet({ id: 'f', name: 'Bryn', race: 'human', characterClass: 'fighter' });
const wizard = () => heroSheet({ id: 'w', name: 'Cleo', race: 'elf', characterClass: 'wizard' });

export class BandSteps {
  private party!: PartyState;
  private combat!: CombatState;
  private refusal: string | null = null;
  private caughtCount = 0;

  private hero(): Combatant {
    return this.combat.combatants.p1;
  }

  private foe(): Combatant {
    return this.combat.combatants['foe-1'];
  }

  private place(id: string, band: 'engaged' | 'near' | 'far', withIds: string[]) {
    const combatants = { ...this.combat.combatants };
    combatants[id] = { ...combatants[id], place: { band, with: withIds } };
    this.combat = { ...this.combat, combatants };
  }

  /** Given a fight between Bryn and a goblin. */
  start(): void {
    const started = startFight({ version: 1, rng: 1, sheets: { p1: fighter() } }, ['goblin-warrior']);
    this.party = started.party;
    this.combat = started.combat;
    this.refusal = null;
  }

  /** Given Cleo fights two goblins, with Burning Hands prepared. */
  cleo(): void {
    const cleo = wizard();
    const sheet = { ...cleo, spellcasting: { ...cleo.spellcasting!, cantrips: [], prepared: ['burning-hands'] } };
    const started = startFight({ version: 1, rng: 2, sheets: { p1: sheet } }, ['goblin-warrior', 'goblin-warrior']);
    this.party = started.party;
    this.combat = started.combat;
  }

  goblinFar(): void {
    this.place('p1', 'near', []);
    this.place('foe-1', 'far', []);
  }

  bothEngaged(): void {
    this.place('p1', 'engaged', ['foe-1']);
    this.place('foe-1', 'engaged', ['p1']);
  }

  /** A poke that hits and deals 1, so the opportunity attack is visible and Bryn stays up. */
  goblinHits(): void {
    const foe = this.foe();
    this.combat = {
      ...this.combat,
      combatants: {
        ...this.combat.combatants,
        p1: { ...this.hero(), hp: 40, maxHp: 40 },
        'foe-1': { ...foe, attacks: [{ name: 'Poke', bonus: 40, ranged: false, damage: [{ dice: '1', type: 'piercing' }] }] },
      },
    };
  }

  private tryMove(move: Move): void {
    try {
      validateMove(this.combat, 'p1', move);
      this.combat = relocate(this.combat, 'p1', move);
      this.refusal = null;
    } catch (error) {
      this.refusal = error instanceof RuleViolation ? error.message : String(error);
    }
  }

  engage(): void {
    this.tryMove({ to: 'engaged', engage: ['foe-1'] });
  }

  dashEngage(): void {
    this.tryMove({ to: 'engaged', engage: ['foe-1'], dash: true });
  }

  moveNear(): void {
    this.tryMove({ to: 'near' });
  }

  disengageNear(): void {
    this.tryMove({ to: 'near', disengage: true });
  }

  attack(): void {
    const action = heroAction(this.combat, this.party.sheets.p1, 'p1', 'a', 18).action;
    this.combat = { ...this.combat, turn: this.combat.order.indexOf('p1') };
    this.combat = act(this.combat, action);
  }

  burningHands(): void {
    const action = heroAction(this.combat, this.party.sheets.p1, 'p1', 'b', 12).action;
    this.caughtCount = action.kind === 'spell' ? action.targets.length : 0;
  }

  brynAt(position: string): void {
    assert.equal(this.hero().place?.band, position);
  }

  goblinAt(position: string): void {
    assert.equal(this.foe().place?.band, position);
  }

  brynHoldsGoblin(): void {
    assert.ok(this.hero().place?.with.includes('foe-1'));
  }

  goblinHoldsBryn(): void {
    assert.ok(this.foe().place?.with.includes('p1'));
  }

  opportunityAttack(): void {
    assert.ok(this.combat.log.some((event) => event.kind === 'attack' && event.reaction));
  }

  noOpportunityAttack(): void {
    assert.equal(this.combat.log.some((event) => event.kind === 'attack' && event.reaction), false);
  }

  refused(): void {
    assert.match(this.refusal ?? '', /already near/);
  }

  caught(count: number): void {
    assert.equal(this.caughtCount, count);
  }
}
