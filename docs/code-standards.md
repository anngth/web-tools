# Code standards

Match the file you are editing. This page records only the constraints that are easy to miss.

- TypeScript is strict and ESM. Imports are relative. There are no path aliases. Some imports use a `.ts` suffix and some do not. Copy the directory you are in.
- There is no ESLint or Prettier config. Do not reformat unrelated files.
- Tests sit next to the source. Scripts are in `package.json`.
- Browser code does not import `src/server` or `src/worker`. Worker code does not import Node or `src/server`.
- Short-link behavior that both stores need goes in `src/shared/short-links/`, not in the gateway client or the Worker route.
- `POSTGRES_TEST_URL` runs a contract that deletes rows from `short_links`. Do not point it at the application database. See `src/server/short-links/postgres-store.test.ts`.
- A new browser tool needs a feature folder, a `ToolId`, an entry in the tools array, and `toolSeoData`. The id must not collide with the reserved paths in `src/app/toolRoute.ts`.
