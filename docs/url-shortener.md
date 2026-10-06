# URL Shortener

The shortener creates generated or custom links and shows public statistics. Every link uses one server-controlled lifetime. The page is `/url-shortener`.

At startup the Node process tries an authenticated Cloudflare D1 gateway once. If that probe fails, it uses Postgres for the rest of the process. The datasets stay independent. A restart is the only way to try D1 again. The process does not copy, replicate, dual-write, or fail over links.

Expired links are deleted at startup and every five minutes.

## Browser

Vite proxies `/api` and `/s/` to the Node process on port 8080. The page calls `GET /api/health` before showing the form. If that check fails, the form stays hidden. Links already saved in the browser remain copyable, and statistics refresh stays disabled.

Local development may derive short links from the request origin. Production must set `PUBLIC_BASE_URL`.

## Postgres

`DATABASE_URL` is an absolute `postgres:` or `postgresql:` URL with a host, such as `postgres://127.0.0.1:5432/web_tools`. The database must already exist. The process creates the `short_links` table on connect. It does not create the database.

Leave `D1_GATEWAY_URL` and `D1_GATEWAY_TOKEN` empty to use Postgres. On Coolify, `DATABASE_URL` uses the Postgres service hostname, not `localhost` inside the app container.

## Local D1

`wrangler.toml` uses a placeholder `database_id`, so the steps below use local D1 and do not call Cloudflare. Put the Worker secret in gitignored `.dev.vars`:

```txt
GATEWAY_TOKEN=local-dev-token
```

```bash
npm run cf:dev
```

Set these in `.env`, then restart `be:dev`:

```txt
D1_GATEWAY_URL=http://127.0.0.1:8787
D1_GATEWAY_TOKEN=local-dev-token
```

D1 is selected when `GET /internal/health` returns exactly `{ "ok": true }`. The ready log then has `"backendType":"d1"`. Postgres selection also logs `"reason":"d1_unavailable"`. A successful create writes one `link_created` line containing only `requestId`.

Automated Worker tests do not need this setup:

```bash
npm run cf:test
```

Deployment, token rotation, rate limits, and backups are in the [server operations runbook](server-operations.md).
