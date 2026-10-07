# Server operations

How to run the process. Runtime rules are in source, not here.

## Run

Local: `npm run fe:dev` and `npm run be:dev`. `be:dev` loads `.env` when that file exists. Variable names are in `.env.example`. Production does not load `.env`. The image and Compose service are `Dockerfile` and `compose.yaml`.

## Local D1

`wrangler.toml` has a placeholder database id. `npm run cf:dev` runs the Worker locally. Put `GATEWAY_TOKEN` in gitignored `.dev.vars`, point the D1 variables in `.env` at that Worker, then restart `be:dev`. `npm run cf:test` does not need a running Worker.

Remote Cloudflare changes are manual and are not part of CI. Names are in `wrangler.toml`. Set the Worker token with `wrangler secret put`, not as a command-line argument.

## Where behavior lives

Startup and backend choice are `src/server/main.ts` and `src/server/short-links/backend-selector.ts`. Failure reasons are `src/server/startup-failure.ts`. Logs are `src/server/http/logger.ts`. Cleanup and shutdown are `src/server/http/cleanup-scheduler.ts` and `src/server/main.ts`. Rate limits and proxy trust are `src/server/http/limits-config.ts` and `src/server/http/rate-limiter.ts`. The HTTP API is `src/server/http/public-app.ts`.

Postgres backup belongs to the Postgres service. This image does not store short links on a volume.
