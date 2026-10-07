# System architecture

Where the code lives. Open the file for the rule.

Three runtimes, and they do not import each other. The browser starts at `src/main.tsx` (`tsconfig.json` excludes `src/server` and `src/worker`). Node starts at `src/server/main.ts` (`tsconfig.node.json`). The Worker starts at `src/worker/short-links/worker.ts` (`tsconfig.worker.json` lists files explicitly).

The browser talks to Node. Node uses Postgres or, when selected, the Worker over HTTP. Node also serves the Vite build.

Shared modules are `src/shared`. `src/app/toolSeoData.ts` is also imported by the Node HTML renderer and must stay free of React and DOM. A new shared short-link or HTTP file is invisible to the Worker typecheck until it is added to `tsconfig.worker.json`.

Tool list and paths are `src/app/toolRegistry.ts` and `src/app/toolRoute.ts`. TOTP is `src/features/totp/`. Short-link rules are `src/shared/short-links/`. Public HTTP is `src/server/http/public-app.ts`. Backend choice is `src/server/short-links/backend-selector.ts`. The D1 gateway is `src/server/short-links/d1-gateway-client.ts` and `src/worker/short-links/worker.ts`. Limits, cleanup, shutdown, and logs are `src/server/main.ts` and `src/server/http/`. Table shape is `src/shared/short-links/schema.ts` and `src/worker/short-links/migrations/`.
