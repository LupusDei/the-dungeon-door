import { timingSafeEqual } from 'node:crypto';
import { OUT_OF_CREDIT, outOfCredit } from './ai-errors.ts';

/** An error the API turns into `{ error }` with this status (see docs/api.md). `code` is added when set. */
export class HttpError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (message: string) => new HttpError(400, message);
export const forbidden = (message: string) => new HttpError(403, message);
export const notFound = (message: string) => new HttpError(404, message);
export const conflict = (message: string) => new HttpError(409, message);

/** Runs a handler, turning thrown HttpErrors into JSON error responses. */
export async function handle(fn: () => Promise<Response | unknown>): Promise<Response> {
  try {
    const result = await fn();
    return result instanceof Response ? result : Response.json(result);
  } catch (error) {
    if (error instanceof HttpError) {
      const body = error.code ? { error: error.message, code: error.code } : { error: error.message };
      return Response.json(body, { status: error.status });
    }
    console.error(error);
    // An AI call made inside the request (a portrait, a reading aloud) and the account is out of
    // credit: say so, since nothing the player does can mend it.
    if (outOfCredit(error)) return Response.json({ error: OUT_OF_CREDIT }, { status: 503 });
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUUID = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

/**
 * There is no sign-in: the app sends a random player id. When DD_APP_KEY is set, every request must
 * also carry it as `x-dd-key` (compared in constant time).
 */
export function checkAppKey(request: Request, expected = process.env.DD_APP_KEY): void {
  if (!expected) return;
  const given = request.headers.get('x-dd-key') ?? '';
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(401, 'missing or wrong app key');
}

/** Checks the app key and returns the caller's player id (`x-dd-player`, UUID-shaped). */
export function requirePlayer(request: Request): string {
  checkAppKey(request);
  const player = request.headers.get('x-dd-player');
  if (!isUUID(player)) throw new HttpError(401, 'missing or invalid x-dd-player');
  return player;
}

/** Reads the JSON body as an object; `{}` for an empty body; 400 for anything else. */
export async function readBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    const body = JSON.parse(text);
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw badRequest('body must be a JSON object');
}

/** The public origin of this request (for building absolute URLs to locally served images). */
export function originOf(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? url.host;
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? url.protocol.replace(':', '');
  return `${proto}://${host}`;
}

/** The game code from `?code=` (set by the vercel.json rewrites) or from the `/api/games/{code}` path. */
export function gameCodeOf(request: Request): string {
  const url = new URL(request.url);
  const code = url.searchParams.get('code') ?? url.pathname.match(/\/api\/games\/([^/]+)/)?.[1] ?? '';
  return code.toUpperCase();
}
