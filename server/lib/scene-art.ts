import { nameOf } from './catalog.ts';
import type { Game, GamePlayer } from './types.ts';

/**
 * Who is painted into a scene's picture, and what the painter is told about them.
 *
 * The whole party is in every picture. The dungeon master names the heroes nearest the viewer
 * (`featuredCharacters`); that used to decide who was painted at all, and no more than four ever were,
 * so in a party of six most pictures were missing people. Now it only orders them: everyone alive is
 * painted, the named ones first. The dead are left out: a hero who fell is not standing with the rest.
 */

/** As many portraits as the image model takes as references (lib/ai.ts renderImage), and the largest party. */
export const MOST_PAINTED = 6;

/** The heroes to paint, nearest the viewer first. */
export function castOf(game: Pick<Game, 'players' | 'party'>, featured: readonly string[] = []): GamePlayer[] {
  const named = new Set(featured.map((name) => name.trim().toLowerCase()));
  const alive = game.players.filter((p) => game.party?.sheets[p.playerId]?.dead !== true);
  // A party that has all fallen still has a picture to be in (the epilogue): paint them as they were.
  const present = alive.length ? alive : game.players;
  const front = present.filter((p) => named.has(p.character.name.toLowerCase()));
  const behind = present.filter((p) => !named.has(p.character.name.toLowerCase()));
  return [...front, ...behind].slice(0, MOST_PAINTED);
}

/** What a hero looks like, in words: the forge's description of them, or their species and class. */
export const lookOf = ({ character: c }: GamePlayer): string =>
  c.appearance || c.description || `a ${nameOf('race', c.race)} ${nameOf('characterClass', c.characterClass)}`;

/**
 * The cast as the painter reads it. `portrait[i]` says whether hero i has a reference portrait attached
 * (their numbers count only the attached ones, in order).
 */
export function castBrief(cast: readonly GamePlayer[], portrait: readonly boolean[]): string {
  let attached = 0;
  const lines = cast.map((p, i) => `- ${p.character.name}${portrait[i] ? ` (reference portrait ${++attached})` : ''}: ${lookOf(p)}`);
  const count = cast.length;
  const everyone = count === 1
    ? 'One hero is in this picture and must be clearly visible:'
    : `All ${count} of these heroes are in this picture. Paint every one of them, each a separate figure who can be told ` +
      `apart from the others, with none left out, hidden or merged. Those listed first are nearest the viewer:`;
  return `${everyone}\n${lines.join('\n')}`;
}
