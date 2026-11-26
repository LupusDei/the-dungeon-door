import type { StoredCharacter, ChoiceId, Game, GamePlayer, Message, StoredScene, Vote } from '../types.ts';
import type { GameExpectation, GamePatch, NewGame, NewMessage, SceneDraftRecord, Store } from './types.ts';

interface GameData {
  game: Game;
  messages: Message[];
}

const now = () => new Date().toISOString();
/** Yield to the event loop first so concurrent callers interleave the way they would against a database. */
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * In-process store for local dev and tests. Each method yields once, then reads and writes
 * synchronously, so it is atomic just like the single SQL statements in the Postgres store.
 */
export class MemoryStore implements Store {
  private characters = new Map<string, StoredCharacter>();
  private games = new Map<string, GameData>();
  /** When each reading was claimed, by "CODE#index#voice". */
  private voiceClaims = new Map<string, number>();

  async getCharacter(id: string) {
    await tick();
    const c = this.characters.get(id);
    return c ? structuredClone(c) : null;
  }

  async saveCharacter(character: StoredCharacter) {
    await tick();
    this.characters.set(character.id, structuredClone(character));
    return structuredClone(character);
  }

  async listCharacters(ownerId: string) {
    await tick();
    return [...this.characters.values()]
      .filter((c) => c.ownerId === ownerId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((c) => structuredClone(c));
  }

  async deleteCharacter(id: string) {
    await tick();
    this.characters.delete(id);
  }

  async createGame(game: NewGame) {
    await tick();
    if (this.games.has(game.code)) return false;
    const t = now();
    this.games.set(game.code, {
      game: {
        code: game.code,
        hostId: game.hostId,
        status: 'lobby',
        dungeonMaster: game.dungeonMaster,
        title: null,
        sceneCount: game.sceneCount,
        sceneIndex: -1,
        players: [structuredClone(game.host)],
        scenes: [],
        party: null,
        combat: null,
        dungeon: null,
        createdAt: t,
        updatedAt: t,
      },
      messages: [],
    });
    return true;
  }

  async getGame(code: string) {
    await tick();
    const data = this.games.get(code);
    return data ? structuredClone(data.game) : null;
  }

  async updateGame(code: string, expect: GameExpectation, patch: GamePatch) {
    await tick();
    const game = this.games.get(code)?.game;
    if (!game) return false;
    if (expect.status !== undefined && game.status !== expect.status) return false;
    if (expect.sceneIndex !== undefined && game.sceneIndex !== expect.sceneIndex) return false;
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) (game as unknown as Record<string, unknown>)[key] = structuredClone(value);
    }
    game.updatedAt = now();
    return true;
  }

  async upsertPlayer(code: string, player: GamePlayer, maxPlayers: number) {
    await tick();
    const game = this.games.get(code)?.game;
    if (!game || game.status !== 'lobby') return false;
    const existing = game.players.find((p) => p.playerId === player.playerId);
    if (existing) {
      existing.character = structuredClone(player.character);
    } else {
      if (game.players.length >= maxPlayers) return false;
      game.players.push(structuredClone(player));
    }
    game.updatedAt = now();
    return true;
  }

  async removePlayer(code: string, playerId: string) {
    await tick();
    const game = this.games.get(code)?.game;
    if (!game) return false;
    const before = game.players.length;
    game.players = game.players.filter((p) => p.playerId !== playerId);
    game.updatedAt = now();
    return game.players.length < before;
  }

  async saveScene(code: string, scene: SceneDraftRecord) {
    await tick();
    const game = this.games.get(code)?.game;
    if (!game) return;
    const existing = game.scenes.find((s) => s.index === scene.index);
    if (existing) {
      if (existing.narration !== scene.narration) this.forgetVoices(code, existing); // new words need new readings
      Object.assign(existing, structuredClone(scene));
    } else {
      game.scenes.push({ ...structuredClone(scene), voices: {}, votes: [], outcome: null, chosenChoiceId: null, createdAt: now() });
      game.scenes.sort((a, b) => a.index - b.index);
    }
    game.updatedAt = now();
  }

  async setSceneImage(code: string, index: number, imageUrl: string) {
    await tick();
    const game = this.games.get(code)?.game;
    const scene = game?.scenes.find((s) => s.index === index);
    if (!game || !scene) return;
    scene.imageUrl = imageUrl;
    game.updatedAt = now();
  }

  async claimSceneVoice(code: string, index: number, voice: string, staleMs: number) {
    await tick();
    const scene = this.games.get(code)?.game.scenes.find((s) => s.index === index);
    if (!scene || scene.voices[voice]) return false;
    const key = `${code}#${index}#${voice}`;
    const claimed = this.voiceClaims.get(key);
    if (claimed !== undefined && Date.now() - claimed < staleMs) return false;
    this.voiceClaims.set(key, Date.now());
    return true;
  }

  async setSceneVoice(code: string, index: number, voice: string, voiceUrl: string | null) {
    await tick();
    const game = this.games.get(code)?.game;
    const scene = game?.scenes.find((s) => s.index === index);
    if (!game || !scene) return;
    this.voiceClaims.delete(`${code}#${index}#${voice}`);
    if (voiceUrl === null) delete scene.voices[voice];
    else scene.voices[voice] = voiceUrl;
    game.updatedAt = now();
  }

  private forgetVoices(code: string, scene: StoredScene) {
    for (const key of [...this.voiceClaims.keys()]) if (key.startsWith(`${code}#${scene.index}#`)) this.voiceClaims.delete(key);
    scene.voices = {};
  }

  async setSceneOutcome(code: string, index: number, outcome: string, chosenChoiceId: ChoiceId | null) {
    await tick();
    const game = this.games.get(code)?.game;
    const scene = game?.scenes.find((s) => s.index === index);
    if (!game || !scene) return;
    scene.outcome = outcome;
    scene.chosenChoiceId = chosenChoiceId;
    game.updatedAt = now();
  }

  async castVote(code: string, index: number, playerId: string, choiceId: ChoiceId, roll: number) {
    await tick();
    const game = this.games.get(code)?.game;
    if (!game || game.status !== 'voting' || game.sceneIndex !== index) return null;
    const scene = game.scenes.find((s) => s.index === index);
    if (!scene) return null;
    let vote: Vote | undefined = scene.votes.find((v) => v.playerId === playerId);
    if (vote) vote.choiceId = choiceId;
    else scene.votes.push((vote = { playerId, choiceId, roll }));
    game.updatedAt = now();
    return { ...vote };
  }

  async addMessage(code: string, message: NewMessage) {
    await tick();
    const data = this.games.get(code);
    if (!data) throw new Error(`no game ${code}`);
    const last = data.messages.at(-1)?.id ?? 0;
    const stored: Message = { id: last + 1, ...message, createdAt: now() };
    data.messages.push(stored);
    data.game.updatedAt = stored.createdAt;
    return { ...stored };
  }

  async listMessages(code: string, since?: number, limit = 200) {
    await tick();
    const messages = this.games.get(code)?.messages ?? [];
    return messages.filter((m) => since === undefined || m.id > since).slice(-limit).map((m) => ({ ...m }));
  }
}
