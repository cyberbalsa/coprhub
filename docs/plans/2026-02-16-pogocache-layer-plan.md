# pogocache Cache Layer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a pogocache-backed response cache to the Hono API with zstd compression and Cloudflare edge cache headers.

**Architecture:** A single Hono middleware checks pogocache (via Redis/RESP protocol) before running handlers. Responses are zstd-compressed and stored with a 4h TTL. Cache-Control headers enable Cloudflare edge caching. If pogocache is unavailable, the API falls through to PostgreSQL transparently.

**Tech Stack:** pogocache (Redis protocol), ioredis, @napi-rs/zstd, Hono middleware

**Design Doc:** `docs/plans/2026-02-16-pogocache-layer-design.md`

---

### Task 1: Add pogocache service to Podman Compose

**Files:**
- Modify: `podman-compose.yml:64` (before `cloudflared` service)
- Modify: `.env.example` (add `CACHE_URL`)

**Step 1: Add pogocache service to podman-compose.yml**

Add the `pogocache` service before `cloudflared` and add `CACHE_URL` env var to the `api` service:

```yaml
# In podman-compose.yml, add after sync-worker and before cloudflared:

  pogocache:
    image: docker.io/tidwall/pogocache:latest
    restart: unless-stopped

# In the api service environment section, add:
      CACHE_URL: redis://pogocache:6379
```

The `api` service should also get `depends_on: pogocache` (no healthcheck needed — the middleware degrades gracefully).

**Step 2: Add CACHE_URL to .env.example**

```
CACHE_URL=redis://localhost:6379
```

**Step 3: Commit**

```bash
git add podman-compose.yml .env.example
git commit -m "infra: add pogocache service to podman compose"
```

---

### Task 2: Install dependencies

**Files:**
- Modify: `packages/api/package.json`

**Step 1: Install ioredis and @napi-rs/zstd**

Run from the repo root:

```bash
cd /home/balsa/Documents/Projects/copr-index && ~/.bun/bin/bun add --cwd packages/api ioredis @napi-rs/zstd
```

**Step 2: Install dev types for ioredis**

ioredis ships its own types, so no `@types/ioredis` needed. Verify by checking that `packages/api/package.json` now lists both deps.

**Step 3: Commit**

```bash
git add packages/api/package.json bun.lock
git commit -m "deps: add ioredis and @napi-rs/zstd to api package"
```

---

### Task 3: Write failing test for cache middleware

**Files:**
- Create: `packages/api/src/cache.test.ts`

**Step 1: Write the test file**

This test creates a minimal Hono app with the cache middleware and verifies caching behavior. It mocks Redis to avoid needing a running pogocache instance.

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

// Mock ioredis before importing cache module
vi.mock("ioredis", () => {
  const store = new Map<string, Buffer>();
  const MockRedis = vi.fn().mockImplementation(() => ({
    getBuffer: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: Buffer, flag: string, ttl: number) => {
      store.set(key, value);
      return "OK";
    }),
    quit: vi.fn(),
    status: "ready",
    _store: store,
  }));
  return { default: MockRedis };
});

import { createCacheMiddleware, buildCacheKey } from "./cache.js";

describe("buildCacheKey", () => {
  it("normalizes query params alphabetically", () => {
    const key = buildCacheKey("GET", "/api/projects", "sort=stars&q=rust");
    expect(key).toBe("api:GET:/api/projects?q=rust&sort=stars");
  });

  it("handles no query params", () => {
    const key = buildCacheKey("GET", "/api/stats", "");
    expect(key).toBe("api:GET:/api/stats");
  });

  it("handles single query param", () => {
    const key = buildCacheKey("GET", "/api/projects", "q=firefox");
    expect(key).toBe("api:GET:/api/projects?q=firefox");
  });
});

describe("cache middleware", () => {
  let app: Hono;
  let handlerCallCount: number;

  beforeEach(async () => {
    // Clear the mock store
    const ioredis = await import("ioredis");
    const redis = new ioredis.default();
    (redis as any)._store.clear();

    handlerCallCount = 0;
    app = new Hono();
    app.use("/api/*", createCacheMiddleware("redis://localhost:6379", {
      excludePaths: ["/api/health"],
    }));
    app.get("/api/projects", (c) => {
      handlerCallCount++;
      return c.json({ data: [{ name: "test" }] });
    });
    app.get("/api/health", (c) => {
      handlerCallCount++;
      return c.json({ status: "ok" });
    });
  });

  it("returns X-Cache: MISS on first request", async () => {
    const res = await app.request("/api/projects");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Cache")).toBe("MISS");
    expect(handlerCallCount).toBe(1);
  });

  it("returns X-Cache: HIT on second request", async () => {
    await app.request("/api/projects");
    const res = await app.request("/api/projects");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Cache")).toBe("HIT");
    expect(handlerCallCount).toBe(1); // handler only called once
  });

  it("sets Cache-Control headers on cached responses", async () => {
    const res = await app.request("/api/projects");
    const cc = res.headers.get("Cache-Control");
    expect(cc).toContain("public");
    expect(cc).toContain("max-age=14400");
    expect(cc).toContain("s-maxage=14400");
  });

  it("skips caching for excluded paths", async () => {
    const res = await app.request("/api/health");
    expect(res.headers.get("X-Cache")).toBeNull();
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("skips caching for non-GET requests", async () => {
    app.post("/api/projects", (c) => c.json({ ok: true }));
    const res = await app.request("/api/projects", { method: "POST" });
    expect(res.headers.get("X-Cache")).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /home/balsa/Documents/Projects/copr-index && ~/.bun/bin/bun --filter @coprhub/api test`

Expected: FAIL — `./cache.js` module does not exist yet.

---

### Task 4: Implement cache module

**Files:**
- Create: `packages/api/src/cache.ts`

**Step 1: Write the cache module**

```typescript
import Redis from "ioredis";
import { compress, decompress } from "@napi-rs/zstd";
import type { MiddlewareHandler } from "hono";

const DEFAULT_TTL = 14400; // 4 hours in seconds
const CACHE_CONTROL = "public, max-age=14400, s-maxage=14400, stale-while-revalidate=3600";

export function buildCacheKey(method: string, path: string, queryString: string): string {
  const sorted = queryString
    ? "?" + queryString.split("&").sort().join("&")
    : "";
  return `api:${method}:${path}${sorted}`;
}

export function createCacheMiddleware(
  redisUrl: string,
  options?: { excludePaths?: string[]; ttl?: number }
): MiddlewareHandler {
  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    retryStrategy: () => null, // don't retry — degrade gracefully
  });
  redis.connect().catch(() => {}); // suppress connection error

  const excludePaths = options?.excludePaths ?? [];
  const ttl = options?.ttl ?? DEFAULT_TTL;

  return async (c, next) => {
    // Only cache GET requests
    if (c.req.method !== "GET") {
      await next();
      return;
    }

    const path = new URL(c.req.url).pathname;

    // Skip excluded paths (health, swagger, openapi)
    if (excludePaths.some((p) => path === p || path.startsWith(p + "/"))) {
      await next();
      c.header("Cache-Control", "no-store");
      return;
    }

    const queryString = new URL(c.req.url).search.slice(1); // remove leading ?
    const key = buildCacheKey(c.req.method, path, queryString);

    // Try cache
    try {
      const cached = await redis.getBuffer(key);
      if (cached) {
        const json = await decompress(cached);
        c.header("Cache-Control", CACHE_CONTROL);
        c.header("X-Cache", "HIT");
        c.header("Content-Type", "application/json; charset=UTF-8");
        return c.body(json);
      }
    } catch {
      // Redis down — fall through to handler
    }

    // Cache miss — run handler
    await next();

    // Store response in cache
    try {
      const body = await c.res.arrayBuffer();
      const bodyBytes = Buffer.from(body);
      const compressed = await compress(bodyBytes);

      // Don't await — fire and forget
      redis.set(key, Buffer.from(compressed), "EX", ttl).catch(() => {});

      // Rebuild response with cache headers
      c.res = new Response(bodyBytes, {
        status: c.res.status,
        headers: c.res.headers,
      });
    } catch {
      // Compression or response read error — serve original response
    }

    c.header("Cache-Control", CACHE_CONTROL);
    c.header("X-Cache", "MISS");
  };
}
```

**Step 2: Run tests to verify they pass**

Run: `cd /home/balsa/Documents/Projects/copr-index && ~/.bun/bin/bun --filter @coprhub/api test`

Expected: All 7 tests PASS.

**Step 3: Commit**

```bash
git add packages/api/src/cache.ts packages/api/src/cache.test.ts
git commit -m "feat(api): add pogocache middleware with zstd compression"
```

---

### Task 5: Mount middleware in API entry point

**Files:**
- Modify: `packages/api/src/index.ts:14-15` (after logger and cors, before routes)

**Step 1: Add cache middleware to the Hono app**

Import and mount the middleware after `cors()` and before the route mounts. The middleware is only activated when `CACHE_URL` is set — without it, the API runs uncached (same as current behavior).

```typescript
// In packages/api/src/index.ts, add after line 10:
import { createCacheMiddleware } from "./cache.js";

// After the cors() middleware (line 15), add:
if (process.env.CACHE_URL) {
  app.use(
    "/api/*",
    createCacheMiddleware(process.env.CACHE_URL, {
      excludePaths: ["/api/health", "/api/openapi.json"],
    })
  );
}
```

The full file should look like:

```typescript
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { swaggerUI } from "@hono/swagger-ui";
import { createHealthRouter } from "./routes/health.js";
import { createProjectsRouter } from "./routes/projects.js";
import { createCategoriesRouter } from "./routes/categories.js";
import { createStatsRouter } from "./routes/stats.js";
import { openApiSpec } from "./openapi.js";
import { db } from "./db.js";
import { createCacheMiddleware } from "./cache.js";

export const app = new Hono();

app.use("*", logger());
app.use("*", cors());

if (process.env.CACHE_URL) {
  app.use(
    "/api/*",
    createCacheMiddleware(process.env.CACHE_URL, {
      excludePaths: ["/api/health", "/api/openapi.json"],
    })
  );
}

// OpenAPI spec and Swagger UI
app.get("/api/openapi.json", (c) => c.json(openApiSpec));
app.get("/api", swaggerUI({ url: "/api/openapi.json" }));

app.route("/api/health", createHealthRouter(db));
app.route("/api/projects", createProjectsRouter(db));
app.route("/api/categories", createCategoriesRouter(db));
app.route("/api/stats", createStatsRouter(db));

if (process.env.NODE_ENV !== "test") {
  const { serve } = await import("@hono/node-server");
  const port = parseInt(process.env.PORT || "4000", 10);
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`API server running on http://localhost:${info.port}`);
  });
}
```

**Step 2: Run all existing tests to verify nothing broke**

Run: `cd /home/balsa/Documents/Projects/copr-index && ~/.bun/bin/bun --filter @coprhub/api test`

Expected: All tests PASS (cache middleware is not activated in tests since `CACHE_URL` is not set).

**Step 3: Commit**

```bash
git add packages/api/src/index.ts
git commit -m "feat(api): mount pogocache middleware in API entry point"
```

---

### Task 6: Verify full stack works with Podman Compose

**Step 1: Rebuild and restart the stack**

```bash
cd /home/balsa/Documents/Projects/copr-index && podman-compose build api && podman-compose up -d
```

**Step 2: Verify pogocache is running**

```bash
podman-compose ps
```

Expected: `pogocache` container is running.

**Step 3: Test cache behavior**

```bash
# First request — should be MISS
curl -s -I http://localhost:4000/api/stats | grep -E "X-Cache|Cache-Control"

# Second request — should be HIT
curl -s -I http://localhost:4000/api/stats | grep -E "X-Cache|Cache-Control"

# Health endpoint — should have no-store, no X-Cache
curl -s -I http://localhost:4000/api/health | grep -E "X-Cache|Cache-Control"
```

Expected:
- First request: `X-Cache: MISS`, `Cache-Control: public, max-age=14400, s-maxage=14400, stale-while-revalidate=3600`
- Second request: `X-Cache: HIT`, same Cache-Control
- Health: `Cache-Control: no-store`, no X-Cache header

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(api): complete pogocache cache layer integration"
```
