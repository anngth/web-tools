# Web Tools

A React toolbox with a TOTP generator and a persistent URL shortener. Production is one unprivileged Node container serving the existing application, API, redirects, and health endpoint on port 8080.

## Tools

### TOTP Generator

- RFC 6238 TOTP with HMAC-SHA1
- 6-digit tokens with 30-second refresh interval
- Base32 secrets with spaces and lowercase letters accepted
- Support for `otpauth://` URI scheme (Google Authenticator format)
- Automatic token refresh at the 30-second TOTP boundary
- Visual countdown timer showing time until next refresh
- Copy token by clicking the token or the copy button
- Clipboard fallback for older browsers
- Light mode by default with dark mode toggle
- Responsive sidebar with collapse/expand functionality
- No backend, no API calls, no secret storage

### URL Shortener

- Creates generated or custom short links with public statistics
- Enforces one server-controlled lifetime for every link
- Tries an authenticated Cloudflare D1 gateway once at startup and uses Postgres when D1 is unavailable
- Deletes expired links at startup and on a fixed five-minute schedule
- Keeps D1 and Postgres as independent datasets; a restart is required to select the other dataset and does not migrate, replicate, dual-write, or fail over records

## Project Structure

Browser tools live under `src/features/<tool-name>`. Shared app shell and navigation live under `src/app`, global styling lives under `src/styles`, and modules used by more than one runtime live under `src/shared`. The Node process lives under `src/server`. The Cloudflare Worker lives under `src/worker`.

```txt
src/
  app/
  features/
    totp/
    url-shortener/          # page, browser API client, browser storage, CSS
  shared/
    clipboard/
    short-links/
  server/
    main.ts                 # Node entry
    http/                   # public app, static HTML, health, limits, logger, cleanup
    short-links/            # startup selection, Postgres store, D1 gateway client
    README.md               # operations runbook
  worker/
    short-links/
  styles/
    index.css
    layout.css
    theme.css
```

#### URL Parameters

You can pre-fill the secret key using URL parameters:

- `?secret=JBSWY3DPEHPK3PXP`
- `?key=JBSWY3DPEHPK3PXP`
- `?s=JBSWY3DPEHPK3PXP`

Or use the standard `otpauth://` URI format:

- `otpauth://totp/Example:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example`

## Local Development

Run the browser and API as two processes in separate shells:

```bash
npm install
npm run dev
```

```bash
URL_SHORTENER_TTL_SECONDS=2592000 \
npm run dev:server
```

Startup tries D1 when both `D1_GATEWAY_URL` and `D1_GATEWAY_TOKEN` are set and the gateway health probe succeeds. Otherwise it uses `DATABASE_URL`, a `postgres:` or `postgresql:` URL such as `postgres://localhost:5432/web_tools`. The two datasets are independent. Vite proxies `/api` and `/s` to the Node process. Local development may derive short links from the request origin; production must always set `PUBLIC_BASE_URL`. Query the API process directly at `http://127.0.0.1:8080/healthz` for local readiness.

## Production Build

```bash
npm run build
npm run build:server
```

Compose requires the public HTTP(S) origin and starts the one hardened service with the default 30-day TTL. It passes `DATABASE_URL` through and does not mount a data volume:

```bash
PUBLIC_BASE_URL=https://tools.example.com docker compose up --build -d
PUBLIC_BASE_URL=https://tools.example.com docker compose ps
```

`PUBLIC_BASE_URL` must be an absolute HTTP(S) origin with no credentials, path, query, or fragment. `URL_SHORTENER_TTL_SECONDS` defaults to `2592000` and must be a positive integer. Invalid production URL, TTL, D1 settings, `DATABASE_URL`, or `TRUST_PROXY` values fail startup before the service listens. A failed start logs `server_start_failed` with `reason: "invalid_configuration_or_startup_failure"` and does not include driver or gateway detail.

Abuse limits are configurable through environment variables (all optional; a value of `0` disables that limit):

| Variable | Default | Meaning |
| --- | --- | --- |
| `RATE_LIMIT_PER_MINUTE` | `10` | Link creations accepted per client IP per minute |
| `RATE_LIMIT_PER_HOUR` | `60` | Link creations accepted per client IP per hour |
| `RATE_LIMIT_PER_DAY` | `200` | Link creations accepted per client IP per day |
| `MAX_ACTIVE_LINKS` | `100000` | Maximum number of unexpired links; new creations get `503 capacity_reached` at the cap |

At least one `RATE_LIMIT_PER_*` window must stay enabled. Invalid (non-integer or negative) values fail startup before the service listens.

The service is ready only after configuration validation, backend construction, schema initialization, and startup cleanup. Check it inside the Compose network with `GET /healthz`; Docker also runs this readiness check. Cleanup then runs every fixed `300000` ms without overlap. SIGTERM/SIGINT stops new work, stops scheduling, drains in-flight requests and cleanup for at most 10 seconds, closes the backend once, and exits.

See the [server operations runbook](src/server/README.md) for logs, D1 deployment and token rotation, Postgres backup ownership, smoke tests, incident events, and security limitations.

## SEO

The project includes:

- ✅ Meta tags (title, description, keywords)
- ✅ Open Graph tags (Facebook, LinkedIn)
- ✅ Twitter Card tags
- ✅ Structured Data (JSON-LD)
- ✅ Sitemap.xml
- ✅ Robots.txt
- ✅ PWA Manifest

Each tool has its own path (`/totp`, `/url-shortener`). The Node server renders `index.html` per path, so the title, description, canonical URL and JSON-LD are correct without running JavaScript. It also fills the `__SITE_ORIGIN__` placeholder in `index.html`, `robots.txt` and `sitemap.xml` from `PUBLIC_BASE_URL`. Tool metadata lives in `src/app/toolSeoData.ts`.

Because of that placeholder, `dist/` must be served by the Node server: a plain static host or CDN would publish the literal `__SITE_ORIGIN__`. `npm run dev` shows it in the raw HTML (the browser corrects the canonical link at runtime).

## Security

TOTP cryptographic operations remain client-side: secrets are not sent to the URL Shortener API, stored in cookies, or logged. URL Shortener logs are structured JSON on stdout/stderr and deliberately exclude destination URLs, credentials, authorization headers, request bodies, database paths, SQL, and raw gateway responses.
