/**
 * Where a scene falls in the adventure. The road from the tavern (play/trek.ts) is counted apart from the tale,
 * the dungeon's or the one told: its stretches, and any fight on it, never use up the tale's scenes.
 */
import { hasNoSetLength } from '../length.ts';
import type { PartyState } from './state.ts';

export type SceneProgress =
  /** A stretch of the road, and how many scenes of the tale follow it (null with no set length). */
  | { part: 'road'; scene: number; of: number; tale: number | null }
  /** A scene of the tale, the epilogue its last (of null with no set length). */
  | { part: 'tale'; scene: number; of: number | null };

/** The scene at `index` of a game of `sceneCount` scenes, its road and all. */
export function sceneProgress(party: Pick<PartyState, 'trek' | 'roadScenes'> | null, index: number, sceneCount: number): SceneProgress {
  const trek = party?.trek;
  const count = (n: number) => (hasNoSetLength(sceneCount) ? null : n);
  if (trek && index !== sceneCount - 1) {
    const roadLeft = trek.legs.length - trek.leg;
    return { part: 'road', scene: trek.leg + 1, of: trek.legs.length, tale: count(Math.max(1, sceneCount - index - roadLeft)) }; // the epilogue at least
  }
  const road = trek ? index : (party?.roadScenes ?? 0); // a party lost on the road goes straight to its epilogue
  return { part: 'tale', scene: index - road + 1, of: count(sceneCount - road) };
}

/** The party as it steps off the road: the tale begins at scene `next`. */
export function markRoadEnd(before: PartyState, after: PartyState, next: number): PartyState {
  return before.trek && !after.trek ? { ...after, roadScenes: next } : after;
}
