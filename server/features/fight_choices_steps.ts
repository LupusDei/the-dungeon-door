/**
 * Step helpers for features/fight_choices.feature: the round's choices as the engine writes them for one
 * hero, a vote that names a weapon or spell, and words the fake dungeon master classifies and the engine aims.
 */
import assert from 'node:assert/strict';
import { heroSheet } from '../lib/characters.ts';
import { classifyFreeform } from '../lib/dm/fake.ts';
import { aimWritten, knownActionIds, settleRuling } from '../lib/play/actions.ts';
import { startFight } from '../lib/play/fight.ts';
import { checkVote, legalActions, type CheckedVote } from '../lib/play/legal.ts';
import { yourChoices } from '../lib/play/your-turn.ts';
import type { CombatState } from '../lib/rules/scene.ts';
import type { CharacterSheet } from '../lib/rules/sheet.ts';
import type { ChoiceView, LegalAction } from '../lib/types.ts';

/** "a goblin warrior and a wolf" → ["goblin-warrior", "wolf"]. */
const monsterIds = (foes: string): string[] =>
  foes.split(/\s*,\s*|\s+and\s+/).map((f) => f.trim().replace(/^(a|an|the)\s+/i, '').toLowerCase().replace(/\s+/g, '-')).filter(Boolean);

const unquoted = (text: string) => text.replace(/^"|"$/g, '');

export class FightChoicesSteps {
  private sheet!: CharacterSheet;
  private combat!: CombatState;
  private picked: CheckedVote | null = null;
  private written: { action: LegalAction; targets: string[] | null; choiceId: string | null } | null = null;

  private hero(kind: string): CharacterSheet {
    const sheet = heroSheet({ id: 'p1', name: 'Nillort', race: 'human', characterClass: kind });
    // The forge deals spells by the hero's id: this one gets two it can hurl across a room beside Magic Missile.
    return sheet.spellcasting ? { ...sheet, spellcasting: { ...sheet.spellcasting, cantrips: ['ray-of-frost', 'fire-bolt'], prepared: ['magic-missile'] } } : sheet;
  }

  private choices(): ChoiceView[] {
    return yourChoices(this.combat, this.sheet, 'p1');
  }

  private legal(): LegalAction[] {
    return legalActions({ combat: this.combat, sheet: this.sheet, playerId: 'p1', canAct: true, choices: this.choices() });
  }

  private foe(name: string) {
    const wanted = unquoted(name).toLowerCase();
    const foe = Object.values(this.combat.combatants).find((c) => c.side !== 'party' && c.name.toLowerCase() === wanted);
    assert.ok(foe, `no foe called ${name}`);
    return foe;
  }

  private nameOf(id: string): string {
    return this.combat.combatants[id]?.name ?? id;
  }

  heroFights(hero: string, foes: string): void {
    this.sheet = this.hero(hero);
    this.combat = startFight({ version: 1, rng: 1, sheets: { p1: this.sheet } }, monsterIds(foes)).combat;
  }

  hasLostHalf(name: string): void {
    const foe = this.foe(name);
    this.combat = { ...this.combat, combatants: { ...this.combat.combatants, [foe.id]: { ...foe, hp: Math.floor(foe.maxHp / 2) } } };
  }

  picksFor(name: string, foe: string): void {
    const wanted = unquoted(name).toLowerCase();
    const action = this.legal().find((a) => (a.kind === 'spell' || a.kind === 'attack') && a.label.toLowerCase().endsWith(wanted));
    assert.ok(action, `nothing called ${name} to pick`);
    this.picked = checkVote(this.legal(), action.id, [this.foe(foe).id]);
  }

  wordsAreWritten(text: string): void {
    const words = unquoted(text);
    const legal = this.legal();
    const actions = knownActionIds(legal);
    const choices = legal.filter((a) => a.available).map((a) => ({ id: a.id, label: a.label }));
    const settled = settleRuling(classifyFreeform({ characterName: this.sheet.name, text: words, inCombat: true, actions, choices }), actions);
    assert.equal(settled.ruling.kind, 'known', `the words were not taken for an action: ${JSON.stringify(settled)}`);
    const id = settled.ruling.kind === 'known' ? settled.ruling.action : '';
    const action = legal.find((a) => a.id === id)!;
    const hurt = (who: string) => this.combat.combatants[who].hp / this.combat.combatants[who].maxHp;
    this.written = { action, targets: aimWritten(action, words, hurt), choiceId: settled.choiceId };
  }

  choicesAreHeaded(a: string, b: string, c: string): void {
    assert.deepEqual(this.choices().map((choice) => choice.heading), [a, b, c].map(unquoted));
  }

  plainPickCasts(spell: string): void {
    assert.equal(this.choices()[1].label, `Cast ${unquoted(spell)}`);
  }

  pickPlaysAs(choice: string): void {
    assert.ok(this.picked?.ok, JSON.stringify(this.picked));
    assert.equal(this.picked.choiceId, unquoted(choice));
  }

  pickIs(label: string, foe: string): void {
    assert.ok(this.picked?.ok, JSON.stringify(this.picked));
    assert.deepEqual([this.picked.action.label, this.picked.targets.map((id) => this.nameOf(id))], [unquoted(label), [unquoted(foe)]]);
  }

  writtenActionIs(label: string, foe: string): void {
    assert.ok(this.written, 'nothing was written');
    assert.deepEqual([this.written.action.label, (this.written.targets ?? []).map((id) => this.nameOf(id))], [unquoted(label), [unquoted(foe)]]);
    // What is stored is a vote the engine accepts.
    assert.ok(checkVote(this.legal(), this.written.action.id, this.written.targets ?? []).ok);
  }
}
