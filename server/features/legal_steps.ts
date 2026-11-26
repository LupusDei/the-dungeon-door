/**
 * Step helpers for features/legal_actions.feature. Generated specs call these;
 * they ask the engine for a hero's legal actions and play a vote that names one.
 */
import assert from 'node:assert/strict';
import { heroSheet } from '../lib/characters.ts';
import type { Combatant } from '../lib/rules/combatant.ts';
import type { CombatState } from '../lib/rules/scene.ts';
import type { CharacterSheet } from '../lib/rules/sheet.ts';
import { fightRound, startFight } from '../lib/play/fight.ts';
import { checkVote, legalActions, type CheckedVote } from '../lib/play/legal.ts';
import type { LegalAction } from '../lib/types.ts';
import type { PartyState } from '../lib/play/state.ts';

const harmless: Combatant['attacks'] = [{ name: 'Poke', bonus: 0, ranged: false, damage: [{ dice: '0', type: 'bludgeoning' }] }];

export class LegalSteps {
  private actions: LegalAction[] = [];
  private party: PartyState | null = null;
  private combat: CombatState | null = null;
  private vote: CheckedVote | null = null;
  private lines: string[] = [];

  private sit(sheet: CharacterSheet, fighting: boolean): void {
    if (!fighting) {
      this.party = { version: 1, rng: 4, sheets: { p1: sheet } };
      this.combat = null;
      this.actions = legalActions({ combat: null, sheet, playerId: 'p1', choices: [], canAct: true });
      return;
    }
    const started = startFight({ version: 1, rng: 4, sheets: { p1: sheet } }, ['goblin-warrior']);
    const foe = started.combat.combatants['foe-1'];
    this.combat = { ...started.combat, combatants: { ...started.combat.combatants, 'foe-1': { ...foe, attacks: harmless } } };
    this.party = started.party;
    this.actions = legalActions({ combat: this.combat, sheet: started.party.sheets.p1, playerId: 'p1', choices: [], canAct: true });
  }

  fighterInAFight(): void {
    this.sit(heroSheet({ id: 'f', name: 'Bryn', race: 'human', characterClass: 'fighter' }), true);
  }

  wizardWithNoSlots(spell: string): void {
    const base = heroSheet({ id: 'w', name: 'Cleo', race: 'elf', characterClass: 'wizard' });
    const casting = base.spellcasting!;
    this.sit({ ...base, spellcasting: { ...casting, cantrips: [], prepared: [spell], expended: [...casting.slots] } }, true);
  }

  fighterWithGreatsword(): void {
    const base = heroSheet({ id: 'f', name: 'Bryn', race: 'human', characterClass: 'fighter' });
    this.sit({ ...base, equipment: [...base.equipment, { id: 'greatsword', name: 'Greatsword', count: 1 }] }, true);
  }

  withChoices(a: string, b: string, c: string): void {
    const sheet = heroSheet({ id: 'f', name: 'Bryn', race: 'human', characterClass: 'fighter' });
    this.party = { version: 1, rng: 4, sheets: { p1: sheet } };
    this.combat = null;
    this.actions = legalActions({
      combat: null, sheet, playerId: 'p1', canAct: true,
      choices: [{ id: 'a', label: a, detail: '' }, { id: 'b', label: b, detail: '' }, { id: 'c', label: c, detail: '' }],
    });
  }

  private named(id: string): LegalAction {
    const found = this.actions.find((action) => action.id === id);
    assert.ok(found, this.actions.map((action) => action.id).join(', '));
    return found;
  }

  weaponAttackIsOffered(): void {
    assert.ok(this.actions.some((action) => action.kind === 'attack' && action.available));
  }

  actionIsAvailable(id: string): void {
    assert.equal(this.named(id).available, true, this.named(id).reason ?? '');
  }

  actionIsUnavailable(id: string, reason: string): void {
    const action = this.named(id);
    assert.equal(action.available, false);
    assert.equal(action.reason, reason);
  }

  actionIsLabeled(id: string, label: string): void {
    assert.equal(this.named(id).label, label);
  }

  voteGreatsword(): void {
    const sword = this.named('attack:greatsword');
    this.vote = checkVote(this.actions, sword.id, [sword.targets[0].id]);
    if (this.vote.ok && this.combat && this.party) {
      const round = fightRound(this.party, this.combat, { p1: { choiceId: this.vote.choiceId, roll: 18, actionId: sword.id, targets: this.vote.targets } });
      this.lines = round.lines;
    }
  }

  voteAttackAt(target: string): void {
    const attack = this.actions.find((action) => action.kind === 'attack');
    assert.ok(attack);
    this.vote = checkVote(this.actions, attack.id, [target]);
  }

  voteIsAccepted(): void {
    assert.equal(this.vote?.ok, true);
  }

  voteIsRefused(): void {
    assert.equal(this.vote?.ok, false);
  }

  engineStrikesWith(weapon: string): void {
    assert.ok(this.lines.some((line) => line.includes(`with ${weapon}`)), this.lines.join(' | '));
  }
}
