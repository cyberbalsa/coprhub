import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

// In-memory store to simulate Redis GET/SET with compressed buffers
const store = new Map<string, Buffer>();

// Mock Bun.gzipSync/gunzipSync with a simple prefix for round-trip verification
const GZIP_PREFIX = Buffer.from("GZ:");
const originalBun = globalThis.Bun;
vi.stubGlobal("Bun", {
  ...originalBun,
  gzipSync: (buf: Buffer) => Buffer.concat([GZIP_PREFIX, Buffer.from(buf)]),
  gunzipSync: (buf: Buffer) => Buffer.from(buf).subarray(GZIP_PREFIX.length),
});

vi.mock("ioredis", () => {
  const RedisMock = vi.fn().mockImplementation(() => ({
    status: "ready",
    connect: vi.fn().mockResolvedValue(undefined),
    getBuffer: vi.fn().mockImplementation((key: string) => {
      return Promise.resolve(store.get(key) ?? null);
    }),
    set: vi.fn().mockImplementation((key: string, value: Buffer) => {
      store.set(key, value);
      return Promise.resolve("OK");
    }),
  }));
  return { default: RedisMock };
});

// Import after mocks are set up
const { buildCacheKey, createCacheMiddleware } = await import("./cache.js");

describe("buildCacheKey", () => {
  it("normalizes query params alphabetically", () => {
    const key = buildCacheKey("GET", "/api/projects", "sort=stars&q=rust");
    expect(key).toBe("api:GET:/api/projects?q=rust&sort=stars");
  });

  it("handles no query params", () => {
    const key = buildCacheKey("GET", "/api/projects", "");
    expect(key).toBe("api:GET:/api/projects");
  });

  it("handles single query param", () => {
    const key = buildCacheKey("GET", "/api/stats", "format=json");
    expect(key).toBe("api:GET:/api/stats?format=json");
  });
});

describe("cache middleware", () => {
  let app: Hono;
  let handlerCallCount: number;

  beforeEach(() => {
    store.clear();
    handlerCallCount = 0;

    app = new Hono();
    const middleware = createCacheMiddleware("redis://localhost:6379", {
      excludePaths: ["/api/health"],
      ttl: 300,
    });
    app.use("*", middleware);

    app.get("/api/projects", (c) => {
      handlerCallCount++;
      return c.json({ data: "projects" });
    });

    app.get("/api/health", (c) => {
      handlerCallCount++;
      return c.json({ status: "ok" });
    });

    app.post("/api/projects", (c) => {
      handlerCallCount++;
      return c.json({ created: true });
    });
  });

  it("returns X-Cache: MISS on first request", async () => {
    const res = await app.request("/api/projects");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Cache")).toBe("MISS");
    const body = await res.json();
    expect(body).toEqual({ data: "projects" });
  });

  it("returns X-Cache: HIT on second request (handler only called once)", async () => {
    const first = await app.request("/api/projects");
    expect(first.headers.get("X-Cache")).toBe("MISS");
    await first.arrayBuffer(); // consume body

    const second = await app.request("/api/projects");
    expect(second.status).toBe(200);
    expect(second.headers.get("X-Cache")).toBe("HIT");
    const body = await second.json();
    expect(body).toEqual({ data: "projects" });
    expect(handlerCallCount).toBe(1);
  });

  it("sets Cache-Control headers on cached responses", async () => {
    const res = await app.request("/api/projects");
    const cc = res.headers.get("Cache-Control");
    expect(cc).toContain("public");
    expect(cc).toContain("max-age=");
    expect(cc).toContain("s-maxage=");
    expect(cc).toContain("stale-while-revalidate=3600");
  });

  it("skips caching for excluded paths (sets Cache-Control: no-store)", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Cache")).toBeNull();
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("skips caching for non-GET requests (no X-Cache header)", async () => {
    const res = await app.request("/api/projects", { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Cache")).toBeNull();
  });

  it("does not cache non-200 responses", async () => {
    app.get("/api/missing", (c) => {
      handlerCallCount++;
      return c.json({ error: "not found" }, 404);
    });
    await app.request("/api/missing");
    const res = await app.request("/api/missing");
    expect(res.status).toBe(404);
    expect(handlerCallCount).toBe(2); // handler called both times, not cached
  });
});
