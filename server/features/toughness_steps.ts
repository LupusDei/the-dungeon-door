/**
 * Step helpers for features/sizing_up_a_fight.feature. Generated specs call these;
 * they talk to the engine the way a scene does (a fight choice, a meeting, a round).
 */
import assert from 'node:assert/strict';
import { heroSheet } from '../lib/characters.ts';
import { monster, monsters } from '../lib/rules/monsters.ts';
import { startDungeon } from '../lib/play/delve.ts';
import { hookLabel } from '../lib/play/hooks.ts';
import type { PartyState } from '../lib/play/state.ts';
import { choiceView } from '../lib/play/table.ts';
import { confrontationChoices, playTurn, type Ballot, type RulesTurn } from '../lib/play/turn.ts';
import { rulesView } from '../lib/play/view.ts';

const CLASSES = ['fighter', 'rogue', 'cleric', 'wizard'] as const;
const NAMES = ['Bryn', 'Cleo', 'Mira', 'Oz'];

export class ToughnessSteps {
  private levels: number[] = [];
  private party: PartyState | null = null;
  private turn: RulesTurn | null = null;
  private room: string | null = null;
  private gold = 0;
  private xp = 0;
  private rulesText = '';

  partyOfFour(): void {
    const sheets = Object.fromEntries(CLASSES.map((characterClass, i) => {
      const playerId = `p${i + 1}`;
      return [playerId, heroSheet({ id: playerId, name: NAMES[i], race: 'human', characterClass })];
    }));
    this.party = { version: 1, rng: 1, sheets };
    this.levels = Object.values(sheets).map((s) => s.level);
  }

  offeredFight(count: number, name: string): void {
    this.rulesText = hookLabel({ kind: 'fight', monsters: this.ids(count, name) }, this.levels);
  }

  fightChoiceReads(line: string): void {
    assert.equal(this.rulesText, line);
  }

  partyEngages(count: number, name: string): void {
    this.turn = playTurn(this.state(), { kind: 'fight', monsters: this.ids(count, name) }, this.ballots());
  }

  foeShownAs(name: string, toughness: string): void {
    const foes = this.shown().combat!.combatants.filter((c) => c.name === name);
    assert.ok(foes.length > 0, `no ${name} in the fight`);
    assert.ok(foes.every((c) => c.toughness === toughness), JSON.stringify(foes));
  }

  fightShownAs(band: string): void {
    assert.equal(this.shown().combat!.band, band);
  }

  stepsIntoHostileRoom(count: number, name: string, gold: number): void {
    const ids = this.ids(count, name);
    let dungeon = startDungeon('fixed', 3, this.levels, 4);
    const r1 = dungeon.map.nodes.r1;
    const contents = {
      ...r1.contents!, kind: 'monster' as const, trap: null,
      encounter: { difficulty: 'moderate' as const, budget: gold, xp: ids.reduce((n, id) => n + monster(id).xp, 0), monsters: ids },
      treasure: { gp: gold, sp: 0, gems: 0, jewellery: 0, magicItem: null },
    };
    dungeon = { ...dungeon, map: { ...dungeon.map, nodes: { ...dungeon.map.nodes, r1: { ...r1, contents } } } };
    const sheets = this.party!.sheets;
    this.gold = Object.values(sheets).reduce((n, s) => n + s.gp, 0);
    this.xp = Object.values(sheets).reduce((n, s) => n + s.xp, 0);
    this.room = 'r1';
    this.turn = playTurn({ party: this.party!, combat: null, dungeon }, { kind: 'move', exit: 'r1' }, this.ballots());
  }

  noFightHasStarted(): void {
    assert.equal(this.turn!.fight, null);
    assert.equal(this.turn!.combat, null);
  }

  offeredChoices(first: string, second: string, third: string): void {
    assert.deepEqual(confrontationChoices(this.turn!)?.map((c) => c.label), [first, second, third]);
  }

  waitingNotice(foes: string, toughness: string, band: string): void {
    const waiting = this.shown().dungeon!.waiting!;
    assert.equal(waiting.foes, foes);
    assert.equal(waiting.attitude, 'hostile');
    assert.ok(waiting.monsters.length > 0 && waiting.monsters.every((m) => m.toughness === toughness), JSON.stringify(waiting));
    assert.equal(waiting.band, band);
  }

  engagingWouldBe(line: string): void {
    const engage = confrontationChoices(this.turn!)!.find((c) => c.label === 'Engage')!;
    assert.equal(choiceView(engage, this.levels).rules, line);
  }

  partyRuns(): void {
    const hook = confrontationChoices(this.turn!)!.find((c) => c.label === 'Run')!.hook!;
    this.turn = playTurn(this.turn!, hook, this.ballots());
  }

  leftThatRoom(): void {
    assert.notEqual(this.turn!.dungeon!.at, this.room);
  }

  roomNotCleared(): void {
    assert.equal(this.turn!.dungeon!.cleared.includes(this.room!), false);
  }

  goldUnchanged(): void {
    assert.equal(Object.values(this.turn!.party.sheets).reduce((n, s) => n + s.gp, 0), this.gold);
  }

  experienceUnchanged(): void {
    assert.equal(Object.values(this.turn!.party.sheets).reduce((n, s) => n + s.xp, 0), this.xp);
  }

  private state() {
    return { party: this.party!, combat: null, dungeon: null };
  }

  private ballots(): Ballot[] {
    return Object.keys(this.party!.sheets).map((playerId) => ({ playerId, choiceId: 'a' as const, roll: 10 }));
  }

  private ids(count: number, name: string): string[] {
    const found = [...monsters().values()].filter((m) => m.name === name);
    if (found.length !== 1) throw new Error(`"${name}" matches ${found.map((m) => m.id).join(', ') || 'nothing'}`);
    return Array<string>(count).fill(found[0].id);
  }

  private shown() {
    return rulesView(this.turn!, this.turn!.lines);
  }
}
