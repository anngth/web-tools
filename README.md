# Web Tools

A React toolbox with a TOTP generator and a persistent URL shortener. Production is one Cloudflare Worker (`web-tools`) with a D1 database, served at https://tools.heimerng.dev.

## Run locally

```bash
npm install
npx wrangler d1 migrations apply web-tools-url-shortener --local
npm run cf:dev
```

`cf:dev` builds `dist/` and runs the whole app on http://127.0.0.1:8787. For frontend hot reload, keep it running and start Vite in another terminal; Vite proxies `/api` and `/s/` to port 8787:

```bash
npm run fe:dev
```

Tests and checks, as CI runs them:

```bash
npm run test:all
npm run typecheck
```

## TOTP input

Paste a Base32 key or a TOTP setup URI into the generator. To import from a
web link, put the encoded setup URI after `#` on the `/totp` page. The
generator clears the fragment after reading it. If you previously passed a
real key in a web URL query string, rotate it at the service that issued it.

## Deploy to Cloudflare

### Automatic (Workers Builds)

Every push to `main` deploys the Worker. The Worker `web-tools` is connected to this GitHub repo in the Cloudflare dashboard (Workers & Pages → web-tools → Settings → Build) with:

| Setting | Value |
| --- | --- |
| Branch | `main` |
| Build command | `npm run fe:build` |
| Deploy command | `npx wrangler d1 migrations apply web-tools-url-shortener --remote && npx wrangler deploy` |

The deploy command applies new D1 migrations before the new code goes live. CI (`.github/workflows/ci.yml`) runs tests, typecheck and `wrangler deploy --dry-run` on pushes and pull requests, but it does not deploy.

### Manual

```bash
npx wrangler login
npx wrangler d1 migrations apply web-tools-url-shortener --remote
npm run cf:deploy
```

### First setup on a new account

1. Create the database with `npx wrangler d1 create web-tools-url-shortener` and put the returned `database_id` in `wrangler.toml`.
2. Change `routes` and `PUBLIC_BASE_URL` in `wrangler.toml` to your domain. The domain's zone must be on Cloudflare with a proxied DNS record, or use a Custom Domain instead of a route.
3. Apply migrations and deploy as above.

### Configuration

Settings are `[vars]` in `wrangler.toml` and ship with each deploy:

| Variable | Meaning |
| --- | --- |
| `PUBLIC_BASE_URL` | Origin for short links and canonical URLs. Without it, the request origin is used. |
| `URL_SHORTENER_TTL_SECONDS` | Link lifetime (default 30 days). |
| `MAX_ACTIVE_LINKS` | Cap on live links; new links get 503 above it. |
| `RATE_LIMIT_PER_MINUTE`, `_PER_HOUR`, `_PER_DAY` | Link creations per client IP, counted in D1. |

A cron trigger every 5 minutes deletes expired links and old rate-limit windows.

### Turning tools on and off

`DISABLED_TOOLS` is a runtime variable: a comma-separated list of tool ids (`totp`, `url-shortener`). Set it in the dashboard (Workers & Pages → web-tools → Settings → Variables and Secrets → Add). It takes effect as soon as it is saved, with no build or push. Delete the variable, or leave it empty, to turn everything back on. `keep_vars = true` in `wrangler.toml` keeps it across deploys. Do not also list it in `[vars]`, or the file wins.

For a disabled tool:

- Its sidebar entry is hidden, and its path opens the first enabled tool.
- Its API (`/api/links*`) answers 404. For the URL Shortener, `/s/:slug` keeps redirecting so links that were already shared still work, and the cleanup cron keeps running.
- It is left out of `sitemap.xml`, and page metadata follows the tool that is shown instead.
- Unknown ids are ignored, and a list that would disable every tool is ignored. Both are logged as `config_ignored` (see `wrangler tail`).

### Logs and rollback

```bash
npx wrangler tail web-tools
```

```bash
npx wrangler rollback
```

Rollback restores the previous Worker code only; D1 migrations are not undone.

## Docs

Read these before exploring the tree:

- [Project overview](docs/project-overview-prd.md)
- [System architecture](docs/system-architecture.md)
- [Code standards](docs/code-standards.md)
- [Server operations](docs/server-operations.md)
