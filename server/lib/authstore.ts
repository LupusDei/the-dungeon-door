import { createHash, randomBytes } from 'node:crypto';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

/**
 * Short-lived records for signing in: OAuth clients, pending authorization requests, one-time
 * codes and access/refresh tokens. Everything here expires; tokens and codes are stored only as
 * hashes, so reading the table never yields a usable credential.
 */
export type AuthKind = 'client' | 'pending' | 'code' | 'access' | 'refresh' | 'state';

interface AuthStore {
  put(kind: AuthKind, id: string, data: Record<string, unknown>, ttlSeconds: number): Promise<void>;
  get<T>(kind: AuthKind, id: string): Promise<T | null>;
  /** Reads and deletes in one step, for anything that may be used only once. */
  take<T>(kind: AuthKind, id: string): Promise<T | null>;
  remove(kind: AuthKind, id: string): Promise<void>;
}

class MemoryAuth implements AuthStore {
  private rows = new Map<string, { data: Record<string, unknown>; expires: number }>();
  private live(key: string) {
    const row = this.rows.get(key);
    if (row && row.expires <= Date.now()) {
      this.rows.delete(key);
      return undefined;
    }
    return row;
  }
  async put(kind: AuthKind, id: string, data: Record<string, unknown>, ttl: number) {
    this.rows.set(`${kind}:${id}`, { data, expires: Date.now() + ttl * 1000 });
  }
  async get<T>(kind: AuthKind, id: string) {
    return (this.live(`${kind}:${id}`)?.data as T | undefined) ?? null;
  }
  async take<T>(kind: AuthKind, id: string) {
    const row = this.live(`${kind}:${id}`);
    this.rows.delete(`${kind}:${id}`);
    return (row?.data as T | undefined) ?? null;
  }
  async remove(kind: AuthKind, id: string) {
    this.rows.delete(`${kind}:${id}`);
  }
}

class PostgresAuth implements AuthStore {
  private sql: NeonQueryFunction<false, false>;
  constructor(url: string) {
    this.sql = neon(url);
  }
  private q(text: string, params: unknown[] = []) {
    return this.sql.query(text, params) as Promise<Record<string, any>[]>;
  }
  async put(kind: AuthKind, id: string, data: Record<string, unknown>, ttl: number) {
    await this.q(
      `INSERT INTO auth_docs (kind, id, data, expires_at) VALUES ($1, $2, $3, now() + make_interval(secs => $4))
       ON CONFLICT (kind, id) DO UPDATE SET data = $3, expires_at = now() + make_interval(secs => $4)`,
      [kind, id, JSON.stringify(data), ttl],
    );
    // Sweep now and then, so expired rows don't pile up.
    if (Math.random() < 0.05) await this.q('DELETE FROM auth_docs WHERE expires_at < now()');
  }
  async get<T>(kind: AuthKind, id: string) {
    const [row] = await this.q('SELECT data FROM auth_docs WHERE kind = $1 AND id = $2 AND expires_at > now()', [kind, id]);
    return row ? (row.data as T) : null;
  }
  async take<T>(kind: AuthKind, id: string) {
    const [row] = await this.q('DELETE FROM auth_docs WHERE kind = $1 AND id = $2 RETURNING data, expires_at > now() AS live', [kind, id]);
    return row && row.live ? (row.data as T) : null;
  }
  async remove(kind: AuthKind, id: string) {
    await this.q('DELETE FROM auth_docs WHERE kind = $1 AND id = $2', [kind, id]);
  }
}

const g = globalThis as typeof globalThis & { __ddAuth?: AuthStore };

export function authStore(): AuthStore {
  if (!g.__ddAuth) {
    const url = process.env.DATABASE_URL;
    g.__ddAuth = url ? new PostgresAuth(url) : new MemoryAuth();
  }
  return g.__ddAuth;
}

/** Tests: start from an empty in-memory store. */
export function resetAuthStore(): void {
  g.__ddAuth = new MemoryAuth();
}

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export const randomToken = (prefix: string, bytes = 32) => `${prefix}_${randomBytes(bytes).toString('base64url')}`;
