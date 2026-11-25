import { MemoryStore } from './memory.ts';
import { PostgresStore } from './postgres.ts';
import type { Store } from './types.ts';

export type { Store } from './types.ts';

const g = globalThis as typeof globalThis & { __ddStore?: Store };

/** Postgres when DATABASE_URL is set, otherwise one in-memory store per process. */
export function getStore(): Store {
  if (!g.__ddStore) {
    const url = process.env.DATABASE_URL;
    g.__ddStore = url ? new PostgresStore(url) : new MemoryStore();
  }
  return g.__ddStore;
}

/** Tests: replace (or with no argument, reset) the store. */
export function setStore(store?: Store): void {
  g.__ddStore = store;
}
