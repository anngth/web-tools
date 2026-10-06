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
- Uses local SQLite or an authenticated Cloudflare D1 gateway selected at startup
- Deletes expired links at startup and on a fixed five-minute schedule
- Keeps SQLite and D1 as independent datasets; switching backends requires a restart and does not migrate, replicate, or fail over records

## Project Structure

Feature code lives under `src/features/<tool-name>`. Shared app shell and navigation live under `src/app`, global styling lives under `src/styles`, and cross-tool utilities live under `src/shared`.

```txt
src/
  app/
    layout/
      AppShell.tsx
      PageHeader.tsx
      Sidebar.tsx
    App.tsx
    toolRegistry.ts
  features/
    totp/
      index.ts
      TotpPage.tsx
      totp.service.ts
      totp-url.ts
      totp.css
      totp.test.ts
  shared/
    clipboard/
      copyTextToClipboard.ts
      index.ts
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
DATABASE_BACKEND=sqlite \
SQLITE_PATH=./url-shortener.sqlite \
URL_SHORTENER_TTL_SECONDS=2592000 \
npm run dev:server
```

Vite proxies `/api` and `/s` to the Node process. Local development may derive short links from the request origin; production must always set `PUBLIC_BASE_URL`. Query the API process directly at `http://127.0.0.1:8080/healthz` for local readiness.

## Production Build

```bash
npm run build
npm run build:server
```

Compose requires the public HTTP(S) origin and starts the one hardened service with the default 30-day TTL and SQLite volume:

```bash
PUBLIC_BASE_URL=https://tools.example.com docker compose up --build -d
PUBLIC_BASE_URL=https://tools.example.com docker compose ps
```

`PUBLIC_BASE_URL` must be an absolute HTTP(S) origin with no credentials, path, query, or fragment. `URL_SHORTENER_TTL_SECONDS` defaults to `2592000` and must be a positive integer. Invalid production URL, TTL, backend, SQLite path, D1 settings, or `TRUST_PROXY` values fail startup before the service listens.

Abuse limits are configurable through environment variables (all optional; a value of `0` disables that limit):

| Variable | Default | Meaning |
| --- | --- | --- |
| `RATE_LIMIT_PER_MINUTE` | `10` | Link creations accepted per client IP per minute |
| `RATE_LIMIT_PER_HOUR` | `60` | Link creations accepted per client IP per hour |
| `RATE_LIMIT_PER_DAY` | `200` | Link creations accepted per client IP per day |
| `MAX_ACTIVE_LINKS` | `100000` | Maximum number of unexpired links; new creations get `503 capacity_reached` at the cap |

At least one `RATE_LIMIT_PER_*` window must stay enabled. Invalid (non-integer or negative) values fail startup before the service listens.

The service is ready only after configuration validation, backend construction, schema initialization, and startup cleanup. Check it inside the Compose network with `GET /healthz`; Docker also runs this readiness check. Cleanup then runs every fixed `300000` ms without overlap. SIGTERM/SIGINT stops new work, stops scheduling, drains in-flight requests and cleanup for at most 10 seconds, closes the backend once, and exits.

See the [backend operations runbook](src/features/url-shortener/backend/README.md) for logs, SQLite backup and restore, D1 deployment and token rotation, smoke tests, incident events, and security limitations.

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
