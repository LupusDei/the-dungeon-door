/**
 * Step helpers for features/turn_result.feature. A turn is resolved through the engine's own step
 * (play/table.ts engineStep), as lib/game.ts does it: the fake dungeon master classifies a written
 * action, the engine rolls, and the result read here is the one the app is sent (play/result.ts).
 */
import assert from 'node:assert/strict';
import { heroSheet } from '../lib/characters.ts';
import { classifyFreeform } from '../lib/dm/fake.ts';
import type { Resolution } from '../lib/dm/types.ts';
import { isPersonalCheck, settleRuling } from '../lib/play/actions.ts';
import type { HeroResult, TurnResult } from '../lib/play/result.ts';
import { engineStep, storedChoice } from '../lib/play/table.ts';
import type { CharacterSheet } from '../lib/rules/sheet.ts';
import { CHOICE_IDS, type GamePlayer, type StoredChoice, type StoredScene, type Vote } from '../lib/types.ts';

const SCENE = 3;
/** How well a hero talks: nobody is trained in it until a step says so. */
const PLAIN = 1;
const SILVER_TONGUED = 8;

export class TurnResultSteps {
  private names: string[] = [];
  private sheets: Record<string, CharacterSheet> = {};
  private choices: StoredChoice[] = [
    { id: 'a', label: 'Talk them round', detail: '' },
    { id: 'b', label: 'Climb the wall', detail: '' },
    { id: 'c', label: 'Wait for dark', detail: '' },
  ];
  private votes: Vote[] = [];
  private result: TurnResult | null = null;

  tableOf(names: string): void {
    this.names = names.split(/,\s*/);
    for (const name of this.names) {
      const sheet = heroSheet({ id: name, name, race: 'human', characterClass: 'fighter' });
      this.sheets[this.idOf(name)] = this.talking(sheet, PLAIN, false);
    }
  }

  betterTalker(name: string): void {
    this.sheets[this.idOf(name)] = this.talking(this.sheets[this.idOf(name)], SILVER_TONGUED, true);
  }

  persuasionChoice(): void {
    this.choices[0] = storedChoice({ id: 'a', label: 'Talk them round', detail: '' }, { kind: 'check', ability: 'cha', skill: 'persuasion', dc: 10, mode: 'best' });
  }

  picksFirst(name: string, roll: number): void {
    this.votes.push({ playerId: this.idOf(name), choiceId: 'a', roll });
  }

  writes(name: string, text: string, roll: number): void {
    const settled = settleRuling(classifyFreeform({ characterName: name, text, inCombat: false, actions: [], choices: [] }), []);
    if (settled.ruling.kind !== 'check') throw new Error(`"${text}" is not a check`);
    this.votes.push({ playerId: this.idOf(name), choiceId: 'a', roll, freeform: { text, ruling: settled.ruling } });
  }

  resolve(): void {
    const scene: StoredScene = { index: SCENE, title: '', narration: '', imagePrompt: '', imageUrl: null, voices: {}, choices: this.choices, isFinale: false, votes: this.votes, outcome: null, chosenChoiceId: null, createdAt: '' };
    const step = engineStep({ party: { version: 1, rng: 1, sheets: this.sheets }, combat: null, dungeon: null }, scene, this.resolution(), this.players());
    this.result = step.result;
  }

  pickedBy(names: string): void {
    assert.deepEqual(this.outcome().choice?.backers, names.split(/,\s*/).map((name) => this.idOf(name)));
  }

  rolledOwn(name: string, check: string, roll: number): void {
    const rolls = this.hero(name).rolls;
    assert.ok(rolls.some((r) => r.name === check && r.natural === roll && r.dice.length === 1 && !r.fresh), JSON.stringify(rolls));
  }

  rolledNothing(name: string): void {
    assert.deepEqual(this.hero(name).rolls.filter((r) => r.for === 'choice'), []);
  }

  didOwn(name: string, text: string): void {
    const hero = this.hero(name);
    assert.deepEqual([hero.did, hero.text, hero.choiceId], ['own', text, undefined]);
  }

  lists(names: string): void {
    assert.deepEqual(this.outcome().heroes.map((h) => h.name), names.split(/,\s*/));
  }

  didNothing(name: string): void {
    assert.equal(this.hero(name).did, 'nothing');
  }

  private idOf(name: string): string {
    return `p-${name.toLowerCase()}`;
  }

  private talking(sheet: CharacterSheet, bonus: number, trained: boolean): CharacterSheet {
    const skills = sheet.skills.filter((s) => s !== 'persuasion');
    return { ...sheet, skills: trained ? [...skills, 'persuasion'] : skills, skillBonuses: { ...sheet.skillBonuses, persuasion: bonus } };
  }

  /** The table in joining order, as lib/game.ts hands it to the engine. */
  private players(): GamePlayer[] {
    return this.names.map((name): GamePlayer => ({
      playerId: this.idOf(name), joinedAt: '',
      character: { id: `c-${this.idOf(name)}`, ownerId: this.idOf(name), name, race: 'human', characterClass: 'fighter', gender: '', temperament: '', alignment: '', backstory: '', description: '', appearance: '', portraitUrl: null, createdAt: '', updatedAt: '' },
    }));
  }

  /** The votes as lib/game.ts counts them: a written action has acted, and is not a pick. */
  private resolution(): Resolution {
    const picks = this.votes.filter((v) => !isPersonalCheck(v));
    const tally = { a: 0, b: 0, c: 0 };
    for (const v of picks) tally[v.choiceId]++;
    const top = Math.max(tally.a, tally.b, tally.c);
    const votes = picks.map((v) => ({ playerId: v.playerId, characterName: this.sheets[v.playerId].name, choiceId: v.choiceId, choiceLabel: '', roll: v.roll }));
    return { scene: {} as Resolution['scene'], votes, tally, leaders: CHOICE_IDS.filter((id) => tally[id] === top && top > 0), abstained: [], rules: null };
  }

  private outcome(): TurnResult {
    assert.ok(this.result, 'the turn has no result');
    return this.result;
  }

  private hero(name: string): HeroResult {
    const hero = this.outcome().heroes.find((h) => h.name === name);
    assert.ok(hero, `${name} is not in the result`);
    return hero;
  }
}
