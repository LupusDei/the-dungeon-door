/**
 * Step helpers for features/player_voice.feature. Generated specs call these.
 * They exercise the narrator's guard and the words the narrator is given.
 */
import assert from 'node:assert/strict';
import { archetype } from '../lib/catalog.ts';
import { dmInstructions } from '../lib/dm/llm.ts';
import { PLAYER_VOICE, roleplayBlock, stripHeroSpeech, type HeroLine } from '../lib/dm/playerVoice.ts';
import type { DMContext } from '../lib/dm/types.ts';

export class PlayerVoiceSteps {
  private heroes: string[] = [];
  private lines: HeroLine[] = [];
  private narration = '';

  theHeroes(names: string): void {
    this.heroes = names.split(/\s+and\s+|,\s*/).map((name) => name.trim()).filter(Boolean);
  }

  heroSaid(name: string, line: string): void {
    this.lines.push({ name: name.trim(), text: line.trim() });
  }

  narratorWrites(prose: string): void {
    this.narration = stripHeroSpeech(prose.trim(), this.heroes, this.lines);
  }

  narrationOmits(fragment: string): void {
    assert.equal(this.narration.includes(fragment), false, this.narration);
  }

  narrationKeeps(fragment: string): void {
    assert.equal(this.narration.includes(fragment), true, this.narration);
  }

  promptForbidsHeroSpeech(): void {
    const ctx: DMContext = {
      archetype: archetype('chronicler'), adventureTitle: null, party: [], history: [], sceneIndex: 0, sceneCount: 4, recentChat: [], rules: null,
    };
    const text = dmInstructions(ctx);
    assert.ok(text.includes(PLAYER_VOICE.trim()));
    assert.match(text, /Never put words in a hero's mouth/);
    assert.match(text, /What do you say\?/);
  }

  handedToTheNarrator(): void {
    const block = roleplayBlock(this.lines.map((line) => ({ playerId: 'p', characterName: line.name, text: line.text })));
    for (const line of this.lines) {
      assert.ok(block.includes(line.name) && block.includes(line.text), block);
    }
    assert.match(block, /IN CHARACTER/);
  }
}
