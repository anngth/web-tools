# Server Operations Runbook

The production image runs the React application, URL Shortener API, redirects, and health endpoint in the existing `web-tools` service on port 8080. Each process opens exactly one backend at startup: Cloudflare D1, or Postgres when D1 is unavailable. Those datasets are independent. A restart is the only way to try D1 again. The process never copies, replicates, dual-writes, or fails over links.

## Local and production startup

For local development, start Vite and the Node server in separate shells:

```bash
npm run fe:dev
```

```bash
npm run be:dev
```

`be:dev` loads a gitignored `.env` when the file exists. Copy `.env.example` and edit it. A variable already set in the shell overrides the file. The production process does not read `.env`.

Startup validates TTL and `MAX_ACTIVE_LINKS` first. It then tries D1 when `D1_GATEWAY_URL` and `D1_GATEWAY_TOKEN` are both non-empty and the URL is an absolute `http:` or `https:` URL with a host and no embedded credentials. A successful `GET /internal/health` probe selects D1 and does not open Postgres. Missing gateway settings, a rejected URL, a failed probe, or a thrown probe error make D1 unavailable.

When D1 is unavailable, `DATABASE_URL` must be an absolute `postgres:` or `postgresql:` URL with a host. Local development points at `localhost:5432`. Coolify points at the Postgres service hostname. Compose does not run Postgres; it passes `DATABASE_URL: ${DATABASE_URL:-}`, and an empty value is valid Compose. The image does not create `/data`.

Production Compose requires an explicit trusted public origin:

```bash
PUBLIC_BASE_URL=https://tools.example.com docker compose up --build -d
```

`PUBLIC_BASE_URL` must be an absolute HTTP(S) origin without credentials, path, query, or fragment. It prevents an untrusted request `Host` from determining returned short URLs. `URL_SHORTENER_TTL_SECONDS` defaults to `2592000` (30 days), applies to every created link, and accepts only positive integers. Clients cannot choose a TTL. `CLEANUP_INTERVAL_SECONDS` defaults to `300` (five minutes) and accepts a positive whole number of seconds up to `2147483`. A blank value uses the default. Missing or invalid D1 settings select Postgres. Startup fails before the process listens for an invalid `PUBLIC_BASE_URL`, TTL, cleanup interval, rate limits, or `TRUST_PROXY`, and for an invalid `DATABASE_URL` only when D1 is not selected.

Failure logs one JSON line and exits 1:

```json
{"timestamp":"2026-07-12T03:04:05.006Z","level":"error","event":"server_start_failed","reason":"public_base_url_missing"}
```

`reason` names which check failed. The log does not include `DATABASE_URL`, gateway URLs, tokens, probe HTTP status, SQL, or driver text.

## Health, cleanup, and shutdown

`GET /healthz` returns `{ "status": "ok" }` only after configuration validation, backend construction, and schema initialization. It does not query D1 or Postgres.

The process calls `deleteExpired` on the interval from `CLEANUP_INTERVAL_SECONDS`, defaulting to five minutes (`300000` ms). It does not run cleanup at startup. Scheduled runs never overlap: a tick is skipped and logged while a previous cleanup is active. Expired redirect and statistics requests still return `404` immediately between cleanup runs.

SIGTERM and SIGINT stop new connections, clear the cleanup timer, and drain active requests and cleanup. After the 10-second bound the process forces remaining connections closed, closes the selected backend exactly once, and exits. Use Compose so Docker sends the configured SIGTERM:

```bash
PUBLIC_BASE_URL=https://tools.example.com docker compose stop web-tools
```

## Logs and incident response

The process emits one JSON record per line to stdout or stderr:

```bash
PUBLIC_BASE_URL=https://tools.example.com docker compose logs -f web-tools
docker logs -f <container>
```

Application logging has no file rotation. Operators must configure retention and rotation in the Docker logging driver.

Useful lifecycle and incident events are `server_start`, `server_ready`, `link_created`, `cleanup_completed`, `cleanup_skipped`, `cleanup_failed`, `request_failed`, `shutdown_started`, and `shutdown_completed`. A successful link creation writes one `link_created` info line with `requestId` only. Startup records include `backendType` (`d1` or `postgres`), port 8080, and `intervalMs` for the configured cleanup interval. When `backendType` is `postgres`, `server_start` and `server_ready` also include `reason: "d1_unavailable"`. That reason is not an error. Cleanup completion includes its trigger, deletion count, and duration. `server_start_failed` means the process exited before listen. `reason` names the failed check: `public_base_url_missing`, `public_base_url_invalid`, `trust_proxy_invalid`, `rate_limit_invalid`, `ttl_invalid`, `max_active_links_invalid`, `database_url_invalid`, `postgres_unreachable`, `postgres_authentication_failed`, `postgres_database_missing`, `postgres_open_failed`, `cleanup_interval_invalid`, or `listen_failed`. An unrecognized failure stays `invalid_configuration_or_startup_failure`. The line still omits `DATABASE_URL`, driver text, and SQL. Correlate unexpected request failures using the safe request ID returned in the response header.

Logs must never contain destination URLs, bearer tokens, secrets, authorization headers, request bodies, `DATABASE_URL`, raw SQL errors, or raw gateway response bodies. Validation, collision, missing/expired-link, and rate-limit responses are expected and are not error events. If a prohibited value appears, restrict log access, rotate the affected credential, preserve only redacted evidence, and investigate the logging path before restarting traffic.

## Postgres backup

Postgres backup and restore belong to the local or Coolify Postgres service. This image does not store short links on a volume and does not provide a backup command.

## D1 operator checkpoint and token rotation

Remote Cloudflare work is never part of local build or test automation. Before any mutation, an operator must identify the intended Cloudflare account and environment, resolve the account and database names, and explicitly approve these commands:

```bash
npx wrangler whoami
npx wrangler d1 create web-tools-url-shortener --binding DB --update-config
npx wrangler d1 migrations apply web-tools-url-shortener --remote
npx wrangler secret put GATEWAY_TOKEN
npm run cf:deploy
```

Do not put a token value on the command line or in shell history; `wrangler secret put` reads it interactively. A non-secret D1 database identifier may be committed in Wrangler configuration, but the gateway token belongs only in Cloudflare secret storage and the deployment secret manager used by the Node service.

Rotate the gateway token by selecting the account/environment, setting the new Worker secret interactively, updating the Node deployment secret through its secret manager, and restarting the `web-tools` container. Verify create, stats, redirect, authenticated cleanup, and token redaction, then revoke the old credential if the secret platform supports an overlap window. Never paste either token into logs, Compose files, `.env` files committed to Git, tickets, or shell commands.

After an approved D1 deployment, create a link through the gateway, restart the Node process with the same gateway settings, and confirm that link still resolves. Then restart with D1 unavailable and a different `DATABASE_URL` and confirm the D1 link is absent. This proves the datasets are independent. It is not a migration procedure.

## Proxy and rate-limit limitations

Creation is limited per process and per client key with up to three fixed windows, configured by `RATE_LIMIT_PER_MINUTE` (default `10`), `RATE_LIMIT_PER_HOUR` (default `60`), and `RATE_LIMIT_PER_DAY` (default `200`). Set a window to `0` to disable it; at least one must remain enabled, and invalid values fail startup. A request is accepted only when every enabled window has room, and a rejected request is not counted against any window. The `429` response carries `Retry-After` set to the longest remaining wait among the exhausted windows. The limits are in memory, reset on restart, and are neither shared nor globally consistent across replicas. Every request reaching `POST /api/links` that is not rate limited counts, including malformed or rejected requests.

`MAX_ACTIVE_LINKS` (default `100000`, `0` disables) caps the number of unexpired links. When the cap is reached, `POST /api/links` returns `503` with `capacity_reached` until links expire and cleanup or the active-count query frees room. With Postgres the check and insert are serialized within the process, so the cap is exact. With the D1 backend each Worker invocation checks the count independently, so concurrent creations can overshoot the cap by a small amount; treat it as a soft limit. The Worker reports the condition to the Node service as `507`.

Keep `TRUST_PROXY=false` unless the service is behind a controlled proxy that overwrites `X-Forwarded-For`. By default the direct socket peer is the client key and forwarded headers are ignored. With `TRUST_PROXY=true`, the first valid forwarded address is trusted, so enabling it for direct internet traffic permits client spoofing and weakens rate limiting.

## Local verification

Use an explicit local public origin only for Compose interpolation:

```bash
npm run test:all
npm run typecheck
npm run fe:build
npm run build:docker
PUBLIC_BASE_URL=http://127.0.0.1:8080 docker compose config
PUBLIC_BASE_URL=http://127.0.0.1:8080 docker compose build
```

`npm test` skips the Postgres store contract when `POSTGRES_TEST_URL` is unset and `CI` is not `true`. Set `POSTGRES_TEST_URL` to a database that is not the application database to run that contract. The fake-timer cleanup scheduler tests prove the default `300000` ms interval and non-overlap without waiting five minutes. Container smoke tests should additionally verify one non-root service on 8080, both browser tools, server-computed TTL, pre-expiry `302`, post-expiry redirect/stats `404`, persistence of the selected dataset across restart, the create beyond the per-minute limit returning `429` with `Retry-After`, creation at `MAX_ACTIVE_LINKS` returning `503 capacity_reached`, structured redacted logs, and graceful shutdown. `CLEANUP_INTERVAL_SECONDS` overrides that interval; an unset or blank value keeps five minutes.
