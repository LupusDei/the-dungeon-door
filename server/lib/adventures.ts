import { getStore } from './store/index.ts';
import type { Game, GameStatus } from './types.ts';

/**
 * A player's past adventures, for a hero's page: what each one was, the pictures painted along the
 * way, and how it came out for the hero. The story itself (every scene and its outcome) is the game,
 * which the app reads with `GET /api/games/{code}` as before; this is the list to choose from.
 */
export interface AdventureView {
  code: string;
  /** The dungeon master's name for the adventure. Null only for a game from before titles. */
  title: string | null;
  status: GameStatus;
  /** True once the epilogue has been told. False for an adventure still going, or left unfinished. */
  ended: boolean;
  dungeonMaster: string;
  startedAt: string;
  lastPlayedAt: string;
  /** The caller's hero in that game, as they were when they joined it. */
  hero: { characterId: string; name: string; portraitUrl: string | null };
  /** The other heroes' names, in the order they joined. */
  party: string[];
  /** Scenes told so far, the epilogue included. */
  scenes: number;
  /** The scene pictures in order, painted ones only. A fight's rounds share one picture, listed once. */
  images: string[];
  /** The epilogue, once the adventure has ended. */
  ending: string | null;
  /** How it came out for the caller's hero; null for a game from before the rules engine. */
  result: null | {
    /** Their level as the adventure stands (or stood, at its end). */
    level: number;
    levelsGained: number;
    xpGained: number;
    /** True when the caller's hero died on it. */
    fell: boolean;
    /** Every hero who died on it, the caller's included. */
    fallen: string[];
  };
}

/** How many of a player's games are looked at: the most recently played. */
const NEWEST = 40;

/** The adventure as its list entry, or null for a door that never opened or a game the player has no seat in. */
export function adventureOf(game: Game, playerId: string): AdventureView | null {
  const me = game.players.find((p) => p.playerId === playerId);
  if (!me || game.scenes.length === 0) return null;
  const images: string[] = [];
  for (const scene of game.scenes) {
    if (scene.imageUrl && images[images.length - 1] !== scene.imageUrl) images.push(scene.imageUrl);
  }
  const ended = game.status === 'ended';
  const sheets = game.party?.sheets ?? null;
  const now = sheets?.[playerId];
  const then = me.character.sheet ?? null;
  return {
    code: game.code,
    title: game.title,
    status: game.status,
    ended,
    dungeonMaster: game.dungeonMaster,
    startedAt: game.scenes[0].createdAt,
    // When the story last moved on, not when the game was last touched: reading an old adventure
    // (which records the reader's app version on their seat) must not move it up the list.
    lastPlayedAt: game.scenes[game.scenes.length - 1].createdAt,
    hero: { characterId: me.character.id, name: me.character.name, portraitUrl: me.character.portraitUrl ?? null },
    party: game.players.filter((p) => p.playerId !== playerId).map((p) => p.character.name),
    scenes: game.scenes.filter((s) => s.outcome !== null || s.isFinale).length,
    images,
    ending: ended ? game.scenes.find((s) => s.isFinale)?.narration ?? null : null,
    result: sheets && now
      ? {
          level: now.level,
          levelsGained: Math.max(0, now.level - (then?.level ?? now.level)),
          xpGained: Math.max(0, now.xp - (then?.xp ?? now.xp)),
          fell: now.dead === true,
          fallen: game.players.filter((p) => sheets[p.playerId]?.dead === true).map((p) => p.character.name),
        }
      : null,
  };
}

/**
 * The player's adventures, most recently played first: every game they still have a seat in whose
 * door has opened. `characterId` keeps only the ones that hero went on. A player who left a game
 * gave up their seat, so it is not among them.
 */
export async function adventuresOf(playerId: string, characterId?: string | null): Promise<AdventureView[]> {
  const store = getStore();
  const codes = await store.listGameCodes(playerId, NEWEST);
  const games = await Promise.all(codes.map((code) => store.getGame(code)));
  return games
    .flatMap((game) => {
      const view = game ? adventureOf(game, playerId) : null;
      return view && (!characterId || view.hero.characterId === characterId) ? [view] : [];
    })
    .sort((a, b) => b.lastPlayedAt.localeCompare(a.lastPlayedAt));
}
