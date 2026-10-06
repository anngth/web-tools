# Development

Browser tools live under `src/features/<tool-name>`. The app shell lives under `src/app`, global styling under `src/styles`, and modules used by more than one runtime under `src/shared`. The Node process lives under `src/server`. The Cloudflare Worker lives under `src/worker`.

```txt
src/
  app/
  features/
    totp/
    url-shortener/
  shared/
    clipboard/
    http/
    short-links/
  server/
    main.ts
    http/
    short-links/
  worker/
    short-links/
  styles/
docs/
  totp.md
  url-shortener.md
  development.md
  server-operations.md
```

## Scripts

| Script | What it runs |
| --- | --- |
| `fe:dev` | Vite |
| `fe:build` | Browser production bundle |
| `fe:typecheck` | Browser TypeScript project |
| `be:dev` | Node API, loading `.env` when present |
| `be:build` | Node server bundle in `dist-server/` |
| `be:start` | Production Node process from that bundle |
| `be:typecheck` | Node TypeScript project |
| `cf:dev` | Local Worker and local D1 |
| `cf:test` | Worker tests |
| `cf:typecheck` | Worker TypeScript project |
| `cf:deploy` | Deploy the Worker |
| `build:docker` | `fe:build` then `be:build` |
| `test` | Browser and Node tests |
| `test:all` | `test` then `cf:test` |
| `typecheck` | Browser, Node, and Worker typechecks |

`npm test` skips the Postgres store contract unless `POSTGRES_TEST_URL` is set. Do not point that variable at the application database: the contract deletes rows from `short_links`.

## Production build

```bash
npm run fe:build
npm run be:build
npm run be:start
```

The container build is `npm run build:docker`. Its runtime command is `node dist-server/server.js`, and it does not load `.env`. Compose setup, startup failures, and smoke tests are in the [server operations runbook](server-operations.md).

## SEO

Each tool has its own path (`/totp`, `/url-shortener`). The Node server renders `index.html` per path, so the title, description, canonical URL, and JSON-LD are correct without JavaScript. It fills the `__SITE_ORIGIN__` placeholder in `index.html`, `robots.txt`, and `sitemap.xml` from `PUBLIC_BASE_URL`. Tool metadata lives in `src/app/toolSeoData.ts`.

`dist/` must be served by the Node server. A plain static host would publish the literal `__SITE_ORIGIN__`. `npm run fe:dev` shows that placeholder in the raw HTML; the browser corrects the canonical link at runtime.

The site includes meta tags, Open Graph tags, Twitter Card tags, JSON-LD, `sitemap.xml`, `robots.txt`, and a PWA manifest.
