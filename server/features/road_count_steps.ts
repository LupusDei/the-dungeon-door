/**
 * Step helpers for features/road_count.feature. A game's scenes, walked through the pure rules that count
 * them: the road's stretches (play/trek.ts), where the road ends (play/progress.ts) and what the DM is told
 * (dm/pacing.ts). Each fight round adds a scene, as play/table.ts sceneCountAfter does.
 */
import assert from 'node:assert/strict';
import { sceneLabel } from '../lib/dm/pacing.ts';
import { NO_SET_LENGTH } from '../lib/length.ts';
import { markRoadEnd, sceneProgress } from '../lib/play/progress.ts';
import type { PartyState } from '../lib/play/state.ts';
import { planTrek, TREK_SCENES } from '../lib/play/trek.ts';

export class RoadCountSteps {
  private party: PartyState = { version: 1, rng: 1, sheets: {}, trek: planTrek(7, [1, 1], 1, 'tale') };
  private index = 0;
  private sceneCount = 0;

  gameStarted(asked: number): void {
    this.sceneCount = asked + TREK_SCENES;
  }

  openGameStarted(): void {
    this.sceneCount = NO_SET_LENGTH;
  }

  walkOn(): void {
    const trek = this.party.trek!;
    const { trek: _, ...off } = this.party;
    const after = trek.leg + 1 < trek.legs.length ? { ...this.party, trek: { ...trek, leg: trek.leg + 1 } } : off;
    this.party = markRoadEnd(this.party, after, ++this.index);
  }

  fightRounds(rounds: number): void {
    this.index += rounds;
    this.sceneCount += rounds;
  }

  playScene(): void {
    this.index++;
  }

  gameHas(scenes: number): void {
    assert.equal(this.sceneCount, scenes);
  }

  onTheRoad(stretch: number, of: number, tale: number): void {
    assert.deepEqual(this.progress(), { part: 'road', scene: stretch, of, tale });
  }

  onTheRoadOpen(stretch: number, of: number): void {
    assert.deepEqual(this.progress(), { part: 'road', scene: stretch, of, tale: null });
  }

  inTheTale(scene: number, of: number): void {
    assert.deepEqual(this.progress(), { part: 'tale', scene, of });
  }

  inAnOpenTale(scene: number): void {
    assert.deepEqual(this.progress(), { part: 'tale', scene, of: null });
  }

  dmIsTold(label: string): void {
    assert.equal(sceneLabel({ sceneIndex: this.index, sceneCount: this.sceneCount, progress: this.progress() }), label);
  }

  private progress() {
    return sceneProgress(this.party, this.index, this.sceneCount);
  }

}
