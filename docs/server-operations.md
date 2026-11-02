# Server operations

How to run the process. Runtime rules are in source, not here.

## Run

Production runs on the Cloudflare Worker (below). Node: `npm run be:dev`, with `vite.config.ts` pointed back at port 8080. `be:dev` loads `.env` when that file exists. Variable names are in `.env.example`. Production does not load `.env`. The image and Compose service are `Dockerfile` and `compose.yaml`.

## Worker (production)

`npm run cf:dev` builds `dist/` and runs the whole app on `http://127.0.0.1:8787`; `npm run fe:dev` proxies `/api` and `/s/` there. Apply local tables first with `wrangler d1 migrations apply web-tools-url-shortener --local`. `npm run cf:test` does not need a running Worker.

`npm run cf:deploy` builds `dist/` and deploys. Before a deploy that adds a migration, run `wrangler d1 migrations apply web-tools-url-shortener --remote`. Limits and TTL are `[vars]` in `wrangler.toml`; `PUBLIC_BASE_URL` is optional there, since links default to the request origin. Remote Cloudflare changes are manual and are not part of CI.

`/internal/*` is the token-protected gateway the Docker server used. It answers 500 until `GATEWAY_TOKEN` is set with `wrangler secret put`. Remove it once Docker is gone.

### Moving off Docker

1. Apply migrations with `--remote`, then `npm run cf:deploy`. Check the app on `*.workers.dev`.
2. Point the domain at the Worker (Custom Domain, or a route if the record is already proxied by Cloudflare).
3. Stop the Docker service. Links are already in D1, so no data moves. Keep the image for a while to roll back.

## Where behavior lives

Worker: entry, routing and cron cleanup are `src/worker/main.ts`; static files and SEO are `src/worker/http/public-app.ts`; rate limits are `src/worker/http/d1-rate-limiter.ts`.

Node (Docker): Startup and backend choice are `src/server/main.ts` and `src/server/short-links/backend-selector.ts`. Failure reasons are `src/server/startup-failure.ts`. Logs are `src/server/http/logger.ts`. Cleanup and shutdown are `src/server/http/cleanup-scheduler.ts` and `src/server/main.ts`. Rate limits and proxy trust are `src/server/http/limits-config.ts` and `src/server/http/rate-limiter.ts`. The HTTP API is `src/server/http/public-app.ts`.

Postgres backup belongs to the Postgres service. This image does not store short links on a volume.
