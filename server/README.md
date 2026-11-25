# The Dungeon Door — server

Plain Vercel functions (`api/*.ts`, Web-standard `GET/POST/PUT/DELETE(request)`), logic in `lib/`.
The API contract is [`../docs/api.md`](../docs/api.md); the DM seam is
[`../docs/dungeon-master.md`](../docs/dungeon-master.md).

## Run locally

Needs Node 22+ (`source ~/.nvm/nvm.sh && nvm use 22`).

```bash
npm install
npm run dev                      # http://localhost:3000 — fake AI, in-memory store, no network
DD_FAKE_DELAY_MS=1500 npm run dev   # same, with fake latency so "preparing"/"painting" states show
PORT=4000 npm run dev
```

`npm run dev` is a tiny single-process server (`scripts/dev.ts`) that serves `api/*.ts` with the
`vercel.json` rewrites. Use it rather than `vercel dev`: `vercel dev` runs each function in its own
process, so the in-memory store isn't shared between endpoints (it does work once `DATABASE_URL` is set).

It listens on all interfaces, so the iOS simulator can use `http://localhost:3000` and a phone on the same
Wi-Fi can use `http://<your-mac>.local:3000`. Images are served from `GET /api/image?id=…` on the same
origin (the app needs an ATS exception for local networking, e.g. `NSAllowsLocalNetworking`).

**Real AI locally** (costs money): `vercel env pull` (gives a `VERCEL_OIDC_TOKEN` for the AI Gateway),
then `npm run dev:real`. It loads `.env.local`, so it also uses Postgres/Blob if those are in there.

**A second player**: with a game in the lobby,

```bash
npm run bot -- --base http://localhost:3000 --code ABCDEF        # add --portrait to forge a portrait
```

joins with a random character, says hello, and votes randomly each scene until the end. Run it several
times for a bigger party.

**Smoke test with curl**:

```bash
P=11111111-1111-4111-8111-111111111111; C=$(uuidgen)
curl -s localhost:3000/api/catalog
curl -s -X PUT localhost:3000/api/characters -H "x-dd-player: $P" -H 'content-type: application/json' \
  -d "{\"id\":\"$C\",\"name\":\"Mira\",\"race\":\"elf\",\"characterClass\":\"ranger\",\"gender\":\"female\",\"temperament\":\"brave\",\"alignment\":\"chaotic-good\"}"
curl -s -X POST localhost:3000/api/games -H "x-dd-player: $P" -H 'content-type: application/json' -d "{\"characterId\":\"$C\"}"
# then /api/games/{code}/start, /vote {"sceneIndex":0,"choiceId":"a"}, GET /api/games/{code}?since=0 …
```

## Checks

```bash
npm run typecheck
npm test            # node --test: full games on the in-memory store with fake AI
```

## Configuration

| Env var | Meaning |
| --- | --- |
| `DATABASE_URL` | Postgres (Neon). Unset → in-memory store (dev/tests only: data is per process). Run `npm run migrate` once to create the tables (`db/schema.sql`, idempotent). |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob (public) for portraits and scene art. Unset → in-memory images served by `/api/image`. |
| `DD_APP_KEY` | Optional shared key; when set every request (catalog included) needs a matching `x-dd-key`. `/api/image` stays open. |
| `DD_TEXT_MODEL` | DM + appearance model (default `anthropic/claude-sonnet-5.5`). |
| `DD_IMAGE_MODEL` | Portrait + scene art model (default `google/gemini-3.1-flash-image`, which takes party portraits as reference images). Image-only models such as `openai/gpt-image-2` also work (via `generateImage`). |
| `DD_IMAGE_API` | Force `text` (generateText with image output) or `image` (generateImage) if auto-detection is wrong. |
| `DD_FAKE_AI=1` | No AI calls at all: deterministic fake DM, appearances and placeholder PNGs. |
| `DD_FAKE_DELAY_MS` | Fake latency per fake AI call. |
| `VERCEL_OIDC_TOKEN` / `AI_GATEWAY_API_KEY` | AI Gateway auth (automatic on Vercel deployments). |

## Layout

```
api/                 one file per endpoint; vercel.json rewrites /api/games/:code[/action] onto game*.ts
lib/game.ts          game rules: lobby, start, votes, exactly-once resolution, background DM + painting
lib/dm/              the pluggable dungeon master (see docs/dungeon-master.md)
lib/store/           Store interface + memory.ts and postgres.ts
lib/images/          ImageStore (Blob or in-memory) + fake placeholder PNGs
lib/ai.ts            appearance text + image generation (references, fallbacks, fake mode)
lib/models.ts        model ids (env-overridable)
lib/catalog.ts       races, classes, temperaments, genders, alignments, DM archetypes
db/schema.sql        Postgres schema
scripts/             dev server, migrate, bot
```

Long work (DM writing, painting) runs after the response via `waitUntil` (`maxDuration` 300 s). Status
changes are compare-and-set updates (`UPDATE … WHERE status = 'voting' AND scene_index = $n`), so each
scene resolves exactly once however many votes land at the same moment.
