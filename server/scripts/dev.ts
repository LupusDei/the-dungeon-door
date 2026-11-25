/**
 * Local dev server: serves api/*.ts with vercel.json's rewrites in ONE process, so the in-memory store and
 * image store are shared by every endpoint (vercel dev runs functions in separate processes).
 *
 *   npm run dev                 # fake AI, in-memory store, http://localhost:3000
 *   PORT=4000 npm run dev
 *   npm run dev:real            # real AI Gateway calls (needs `vercel env pull` → .env.local)
 */
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { rewrites = [] } = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')) as {
  rewrites?: { source: string; destination: string }[];
};

/** Applies the first matching vercel.json rewrite (`:param` segments only, which is all we use). */
function rewrite(pathname: string): string {
  for (const { source, destination } of rewrites) {
    const names: string[] = [];
    const pattern = new RegExp('^' + source.replace(/:(\w+)/g, (_, name) => (names.push(name), '([^/]+)')) + '/?$');
    const match = pathname.match(pattern);
    if (match) return names.reduce((dest, name, i) => dest.replaceAll(`:${name}`, match[i + 1]), destination);
  }
  return pathname;
}

type Handler = (request: Request) => Promise<Response>;
const modules = new Map<string, Record<string, Handler>>();

async function load(name: string): Promise<Record<string, Handler> | null> {
  if (!/^[a-z-]+$/.test(name)) return null;
  if (!modules.has(name)) {
    try {
      modules.set(name, await import(join(root, 'api', `${name}.ts`)));
    } catch (error) {
      if ((error as { code?: string }).code === 'ERR_MODULE_NOT_FOUND') return null;
      throw error;
    }
  }
  return modules.get(name)!;
}

async function body(req: IncomingMessage): Promise<string | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8"); // every endpoint takes JSON
}

const port = Number(process.env.PORT ?? 3000);

createServer(async (req, res) => {
  const started = Date.now();
  try {
    const original = new URL(req.url ?? '/', `http://${req.headers.host ?? `localhost:${port}`}`);
    const target = new URL(rewrite(original.pathname), original);
    for (const [key, value] of original.searchParams) if (!target.searchParams.has(key)) target.searchParams.set(key, value);

    const name = target.pathname.match(/^\/api\/([a-z-]+)\/?$/)?.[1];
    const mod = name ? await load(name) : null;
    const handler = mod?.[req.method ?? 'GET'];
    let response: Response;
    if (!mod) response = Response.json({ error: 'not found' }, { status: 404 });
    else if (!handler) response = Response.json({ error: 'method not allowed' }, { status: 405 });
    else {
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === 'string') headers.set(key, value);
        else if (Array.isArray(value)) headers.set(key, value.join(', '));
      }
      response = await handler(new Request(target, { method: req.method, headers, body: await body(req) }));
    }
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
    console.log(`${req.method} ${original.pathname}${original.search} → ${response.status} (${Date.now() - started} ms)`);
  } catch (error) {
    console.error(error);
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'internal error' }));
  }
}).listen(port, '0.0.0.0', () => {
  const ai = process.env.DD_FAKE_AI === '1' ? 'fake AI' : `real AI (${process.env.DD_TEXT_MODEL ?? 'default models'})`;
  const store = process.env.DATABASE_URL ? 'Postgres' : 'in-memory store';
  console.log(`The Dungeon Door API on http://localhost:${port} — ${ai}, ${store}`);
});
