import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import type { StoredCharacter, Choice, ChoiceId, Game, GamePlayer, GameStatus, Message, MessageKind, StoredScene, Vote } from '../types.ts';
import type { GameExpectation, GamePatch, NewGame, NewMessage, SceneDraftRecord, Store } from './types.ts';

type Row = Record<string, any>;

const iso = (value: unknown): string => new Date(value as string | Date).toISOString();

const GAME_COLUMNS: Record<keyof GamePatch, string> = {
  status: 'status',
  title: 'title',
  sceneIndex: 'scene_index',
  dungeonMaster: 'dungeon_master',
  sceneCount: 'scene_count',
  hostId: 'host_id',
  party: 'party',
  combat: 'combat',
  dungeon: 'dungeon',
};
const JSON_FIELDS = new Set<keyof GamePatch>(['party', 'combat', 'dungeon']);
const encode = (key: keyof GamePatch, value: unknown) => (JSON_FIELDS.has(key) && value !== null ? JSON.stringify(value) : value);

/** The compare-and-set UPDATE: `patch` where the game matches `expect`. */
export function gameUpdate(code: string, expect: GameExpectation, patch: GamePatch): { text: string; params: unknown[] } {
  const params: unknown[] = [code];
  const add = (value: unknown) => `$${params.push(value)}`;
  const sets = ['updated_at = now()'];
  for (const [key, value] of Object.entries(patch) as [keyof GamePatch, unknown][]) {
    if (value !== undefined) sets.push(`${GAME_COLUMNS[key]} = ${add(encode(key, value))}`);
  }
  const where = ['code = $1'];
  if (expect.status !== undefined) where.push(`status = ${add(expect.status)}`);
  if (expect.sceneIndex !== undefined) where.push(`scene_index = ${add(expect.sceneIndex)}`);
  return { text: `UPDATE games SET ${sets.join(', ')} WHERE ${where.join(' AND ')} RETURNING code`, params };
}

/** A games row as a Game. Rows from before the rules engine have no rules columns: they read as null. */
export function gameRow(row: Row, players: GamePlayer[], scenes: StoredScene[]): Game {
  const { party = null, combat = null, dungeon = null } = row;
  return {
    code: row.code,
    hostId: row.host_id,
    status: row.status as GameStatus,
    dungeonMaster: row.dungeon_master,
    title: row.title,
    sceneCount: row.scene_count,
    sceneIndex: row.scene_index,
    players,
    scenes,
    party,
    combat,
    dungeon,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

/**
 * Postgres store over Neon's HTTP driver (one round trip per statement, no pooled connections, which
 * suits short-lived functions). Each method is a single SQL statement, so it is atomic; status changes
 * are compare-and-set UPDATEs (`… WHERE status = $n AND scene_index = $m`).
 */
export class PostgresStore implements Store {
  private sql: NeonQueryFunction<false, false>;

  constructor(databaseUrl: string) {
    this.sql = neon(databaseUrl);
  }

  private q(text: string, params: unknown[] = []): Promise<Row[]> {
    return this.sql.query(text, params) as Promise<Row[]>;
  }

  // ---- characters ----

  async getCharacter(id: string) {
    const [row] = await this.q('SELECT data FROM characters WHERE id = $1', [id]);
    return row ? (row.data as StoredCharacter) : null;
  }

  async saveCharacter(character: StoredCharacter) {
    await this.q(
      `INSERT INTO characters (id, owner_id, data, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET owner_id = EXCLUDED.owner_id, data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
      [character.id, character.ownerId, JSON.stringify(character), character.createdAt, character.updatedAt],
    );
    return character;
  }

  async listCharacters(ownerId: string) {
    const rows = await this.q('SELECT data FROM characters WHERE owner_id = $1 ORDER BY created_at DESC', [ownerId]);
    return rows.map((r) => r.data as StoredCharacter);
  }

  async deleteCharacter(id: string) {
    await this.q('DELETE FROM characters WHERE id = $1', [id]);
  }

  // ---- games ----

  async createGame(game: NewGame) {
    // One statement: the game row and its host, or nothing when the code is taken.
    const rows = await this.q(
      `WITH g AS (
         INSERT INTO games (code, host_id, dungeon_master, scene_count) VALUES ($1, $2, $3, $4)
         ON CONFLICT (code) DO NOTHING RETURNING code
       )
       INSERT INTO game_players (game_code, player_id, character, joined_at)
       SELECT code, $5, $6, $7 FROM g RETURNING game_code`,
      [game.code, game.hostId, game.dungeonMaster, game.sceneCount, game.host.playerId, JSON.stringify(game.host.character), game.host.joinedAt],
    );
    return rows.length > 0;
  }

  async getGame(code: string): Promise<Game | null> {
    const [row] = await this.q(
      `SELECT g.*,
         COALESCE((SELECT json_agg(p ORDER BY p.joined_at) FROM game_players p WHERE p.game_code = g.code), '[]') AS players,
         COALESCE((SELECT json_agg(s ORDER BY s.idx) FROM scenes s WHERE s.game_code = g.code), '[]') AS scenes,
         COALESCE((SELECT json_agg(v ORDER BY v.created_at) FROM votes v WHERE v.game_code = g.code), '[]') AS votes
       FROM games g WHERE g.code = $1`,
      [code],
    );
    if (!row) return null;
    const votes = (row.votes as Row[]).map((v) => ({ sceneIdx: v.scene_idx as number, vote: { playerId: v.player_id, choiceId: v.choice_id, roll: v.roll } as Vote }));
    const players = (row.players as Row[]).map((p): GamePlayer => ({ playerId: p.player_id, character: p.character as StoredCharacter, joinedAt: iso(p.joined_at) }));
    const scenes = (row.scenes as Row[]).map((s): StoredScene => ({
      index: s.idx,
      title: s.title,
      narration: s.narration,
      imagePrompt: s.image_prompt,
      imageUrl: s.image_url,
      choices: s.choices as Choice[],
      isFinale: s.is_finale,
      votes: votes.filter((v) => v.sceneIdx === s.idx).map((v) => v.vote),
      outcome: s.outcome,
      chosenChoiceId: s.chosen_choice_id as ChoiceId | null,
      createdAt: iso(s.created_at),
    }));
    return gameRow(row, players, scenes);
  }

  async updateGame(code: string, expect: GameExpectation, patch: GamePatch) {
    const { text, params } = gameUpdate(code, expect, patch);
    return (await this.q(text, params)).length > 0;
  }

  async upsertPlayer(code: string, player: GamePlayer, maxPlayers: number) {
    const rows = await this.q(
      `WITH ok AS (
         SELECT g.code FROM games g
         WHERE g.code = $1 AND g.status = 'lobby'
           AND (EXISTS (SELECT 1 FROM game_players WHERE game_code = $1 AND player_id = $2)
                OR (SELECT count(*) FROM game_players WHERE game_code = $1) < $5)
       ), up AS (
         INSERT INTO game_players (game_code, player_id, character, joined_at)
         SELECT code, $2, $3, $4 FROM ok
         ON CONFLICT (game_code, player_id) DO UPDATE SET character = EXCLUDED.character
         RETURNING game_code
       )
       UPDATE games SET updated_at = now() WHERE code IN (SELECT game_code FROM up) RETURNING code`,
      [code, player.playerId, JSON.stringify(player.character), player.joinedAt, maxPlayers],
    );
    return rows.length > 0;
  }

  async removePlayer(code: string, playerId: string) {
    const rows = await this.q(
      `WITH d AS (DELETE FROM game_players WHERE game_code = $1 AND player_id = $2 RETURNING game_code)
       UPDATE games SET updated_at = now() WHERE code IN (SELECT game_code FROM d) RETURNING code`,
      [code, playerId],
    );
    return rows.length > 0;
  }

  // ---- scenes and votes ----

  async saveScene(code: string, scene: SceneDraftRecord) {
    await this.q(
      `WITH s AS (
         INSERT INTO scenes (game_code, idx, title, narration, image_prompt, image_url, choices, is_finale)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (game_code, idx) DO UPDATE SET title = EXCLUDED.title, narration = EXCLUDED.narration,
           image_prompt = EXCLUDED.image_prompt, image_url = EXCLUDED.image_url, choices = EXCLUDED.choices,
           is_finale = EXCLUDED.is_finale
         RETURNING game_code
       )
       UPDATE games SET updated_at = now() WHERE code IN (SELECT game_code FROM s)`,
      [code, scene.index, scene.title, scene.narration, scene.imagePrompt, scene.imageUrl, JSON.stringify(scene.choices), scene.isFinale],
    );
  }

  async setSceneImage(code: string, index: number, imageUrl: string) {
    await this.q(
      `WITH s AS (UPDATE scenes SET image_url = $3 WHERE game_code = $1 AND idx = $2 RETURNING game_code)
       UPDATE games SET updated_at = now() WHERE code IN (SELECT game_code FROM s)`,
      [code, index, imageUrl],
    );
  }

  async setSceneOutcome(code: string, index: number, outcome: string, chosenChoiceId: ChoiceId | null) {
    await this.q(
      `WITH s AS (UPDATE scenes SET outcome = $3, chosen_choice_id = $4 WHERE game_code = $1 AND idx = $2 RETURNING game_code)
       UPDATE games SET updated_at = now() WHERE code IN (SELECT game_code FROM s)`,
      [code, index, outcome, chosenChoiceId],
    );
  }

  async castVote(code: string, index: number, playerId: string, choiceId: ChoiceId, roll: number) {
    // Only while the game is voting on this scene; a changed vote keeps its first roll. FOR SHARE waits
    // for a concurrent resolve (voting → resolving) to commit and then sees it, so no vote sneaks in late.
    // (It deliberately doesn't touch games.updated_at: two votes updating the row they share-lock would deadlock.)
    const rows = await this.q(
      `WITH ok AS (SELECT code FROM games WHERE code = $1 AND status = 'voting' AND scene_index = $2 FOR SHARE)
       INSERT INTO votes (game_code, scene_idx, player_id, choice_id, roll)
       SELECT code, $2, $3, $4, $5 FROM ok
       ON CONFLICT (game_code, scene_idx, player_id) DO UPDATE SET choice_id = EXCLUDED.choice_id
       RETURNING player_id, choice_id, roll`,
      [code, index, playerId, choiceId, roll],
    );
    const [row] = rows;
    return row ? { playerId: row.player_id, choiceId: row.choice_id as ChoiceId, roll: row.roll as number } : null;
  }

  // ---- chat ----

  async addMessage(code: string, message: NewMessage): Promise<Message> {
    // The UPDATE takes the game row's lock, so concurrent messages get distinct, increasing ids.
    const [row] = await this.q(
      `WITH s AS (UPDATE games SET message_seq = message_seq + 1, updated_at = now() WHERE code = $1 RETURNING message_seq)
       INSERT INTO messages (game_code, id, kind, player_id, character_name, text)
       SELECT $1, message_seq, $2, $3, $4, $5 FROM s
       RETURNING id, kind, player_id, character_name, text, created_at`,
      [code, message.kind, message.playerId, message.characterName, message.text],
    );
    if (!row) throw new Error(`no game ${code}`);
    return toMessage(row);
  }

  async listMessages(code: string, since?: number, limit = 200) {
    const rows = await this.q(
      `SELECT * FROM (
         SELECT id, kind, player_id, character_name, text, created_at FROM messages
         WHERE game_code = $1 AND id > $2 ORDER BY id DESC LIMIT $3
       ) m ORDER BY id`,
      [code, since ?? 0, limit],
    );
    return rows.map(toMessage);
  }
}

function toMessage(row: Row): Message {
  return {
    id: row.id,
    kind: row.kind as MessageKind,
    playerId: row.player_id,
    characterName: row.character_name,
    text: row.text,
    createdAt: iso(row.created_at),
  };
}
