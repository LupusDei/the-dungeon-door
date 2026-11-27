/** How the DM is told where a scene falls: the road from the tavern is counted apart from the tale (play/progress.ts). */
import type { SceneProgress } from '../play/progress.ts';
import type { DMContext } from './types.ts';

type Pace = Pick<DMContext, 'sceneIndex' | 'sceneCount' | 'progress' | 'openEnded'>;

/** A game told nothing of the road counts every scene as the tale's. */
const progressOf = ({ sceneIndex, sceneCount, progress, openEnded }: Pace): SceneProgress =>
  progress ?? { part: 'tale', scene: sceneIndex + 1, of: openEnded ? null : sceneCount };

type Road = Extract<SceneProgress, { part: 'road' }>;
type Tale = Extract<SceneProgress, { part: 'tale' }>;

/** Says where the scene falls, one way for the road and one for the tale. */
function told<T>(ctx: Pace, road: (p: Road) => T, tale: (p: Tale) => T): T {
  const p = progressOf(ctx);
  return p.part === 'road' ? road(p) : tale(p);
}

/** "scene 2 of 4", or the stretch of road the scene is. */
export const sceneLabel = (ctx: Pace): string =>
  told(ctx, (p) => `stretch ${p.scene} of ${p.of} of the road from the tavern; ${p.tale === null ? 'the tale follows, with no set length' : `the tale’s ${p.tale} scenes follow`}`,
    (p) => (p.of === null ? `scene ${p.scene}; the adventure has no set length, so the story goes on` : `scene ${p.scene} of ${p.about ? `about ${p.of}${p.scene >= p.of ? PAST_THE_PLAN : ''}` : p.of}`));

/** Past the tale's planned scenes, the quest still open (play/quest.ts). */
const PAST_THE_PLAN = ', past the plan: steer the party to the quest’s goal';

const SCENES = 'an opening, middle scenes, and a final epilogue scene.';
const NO_SET_LENGTH = 'The adventure has no set number of scenes: an opening, then as many scenes as the table plays, until they call the ending, and then a final epilogue scene.';

/** How long the adventure is, for HOW THE GAME WORKS. */
export const adventureLength = (ctx: Pace): string =>
  told(ctx, (p) => (p.tale === null ? NO_SET_LENGTH : `The adventure opens on the road from the tavern (a scene for each stretch of it); then the tale has ${p.tale} scenes: ${SCENES}`),
    (p) => (p.of === null ? NO_SET_LENGTH : `${ctx.sceneCount > p.of ? 'After the road from the tavern, the tale' : 'The adventure'} has ${p.about ? 'about ' : ''}${p.of} scenes: ${SCENES}${p.about ? ' It goes on past them until the quest’s goal is reached.' : ''}`));

/** The tale's last scene before the epilogue. */
export const isClimax = (ctx: Pace): boolean => told(ctx, () => false, (p) => p.of !== null && p.scene === p.of - 1);

/** A scene's heading when the DM gives none: "On the road", or the tale's scene number. */
export const sceneHeading = (ctx: Pace): string => told(ctx, () => 'On the road', (p) => `Scene ${p.scene}`);
