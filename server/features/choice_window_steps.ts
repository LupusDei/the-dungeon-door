/**
 * Step helpers for features/choice_window.feature. The window is a pure
 * reading of the scene: when it began, and whether the table is still choosing.
 */
import assert from 'node:assert/strict';
import { turnWindow, type TurnWindow } from '../lib/play/turn-clock.ts';
import type { GameStatus } from '../lib/types.ts';

export class ChoiceWindowSteps {
  private began = '';
  private now = new Date(0);
  private status: GameStatus = 'voting';
  private window: TurnWindow | null = null;

  sceneBegan(at: string): void {
    this.began = at;
  }

  clockReads(at: string): void {
    this.now = new Date(at);
  }

  tableIsChoosing(): void {
    this.status = 'voting';
    this.look();
  }

  tableIsResolving(): void {
    this.status = 'resolving';
    this.look();
  }

  deadlineIs(iso: string): void {
    assert.equal(this.window?.deadline, iso);
  }

  windowIs(seconds: number): void {
    assert.equal(this.window?.seconds, seconds);
  }

  viewCarries(iso: string): void {
    assert.equal(this.window?.now, iso);
  }

  noChoiceWindow(): void {
    assert.equal(this.window, null);
  }

  private look(): void {
    this.window = turnWindow(this.status, { createdAt: this.began, isFinale: false }, this.now);
  }
}
