/**
 * Step helpers for features/quest.feature. A quest walked through the pure rules: its plan (play/quest.ts),
 * how each scene ends (play/table.ts endingOf), where the tale stands (play/progress.ts) and the choice
 * that faces the goal past the plan (play/quest.ts towardTheGoal).
 */
import assert from 'node:assert/strict';
import { startDungeon } from '../lib/play/delve.ts';
import { sceneProgress } from '../lib/play/progress.ts';
import { planQuest, questClosed, towardTheGoal } from '../lib/play/quest.ts';
import type { PartyState } from '../lib/play/state.ts';
import { endingOf } from '../lib/play/table.ts';
import { TREK_SCENES } from '../lib/play/trek.ts';
import { fightBand } from '../lib/rules/encounter.ts';

const LEVELS = [1, 1];

export class QuestSteps {
  private party: PartyState = { version: 1, rng: 1, sheets: {}, roadScenes: TREK_SCENES };
  private index = TREK_SCENES; // the tale's first scene
  private sceneCount = 0;
  private ended = false;

  fixedMap(planned: number): void {
    this.party = { ...this.party, quest: planQuest(42, LEVELS, planned, startDungeon('fixed', 42, LEVELS, planned)).quest };
  }

  tale(planned: number): void {
    this.party = { ...this.party, quest: planQuest(42, LEVELS, planned, null).quest };
    this.sceneCount = planned + TREK_SCENES;
  }

  playsTale(scenes: number): void {
    for (let i = 0; i < scenes && !this.ended; i++) {
      const next = this.index + 1;
      const ending = this.ending(next);
      this.ended = ending.isFinale;
      this.sceneCount = ending.sceneCount;
      this.index = next;
    }
  }

  reachesGoal(): void {
    this.party = { ...this.party, quest: { ...this.party.quest!, reached: true } };
  }

  hostCalls(): void {
    this.party = questClosed(this.party);
    this.sceneCount = Math.min(this.index + 2, this.sceneCount);
  }

  goalIn(room: string): void {
    assert.equal(this.party.quest!.at, room);
  }

  highFight(): void {
    assert.equal(fightBand(LEVELS, this.party.quest!.xp), 'high');
  }

  nextIsEpilogue(): void {
    assert.equal(this.ending(this.index + 1).isFinale, true);
  }

  stillGoing(): void {
    assert.equal(this.ended, false);
  }

  sceneOfAbout(scene: number, of: number): void {
    assert.deepEqual(sceneProgress(this.party, this.index, this.sceneCount), { part: 'tale', scene, of, about: true });
  }

  facesGoal(): void {
    const offered = [{ id: 'a' as const, label: 'Rest', detail: 'Camp.' }, { id: 'b' as const, label: 'Wander', detail: 'On.' }];
    assert.equal(towardTheGoal(offered, this.state(), this.index, this.sceneCount)[0].label, 'Face the goal');
  }

  private state() {
    return { party: this.party, combat: null, dungeon: null };
  }

  private ending(next: number) {
    return endingOf({ state: this.state(), fight: null }, next, this.sceneCount);
  }
}
