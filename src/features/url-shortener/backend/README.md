# URL Shortener Operations Runbook

The production image runs the React application, URL Shortener API, redirects, and health endpoint in the existing `web-tools` service on port 8080. It opens exactly one backend per process: SQLite or D1. Those datasets are independent; changing `DATABASE_BACKEND` requires a restart and never copies, replicates, dual-writes, or fails over links.

## Local and production startup

For local development, start Vite and the Node server in separate shells:

```bash
npm run dev
```

```bash
DATABASE_BACKEND=sqlite \
SQLITE_PATH=./url-shortener.sqlite \
URL_SHORTENER_TTL_SECONDS=2592000 \
npm run dev:server
```

Production Compose requires an explicit trusted public origin:

```bash
PUBLIC_BASE_URL=https://tools.example.com docker compose up --build -d
```

`PUBLIC_BASE_URL` must be an absolute HTTP(S) origin without credentials, path, query, or fragment. It prevents an untrusted request `Host` from determining returned short URLs. `URL_SHORTENER_TTL_SECONDS` defaults to `2592000` (30 days), applies to every created link, and accepts only positive integers. Clients cannot choose a TTL. Invalid URL, TTL, backend, storage, gateway, or proxy configuration fails before the process listens.

With `DATABASE_BACKEND=sqlite` (the default), `SQLITE_PATH` defaults to `/data/url-shortener.sqlite` on the `url-shortener-data` volume. D1 mode requires `DATABASE_BACKEND=d1`, `D1_GATEWAY_URL`, and `D1_GATEWAY_TOKEN`; the mounted SQLite volume is then unused.

## Health, cleanup, and shutdown

`GET /healthz` becomes successful only after configuration validation, backend construction, schema initialization, and startup cleanup. It is a local readiness signal and does not query D1 on every probe.

The process calls `deleteExpired` during startup and every fixed five minutes (`300000` ms). Scheduled runs never overlap: a tick is skipped and logged while a previous cleanup is active. Expired redirect and statistics requests still return `404` immediately between cleanup runs.

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

Useful lifecycle and incident events are `server_start`, `server_ready`, `cleanup_completed`, `cleanup_skipped`, `cleanup_failed`, `request_failed`, `shutdown_started`, and `shutdown_completed`. Startup records include `backendType`, port 8080, and `intervalMs: 300000`; cleanup completion includes its trigger, deletion count, and duration. A generic `server_start_failed` indicates invalid configuration or startup failure. Correlate unexpected request failures using the safe request ID returned in the response header.

Logs must never contain destination URLs, bearer tokens, secrets, authorization headers, request bodies, full database paths, raw SQL errors, or raw gateway response bodies. Validation, collision, missing/expired-link, and rate-limit responses are expected and are not error events. If a prohibited value appears, restrict log access, rotate the affected credential, preserve only redacted evidence, and investigate the logging path before restarting traffic.

## SQLite backup and restore

SQLite uses WAL mode for file databases. Never copy only the main `.sqlite` file while the service is live: committed data may still be in `-wal`, and copying the files independently can produce an inconsistent backup. The safest operational checkpoint is a graceful stop, which closes the database; archive the whole data volume only after `shutdown_completed` appears.

```bash
mkdir -p backups
PUBLIC_BASE_URL=https://tools.example.com docker compose stop web-tools
CONTAINER_ID="$(PUBLIC_BASE_URL=https://tools.example.com docker compose ps -a -q web-tools)"
VOLUME_NAME="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "$CONTAINER_ID")"
docker run --rm -v "$VOLUME_NAME:/data:ro" -v "$PWD/backups:/backup" alpine \
  tar -czf /backup/url-shortener-data.tgz -C /data .
PUBLIC_BASE_URL=https://tools.example.com docker compose start web-tools
```

For a zero-downtime backup, use a SQLite-aware online backup tool or run `PRAGMA wal_checkpoint` before an atomic snapshot of the entire volume; do not substitute a live filesystem copy. Verify backup readability and retain it according to local data-protection policy.

Restore only into a stopped service. The following replaces the selected volume contents, so verify `VOLUME_NAME` and the archive first:

```bash
PUBLIC_BASE_URL=https://tools.example.com docker compose stop web-tools
CONTAINER_ID="$(PUBLIC_BASE_URL=https://tools.example.com docker compose ps -a -q web-tools)"
VOLUME_NAME="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "$CONTAINER_ID")"
docker run --rm -v "$VOLUME_NAME:/data" -v "$PWD/backups:/backup:ro" alpine \
  sh -c 'find /data -mindepth 1 -maxdepth 1 -delete && tar -xzf /backup/url-shortener-data.tgz -C /data'
PUBLIC_BASE_URL=https://tools.example.com docker compose start web-tools
```

Confirm `/healthz`, an active redirect, and statistics after restore. Keep the service stopped and restore the previous backup if validation fails.

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

After an approved D1 deployment, use a distinct D1 alias to verify create/stats/redirect and expiration, restart in D1 mode, and call cleanup through the Node scheduler integration. Then switch back to SQLite and confirm the D1 alias is absent and the existing SQLite alias remains. This proves backend independence; it is not a migration procedure.

## Proxy and rate-limit limitations

Creation is limited per process and per client key with up to three fixed windows, configured by `RATE_LIMIT_PER_MINUTE` (default `10`), `RATE_LIMIT_PER_HOUR` (default `60`), and `RATE_LIMIT_PER_DAY` (default `200`). Set a window to `0` to disable it; at least one must remain enabled, and invalid values fail startup. A request is accepted only when every enabled window has room, and a rejected request is not counted against any window. The `429` response carries `Retry-After` set to the longest remaining wait among the exhausted windows. The limits are in memory, reset on restart, and are neither shared nor globally consistent across replicas. Every request reaching `POST /api/links` that is not rate limited counts, including malformed or rejected requests.

`MAX_ACTIVE_LINKS` (default `100000`, `0` disables) caps the number of unexpired links. When the cap is reached, `POST /api/links` returns `503` with `capacity_reached` until links expire and cleanup or the active-count query frees room. With SQLite the check and insert are serialized within the process, so the cap is exact. With the D1 backend each Worker invocation checks the count independently, so concurrent creations can overshoot the cap by a small amount; treat it as a soft limit. The Worker reports the condition to the Node service as `507`.

Keep `TRUST_PROXY=false` unless the service is behind a controlled proxy that overwrites `X-Forwarded-For`. By default the direct socket peer is the client key and forwarded headers are ignored. With `TRUST_PROXY=true`, the first valid forwarded address is trusted, so enabling it for direct internet traffic permits client spoofing and weakens rate limiting.

## Local verification

Use an explicit local public origin only for Compose interpolation:

```bash
npm run test:all
npm run typecheck
npm run build
npm run build:docker
PUBLIC_BASE_URL=http://127.0.0.1:8080 docker compose config
PUBLIC_BASE_URL=http://127.0.0.1:8080 docker compose build
```

The fake-timer cleanup scheduler tests prove the exact `300000` interval and non-overlap without waiting five minutes. Container smoke tests should additionally verify one non-root service on 8080, both browser tools, server-computed TTL, pre-expiry `302`, post-expiry redirect/stats `404`, startup deletion of a seeded expired row, active SQLite persistence across restart, the create beyond the per-minute limit returning `429` with `Retry-After`, creation at `MAX_ACTIVE_LINKS` returning `503 capacity_reached`, structured redacted logs, and graceful shutdown. There is no environment variable or command-line option that overrides the production cleanup interval.
