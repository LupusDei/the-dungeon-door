/**
 * What the push service keeps: each player's devices, and each player's push state (when they were last
 * pushed, how many pushes they have not answered, what is waiting to go). Postgres when DATABASE_URL is
 * set, else in memory, like the game store. The rules are in throttle.ts; this only stores.
 */
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import type { Device, PushEnvironment } from './apns.ts';
import { EMPTY, type PushState } from './throttle.ts';

export interface Versioned { state: PushState; version: number }

export interface PushStore {
  /** Registers a device token for the player; a token belongs to the last player to register it. */
  saveDevice(playerId: string, token: string, environment: PushEnvironment): Promise<void>;
  removeDevice(token: string): Promise<void>;
  listDevices(playerId: string): Promise<Device[]>;
  /** The player's push state (empty for a player never pushed), with its version. */
  getState(playerId: string): Promise<Versioned>;
  /** As getState, but null unless something is unanswered or waiting: the cheap look a visit makes. */
  getDirtyState(playerId: string): Promise<Versioned | null>;
  /** Compare-and-set: writes `next` if the version is still `version`. */
  putState(playerId: string, version: number, next: PushState): Promise<boolean>;
  /** Which of these players have a push waiting. */
  waitingAmong(playerIds: readonly string[]): Promise<string[]>;
}

export class MemoryPushStore implements PushStore {
  private devices = new Map<string, { playerId: string; environment: PushEnvironment }>();
  private states = new Map<string, Versioned>();

  async saveDevice(playerId: string, token: string, environment: PushEnvironment) {
    this.devices.set(token, { playerId, environment });
  }

  async removeDevice(token: string) {
    this.devices.delete(token);
  }

  async listDevices(playerId: string) {
    return [...this.devices].filter(([, d]) => d.playerId === playerId).map(([token, d]) => ({ token, environment: d.environment }));
  }

  async getState(playerId: string) {
    return structuredClone(this.states.get(playerId) ?? { state: EMPTY, version: 0 });
  }

  async getDirtyState(playerId: string) {
    const held = await this.getState(playerId);
    return held.state.unanswered > 0 || held.state.pending.length > 0 ? held : null;
  }

  async putState(playerId: string, version: number, next: PushState) {
    if ((this.states.get(playerId)?.version ?? 0) !== version) return false;
    this.states.set(playerId, { state: structuredClone(next), version: version + 1 });
    return true;
  }

  async waitingAmong(playerIds: readonly string[]) {
    return playerIds.filter((id) => (this.states.get(id)?.state.pending.length ?? 0) > 0);
  }
}

type Row = Record<string, any>;

export class PostgresPushStore implements PushStore {
  private sql: NeonQueryFunction<false, false>;

  constructor(databaseUrl: string) {
    this.sql = neon(databaseUrl);
  }

  private q(text: string, params: unknown[] = []): Promise<Row[]> {
    return this.sql.query(text, params) as Promise<Row[]>;
  }

  async saveDevice(playerId: string, token: string, environment: PushEnvironment) {
    await this.q(
      `INSERT INTO push_devices (token, player_id, environment) VALUES ($1, $2, $3)
       ON CONFLICT (token) DO UPDATE SET player_id = EXCLUDED.player_id, environment = EXCLUDED.environment, updated_at = now()`,
      [token, playerId, environment],
    );
  }

  async removeDevice(token: string) {
    await this.q('DELETE FROM push_devices WHERE token = $1', [token]);
  }

  async listDevices(playerId: string) {
    const rows = await this.q('SELECT token, environment FROM push_devices WHERE player_id = $1 ORDER BY updated_at DESC LIMIT 10', [playerId]);
    return rows.map((r): Device => ({ token: r.token, environment: r.environment }));
  }

  async getState(playerId: string) {
    const [row] = await this.q('SELECT state, version FROM push_state WHERE player_id = $1', [playerId]);
    return row ? { state: row.state as PushState, version: row.version as number } : { state: EMPTY, version: 0 };
  }

  async getDirtyState(playerId: string) {
    const [row] = await this.q('SELECT state, version FROM push_state WHERE player_id = $1 AND (unanswered > 0 OR waiting > 0)', [playerId]);
    return row ? { state: row.state as PushState, version: row.version as number } : null;
  }

  async putState(playerId: string, version: number, next: PushState) {
    // One statement: the first write inserts at version 1; later ones update only from the version read.
    const rows = await this.q(
      `INSERT INTO push_state (player_id, state, unanswered, waiting, version) VALUES ($1, $2, $3, $4, 1)
       ON CONFLICT (player_id) DO UPDATE SET state = EXCLUDED.state, unanswered = EXCLUDED.unanswered, waiting = EXCLUDED.waiting,
         version = push_state.version + 1, updated_at = now()
       WHERE push_state.version = $5
       RETURNING version`,
      [playerId, JSON.stringify(next), next.unanswered, next.pending.length, version],
    );
    // A first write that raced another insert updates nothing (the other row is at version 1, not 0).
    return rows.length > 0 && (version > 0 || rows[0].version === 1);
  }

  async waitingAmong(playerIds: readonly string[]) {
    if (playerIds.length === 0) return [];
    const rows = await this.q('SELECT player_id FROM push_state WHERE player_id = ANY($1) AND waiting > 0', [playerIds]);
    return rows.map((r) => r.player_id as string);
  }
}

const g = globalThis as typeof globalThis & { __ddPushStore?: PushStore };

export function getPushStore(): PushStore {
  if (!g.__ddPushStore) {
    const url = process.env.DATABASE_URL;
    g.__ddPushStore = url ? new PostgresPushStore(url) : new MemoryPushStore();
  }
  return g.__ddPushStore;
}

/** Tests: replace (or with no argument, reset) the push store. */
export function setPushStore(store?: PushStore): void {
  g.__ddPushStore = store;
}
