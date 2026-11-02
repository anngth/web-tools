# System architecture

Where the code lives. Open the file for the rule.

Three runtimes, and they do not import each other. The browser starts at `src/main.tsx` (`tsconfig.json` excludes `src/server` and `src/worker`). Node starts at `src/server/main.ts` (`tsconfig.node.json`). The Worker starts at `src/worker/main.ts` (`tsconfig.worker.json` lists files explicitly).

Production is the Worker: it serves the Vite build from the assets binding, the public API from D1, and cleanup from a cron trigger. The Node server is the old Docker path and still works: it uses Postgres or the Worker's `/internal/*` gateway over HTTP, and serves the Vite build itself.

Shared modules are `src/shared`. `src/app/toolSeoData.ts` is also imported by the Node HTML renderer and must stay free of React and DOM. `src/server/http/public-routes.ts`, `index-html.ts`, `limits-config.ts` and `logger.ts` are also imported by the Worker and must stay free of Node imports. A new shared short-link or HTTP file is invisible to the Worker typecheck until it is added to `tsconfig.worker.json`.

Tool list and paths are `src/app/toolRegistry.ts` and `src/app/toolRoute.ts`. TOTP is `src/features/totp/`. Short-link rules are `src/shared/short-links/`. Public API routes are `src/server/http/public-routes.ts`, shared by Node (`src/server/http/public-app.ts`) and the Worker (`src/worker/http/public-app.ts`). Worker rate limits are counted in D1 by `src/worker/http/d1-rate-limiter.ts`. Backend choice is `src/server/short-links/backend-selector.ts`. The D1 gateway is `src/server/short-links/d1-gateway-client.ts` and `src/worker/short-links/worker.ts`. Limits, cleanup, shutdown, and logs are `src/server/main.ts` and `src/server/http/`. Table shape is `src/shared/short-links/schema.ts` and `src/worker/short-links/migrations/`.
