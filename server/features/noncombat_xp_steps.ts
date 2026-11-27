/**
 * Step helpers for features/noncombat_xp.feature. A scene is resolved through the engine's own step
 * (play/table.ts engineStep), as lib/game.ts does it, and the quest's end through endQuest.
 */
import assert from 'node:assert/strict';
import { heroSheet } from '../lib/characters.ts';
import { resultsBlock } from '../lib/dm/rulesPrompt.ts';
import type { Resolution } from '../lib/dm/types.ts';
import { startFight } from '../lib/play/fight.ts';
import type { RulesHook } from '../lib/play/hooks.ts';
import type { PartyState } from '../lib/play/state.ts';
import { endQuest, engineStep, type EngineStep, newRules, storedChoice } from '../lib/play/table.ts';
import type { RulesState } from '../lib/play/turn.ts';
import { rulesView } from '../lib/play/view.ts';
import { srd } from '../lib/rules/srd.ts';
import type { CharacterSheet } from '../lib/rules/sheet.ts';
import type { GamePlayer, StoredScene, Vote } from '../lib/types.ts';

const SCENE = 6;

const HOOKS: Readonly<Record<string, RulesHook | null>> = {
  'a story choice': null,
  'an Athletics check': { kind: 'check', ability: 'str', skill: 'athletics', dc: 10 },
  'an impossible Athletics check': { kind: 'check', ability: 'str', skill: 'athletics', dc: 30 },
  'a parley with a goblin': { kind: 'parley', monsters: ['goblin-warrior'] },
  'a hidden pit': { kind: 'trap', trap: 'hidden-pit' },
  'a fight with a goblin': { kind: 'fight', monsters: ['goblin-warrior'] },
};

export class NoncombatXpSteps {
  private sheets: Record<string, CharacterSheet> = {};
  private kind = 'a story choice';
  private reward: string | null = null;
  private votes: Vote[] = [];
  private chapterAt: number | undefined;
  private fighting = false;
  private step: EngineStep | null = null;

  partyOf(level: number, names: string): void {
    const threshold = srd().advancement[level - 1].xp;
    for (const name of names.split(/,\s*/)) {
      this.sheets[this.idOf(name)] = { ...heroSheet({ id: name, name, race: 'human', characterClass: 'fighter' }), level, xp: threshold };
    }
  }

  hasXp(name: string, xp: number): void {
    this.sheets[this.idOf(name)] = { ...this.sheets[this.idOf(name)], xp };
  }

  sharpEye(name: string): void {
    this.sheets[this.idOf(name)] = { ...this.sheets[this.idOf(name)], skillBonuses: { investigation: 10 } };
  }

  choiceIs(kind: string): void {
    this.kind = kind;
  }

  tagged(tag: string): void {
    this.reward = tag;
  }

  chapterAgo(scenes: number): void {
    this.chapterAt = SCENE - scenes;
  }

  inAFight(): void {
    this.fighting = true;
  }

  declares(name: string, roll: number): void {
    this.votes.push({ playerId: this.idOf(name), choiceId: 'a', roll });
  }

  declaresIdle(name: string, roll: number): void {
    this.votes.push({ playerId: this.idOf(name), choiceId: 'a', roll, autoRolled: true });
  }

  resolve(): void {
    const state = this.state();
    const hook = this.kind === 'the way into an unseen room' ? { kind: 'move' as const, exit: state.dungeon!.map.nodes[state.dungeon!.at].exits[0].id } : HOOKS[this.kind];
    if (hook === undefined) throw new Error(`no choice called "${this.kind}"`);
    const choice = storedChoice({ id: 'a', label: this.kind, detail: '' }, hook, state.dungeon, this.reward);
    const scene: StoredScene = { index: SCENE, title: '', narration: '', imagePrompt: '', imageUrl: null, voices: {}, choices: [choice], isFinale: false, votes: this.votes, outcome: null, chosenChoiceId: null, createdAt: '' };
    this.step = engineStep(state, scene, this.resolution());
  }

  questEnds(): void {
    this.resolve();
    this.step = endQuest(this.step!);
  }

  logSays(line: string): void {
    assert.ok(this.lines().includes(line), this.lines().join(' | '));
  }

  logDoesNotMention(words: string): void {
    assert.ok(!this.lines().some((l) => l.includes(words)), this.lines().join(' | '));
  }

  noXpFor(name: string): void {
    assert.ok(!this.xpLines().some((l) => l.includes(name)), this.lines().join(' | '));
  }

  noXp(): void {
    assert.deepEqual(this.xpLines(), []);
  }

  nowHas(name: string, xp: number): void {
    assert.equal(this.sheetOf(name).xp, xp);
  }

  isLevel(name: string, level: number): void {
    assert.equal(this.sheetOf(name).level, level);
  }

  sheetShows(name: string, xp: number, next: number): void {
    const hero = this.heroView(name);
    assert.deepEqual([hero.xp, hero.nextLevelXp], [xp, next]);
  }

  sheetShowsEarned(name: string, xp: number): void {
    assert.equal(this.heroView(name).questXp, xp);
  }

  dmTold(line: string): void {
    assert.ok(resultsBlock(this.step!.resolution.rules).split('\n').includes(line), resultsBlock(this.step!.resolution.rules));
  }

  private idOf(name: string): string {
    return `p-${name.toLowerCase()}`;
  }

  private party(): PartyState {
    return { version: 1, rng: 1, sheets: this.sheets, ...(this.chapterAt === undefined ? {} : { chapterAt: this.chapterAt }) };
  }

  private state(): RulesState {
    const party = this.party();
    if (this.fighting) {
      const started = startFight(party, ['goblin-warrior']);
      return { party: started.party, combat: started.combat, dungeon: null };
    }
    if (this.kind !== 'the way into an unseen room') return { party, combat: null, dungeon: null };
    const players = Object.entries(this.sheets).map(([playerId, sheet]): GamePlayer => ({
      playerId, joinedAt: '',
      character: { id: `c-${playerId}`, ownerId: playerId, name: sheet.name, race: 'human', characterClass: 'fighter', gender: '', temperament: '', alignment: '', backstory: '', description: '', appearance: '', portraitUrl: null, createdAt: '', updatedAt: '', sheet } as GamePlayer['character'],
    }));
    const rules = newRules(players, 'fixed', 7, 6);
    const { trek: _, ...atTheDoor } = rules.party;
    return { party: { ...atTheDoor, ...party }, combat: null, dungeon: rules.dungeon };
  }

  private resolution(): Resolution {
    const votes = this.votes.map((v) => ({ playerId: v.playerId, characterName: this.sheets[v.playerId].name, choiceId: v.choiceId, choiceLabel: this.kind, roll: v.roll }));
    return { scene: {} as Resolution['scene'], votes, tally: { a: votes.length, b: 0, c: 0 }, leaders: votes.length ? ['a'] : [], abstained: [], rules: null };
  }

  private lines(): string[] {
    return this.step!.state.party.results ?? [];
  }

  private xpLines(): string[] {
    return this.lines().filter((l) => /^\+\d+ XP: /.test(l));
  }

  private sheetOf(name: string): CharacterSheet {
    return this.step!.state.party.sheets[this.idOf(name)];
  }

  private heroView(name: string) {
    return rulesView(this.step!.state, this.lines()).party.find((h) => h.name === name)!;
  }
}
