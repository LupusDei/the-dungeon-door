/**
 * How long an adventure is: a set number of scenes, or none.
 *
 * A game with no set length keeps a scene count far past anything it will reach, so every rule that
 * asks "is the next scene the last?" answers no without knowing about it, and a fight's rounds can go
 * on adding to it as they do in any game. It ends when its host calls the ending (the count becomes a
 * real one: the scene being played is the last, then the epilogue) or when the party falls.
 */
export const NO_SET_LENGTH = 100_000;

/** The fewest and the most scenes a host can ask for (the road from the tavern is added to these). */
export const FEWEST_SCENES = 2;
export const MOST_SCENES = 8;

export const hasNoSetLength = (sceneCount: number): boolean => sceneCount >= NO_SET_LENGTH / 2;

/**
 * Scenes with choices still to come after scene `sceneIndex`, before the epilogue: 0 on the last scene
 * and on the epilogue itself. Null when the adventure has no set length, or has not begun.
 * A fight's rounds do not use these up: each round adds a scene to the count as it is made.
 */
export function scenesLeft(sceneCount: number, sceneIndex: number): number | null {
  if (sceneIndex < 0 || hasNoSetLength(sceneCount)) return null;
  return Math.max(0, sceneCount - 2 - sceneIndex);
}
