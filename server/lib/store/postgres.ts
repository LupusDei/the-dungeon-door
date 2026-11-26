import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import type { StoredCharacter, Choice, ChoiceId, Game, GamePlayer, GameStatus, Mention, Message, MessageKind, MessageQuote, MessageVoice, Reaction, StoredScene, TypingNotice, Vote } from '../types.ts';
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
         COALESCE((SELECT json_agg(v ORDER BY v.created_at) FROM votes v WHERE v.game_code = g.code), '[]') AS votes,
         COALESCE((SELECT json_agg(r) FROM scene_voices r WHERE r.game_code = g.code AND r.url IS NOT NULL), '[]') AS voices
       FROM games g WHERE g.code = $1`,
      [code],
    );
    if (!row) return null;
    const votes = (row.votes as Row[]).map((v) => ({ sceneIdx: v.scene_idx as number, vote: { playerId: v.player_id, choiceId: v.choice_id, roll: v.roll } as Vote }));
    const players = (row.players as Row[]).map((p): GamePlayer => ({ playerId: p.player_id, character: p.character as StoredCharacter, joinedAt: iso(p.joined_at) }));
    const readings = (row.voices ?? []) as Row[];
    const scenes = (row.scenes as Row[]).map((s): StoredScene => ({
      index: s.idx,
      title: s.title,
      narration: s.narration,
      imagePrompt: s.image_prompt,
      imageUrl: s.image_url,
      voices: Object.fromEntries(readings.filter((r) => r.scene_idx === s.idx).map((r) => [r.voice, r.url])),
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
    // Rewriting a scene's words throws away the readings of the old ones.
    await this.q(
      `WITH old AS (SELECT narration FROM scenes WHERE game_code = $1 AND idx = $2),
       stale AS (
         DELETE FROM scene_voices WHERE game_code = $1 AND scene_idx = $2 AND EXISTS (SELECT 1 FROM old WHERE old.narration <> $4)
       ),
       s AS (
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

  async claimSceneVoice(code: string, index: number, voice: string, staleMs: number) {
    const rows = await this.q(
      `INSERT INTO scene_voices (game_code, scene_idx, voice, started_at)
       SELECT $1, $2, $3, now() WHERE EXISTS (SELECT 1 FROM scenes WHERE game_code = $1 AND idx = $2)
       ON CONFLICT (game_code, scene_idx, voice) DO UPDATE SET started_at = now()
         WHERE scene_voices.url IS NULL
           AND (scene_voices.started_at IS NULL OR scene_voices.started_at < now() - ($4 * interval '1 millisecond'))
       RETURNING voice`,
      [code, index, voice, staleMs],
    );
    return rows.length > 0;
  }

  async setSceneVoice(code: string, index: number, voice: string, voiceUrl: string | null) {
    await this.q(
      `WITH r AS (
         UPDATE scene_voices SET url = $4, started_at = NULL WHERE game_code = $1 AND scene_idx = $2 AND voice = $3 RETURNING game_code
       )
       UPDATE games SET updated_at = now() WHERE code IN (SELECT game_code FROM r)`,
      [code, index, voice, voiceUrl],
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
    // A reaction never touches message_seq: the id handed out here stays the line's id.
    const [row] = await this.q(
      `WITH s AS (UPDATE games SET message_seq = message_seq + 1, updated_at = now() WHERE code = $1 RETURNING message_seq)
       INSERT INTO messages (game_code, id, kind, player_id, character_name, text, voice, reply_to, reply, mentions)
       SELECT $1, message_seq, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb FROM s
       RETURNING id, kind, player_id, character_name, text, created_at, voice, reply_to, reply, mentions`,
      [
        code, message.kind, message.playerId, message.characterName, message.text,
        message.voice ?? null, message.replyTo ?? null,
        message.reply ? JSON.stringify(message.reply) : null,
        JSON.stringify(message.mentions ?? []),
      ],
    );
    if (!row) throw new Error(`no game ${code}`);
    return toMessage(row);
  }

  async getMessage(code: string, id: number): Promise<Message | null> {
    const [row] = await this.q(
      `SELECT ${MESSAGE_COLUMNS} FROM messages m WHERE m.game_code = $1 AND m.id = $2`,
      [code, id],
    );
    return row ? toMessage(row) : null;
  }

  async listMessages(code: string, since?: number, limit = 200) {
    const rows = await this.q(
      `SELECT * FROM (
         SELECT ${MESSAGE_COLUMNS} FROM messages m
         WHERE m.game_code = $1 AND m.id > $2 ORDER BY m.id DESC LIMIT $3
       ) m ORDER BY id`,
      [code, since ?? 0, limit],
    );
    return rows.map(toMessage);
  }

  async listUpdatedMessages(code: string, since: number, limit = 50) {
    const rows = await this.q(
      `SELECT * FROM (
         SELECT ${MESSAGE_COLUMNS} FROM messages m
         WHERE m.game_code = $1 AND m.id <= $2 AND m.revised_at IS NOT NULL
         ORDER BY m.id DESC LIMIT $3
       ) m ORDER BY id`,
      [code, since, limit],
    );
    return rows.map(toMessage);
  }

  async toggleReaction(code: string, messageId: number, playerId: string, emoji: string): Promise<Message | null> {
    // One statement. The INSERT decides from the snapshot at the start, which still shows a row the DELETE
    // removes, so the two never both happen. The message id is not touched; revised_at marks it for the poll.
    const [row] = await this.q(
      `WITH target AS (
         SELECT id, kind, player_id, character_name, text, created_at, voice, reply_to, reply, mentions
         FROM messages WHERE game_code = $1 AND id = $2
       ),
       existing AS (
         SELECT emoji, player_id, created_at FROM message_reactions
         WHERE game_code = $1 AND message_id = $2 ORDER BY created_at
       ),
       deleted AS (
         DELETE FROM message_reactions
         WHERE game_code = $1 AND message_id = $2 AND player_id = $3 AND emoji = $4
           AND EXISTS (SELECT 1 FROM target)
         RETURNING emoji
       ),
       inserted AS (
         INSERT INTO message_reactions (game_code, message_id, player_id, emoji)
         SELECT $1, $2, $3, $4
         WHERE EXISTS (SELECT 1 FROM target)
           AND NOT EXISTS (
             SELECT 1 FROM message_reactions
             WHERE game_code = $1 AND message_id = $2 AND player_id = $3 AND emoji = $4
           )
         RETURNING emoji
       ),
       touched AS (
         UPDATE messages SET revised_at = clock_timestamp()
         WHERE game_code = $1 AND id = $2 AND EXISTS (SELECT 1 FROM target)
         RETURNING id
       )
       SELECT (SELECT row_to_json(t) FROM target t) AS message,
              COALESCE((SELECT json_agg(json_build_object('emoji', emoji, 'playerId', player_id) ORDER BY created_at) FROM existing), '[]') AS before,
              EXISTS (SELECT 1 FROM deleted) AS removed,
              EXISTS (SELECT 1 FROM inserted) AS added,
              (SELECT count(*) FROM touched) AS revised
       `,
      [code, messageId, playerId, emoji],
    );
    if (!row) return null;
    const message = typeof row.message === 'string' ? JSON.parse(row.message) : row.message;
    if (!message) return null;
    const beforeRaw = typeof row.before === 'string' ? JSON.parse(row.before) : row.before;
    const before = (Array.isArray(beforeRaw) ? beforeRaw : []) as { emoji: string; playerId: string }[];
    const yes = (value: unknown) => value === true || value === 't';
    let marks = before;
    if (yes(row.removed)) marks = marks.filter((mark) => !(mark.emoji === emoji && mark.playerId === playerId));
    if (yes(row.added)) marks = [...marks, { emoji, playerId }];
    return toMessage({ ...message, reactions: grouped(marks) });
  }

  async setTyping(code: string, playerId: string, name: string, until: string): Promise<void> {
    await this.q(
      `INSERT INTO typing (game_code, player_id, name, until) VALUES ($1, $2, $3, $4)
       ON CONFLICT (game_code, player_id) DO UPDATE SET name = EXCLUDED.name, until = EXCLUDED.until`,
      [code, playerId, name, until],
    );
  }

  async listTyping(code: string, nowIso: string): Promise<TypingNotice[]> {
    const rows = await this.q(
      `SELECT player_id, name FROM typing WHERE game_code = $1 AND until > $2 ORDER BY name`,
      [code, nowIso],
    );
    return rows.map((row) => ({ playerId: row.player_id as string, name: row.name as string }));
  }
}

/** Columns of a message plus its reactions, grouped in the order each emoji was first used. */
const MESSAGE_COLUMNS = `
  m.id, m.kind, m.player_id, m.character_name, m.text, m.created_at, m.voice, m.reply_to, m.reply, m.mentions,
  COALESCE((
    SELECT jsonb_agg(jsonb_build_object('emoji', g.emoji, 'count', g.cnt, 'playerIds', g.player_ids) ORDER BY g.first_at)
    FROM (
      SELECT emoji, count(*)::int AS cnt, jsonb_agg(player_id ORDER BY created_at) AS player_ids, min(created_at) AS first_at
      FROM message_reactions r
      WHERE r.game_code = m.game_code AND r.message_id = m.id
      GROUP BY emoji
    ) g
  ), '[]'::jsonb) AS reactions
`;

function grouped(marks: { emoji: string; playerId: string }[]): Reaction[] {
  const order: string[] = [];
  const byEmoji = new Map<string, string[]>();
  for (const mark of marks) {
    const ids = byEmoji.get(mark.emoji);
    if (ids) ids.push(mark.playerId);
    else {
      order.push(mark.emoji);
      byEmoji.set(mark.emoji, [mark.playerId]);
    }
  }
  return order.map((emoji) => ({ emoji, count: byEmoji.get(emoji)!.length, playerIds: byEmoji.get(emoji)! }));
}

function asVoice(kind: MessageKind, value: unknown): MessageVoice | null {
  if (value === 'in' || value === 'out') return value;
  return kind === 'chat' ? 'in' : null;
}

function asQuote(value: unknown): MessageQuote | null {
  if (!value || typeof value !== 'object') return null;
  const quote = value as MessageQuote;
  if (typeof quote.id !== 'number' || typeof quote.text !== 'string') return null;
  return quote;
}

function asMentions(value: unknown): Mention[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const mention = item as Mention;
    if (typeof mention.playerId !== 'string' || (mention.target !== 'hero' && mention.target !== 'player')) return [];
    return [{ playerId: mention.playerId, name: String(mention.name ?? ''), target: mention.target }];
  });
}

function asReactions(value: unknown): Reaction[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const reaction = item as Reaction;
    const playerIds = Array.isArray(reaction.playerIds) ? reaction.playerIds.map(String) : [];
    if (typeof reaction.emoji !== 'string') return [];
    return [{ emoji: reaction.emoji, count: playerIds.length, playerIds }];
  });
}

function toMessage(row: Row): Message {
  const kind = row.kind as MessageKind;
  return {
    id: row.id,
    kind,
    playerId: row.player_id,
    characterName: row.character_name,
    text: row.text,
    createdAt: iso(row.created_at),
    voice: asVoice(kind, row.voice),
    replyTo: row.reply_to ?? null,
    reply: asQuote(row.reply),
    mentions: asMentions(row.mentions),
    reactions: asReactions(row.reactions),
  };
}
