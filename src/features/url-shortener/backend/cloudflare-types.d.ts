/// <reference types="@cloudflare/workers-types" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

import type { D1Migration } from "cloudflare:test";

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      GATEWAY_TOKEN: string;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
