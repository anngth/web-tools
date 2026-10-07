# Project overview

Index only. Behavior lives in the source files named here.

Web Tools is a React toolbox served by one Node process. The tool list is `src/app/toolRegistry.ts`. Paths are `src/app/toolRoute.ts`. There is no account system and no router library.

TOTP lives in `src/features/totp/` and runs in the browser. The URL shortener lives in `src/features/url-shortener/`, with the short-link code under `src/shared`, `src/server`, and `src/worker`.

`.agents/` is agent workflow material, not the application.

See [system architecture](system-architecture.md) and [code standards](code-standards.md).
