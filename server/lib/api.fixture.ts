/** Calling API handlers in tests the way Vercel does: a Request in, a Response out. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as charactersApi from '../api/characters.ts';
import { supportedAppVersionHeader } from './app-version.ts';
import type { Character } from './types.ts';

export type Handler = (request: Request) => Promise<Response>;

export async function call<T = any>(handler: Handler, path: string, opts: { player?: string; body?: unknown; method?: string; headers?: Record<string, string>; appVersion?: string | null } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...opts.headers };
  if (opts.player) headers['x-dd-player'] = opts.player;
  // A current build, unless the test is playing someone out of date (`null` sends no header).
  if (opts.appVersion !== null && !headers['x-dd-app-version']) headers['x-dd-app-version'] = opts.appVersion ?? supportedAppVersionHeader();
  const request = new Request(`http://localhost:3000${path}`, {
    method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const response = await handler(request);
  return { status: response.status, body: (response.headers.get('content-type')?.includes('json') ? await response.json() : null) as T, response };
}

/** Mirrors the vercel.json rewrite: the handler sees ?code=… */
export const gamePath = (code: string, action?: string, query = '') => `/api/game${action ? `-${action}` : ''}?code=${code}${query}`;

export async function makeCharacter(player: string, name: string, overrides: Record<string, unknown> = {}): Promise<Character> {
  const { status, body } = await call<Character>(charactersApi.PUT, '/api/characters', {
    player,
    method: 'PUT',
    body: { id: randomUUID(), name, race: 'dwarf', characterClass: 'cleric', gender: 'female', temperament: 'stoic', alignment: 'lawful-good', backstory: '', description: 'braided red beard', ...overrides },
  });
  assert.equal(status, 200, JSON.stringify(body));
  return body;
}
