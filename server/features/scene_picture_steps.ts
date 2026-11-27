/** Step helpers for scene_pictures.feature: who is painted into a scene's picture (lib/scene-art.ts). */
import assert from 'node:assert/strict';
import { castBrief, castOf } from '../lib/scene-art.ts';
import type { Game, GamePlayer } from '../lib/types.ts';

const listed = (names: string): string[] =>
  names.split(/\s*,\s*|\s+and\s+/).map((name) => name.trim()).filter(Boolean);

export class ScenePictureSteps {
  private party: string[] = [];
  private featured: string[] = [];
  private dead = new Set<string>();
  private cast: string[] = [];
  private brief = '';

  partyToPaint(party: string): void {
    this.party = listed(party);
  }

  dungeonMasterFeatures(names: string): void {
    this.featured = listed(names);
  }

  diedOnTheWay(hero: string): void {
    this.dead.add(hero);
  }

  sceneIsPainted(): void {
    const players = this.party.map((name): GamePlayer => ({
      playerId: `player-${name}`,
      joinedAt: '2026-11-26T00:00:00.000Z',
      character: { id: `hero-${name}`, name, race: 'human', characterClass: 'fighter', description: `${name}, in a travelling cloak`, appearance: null, portraitUrl: null } as GamePlayer['character'],
    }));
    const sheets = Object.fromEntries(players.map((p) => [p.playerId, { dead: this.dead.has(p.character.name) }]));
    const game = { players, party: { version: 1, rng: 1, sheets } } as unknown as Pick<Game, 'players' | 'party'>;
    const cast = castOf(game, this.featured);
    this.cast = cast.map((p) => p.character.name);
    this.brief = castBrief(cast, cast.map(() => false));
  }

  painterIsToldToPaint(count: number): void {
    assert.equal(this.cast.length, count, this.cast.join(', '));
    assert.match(this.brief, new RegExp(`^All ${count} of these heroes are in this picture\\. Paint every one of them`));
  }

  everyoneInThePictureIs(party: string): void {
    assert.deepEqual([...this.cast].sort(), listed(party).sort());
    for (const name of listed(party)) assert.ok(this.brief.includes(`- ${name}: `), `${name} is described to the painter`);
  }

  standsNearestTheViewer(hero: string): void {
    assert.equal(this.cast[0], hero, this.cast.join(', '));
  }

  isNotInThePicture(hero: string): void {
    assert.equal(this.cast.includes(hero), false, this.cast.join(', '));
    assert.equal(this.brief.includes(`- ${hero}: `), false);
  }
}
