import type { MiddlewareHandler } from "hono";
import Redis from "ioredis";

/**
 * Build a normalized cache key from request components.
 * Query params are sorted alphabetically to ensure equivalent URLs produce the same key.
 */
export function buildCacheKey(
  method: string,
  path: string,
  queryString: string,
): string {
  let key = `api:${method}:${path}`;

  if (queryString) {
    const params = new URLSearchParams(queryString);
    const sorted = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("&");
    if (sorted) {
      key += `?${sorted}`;
    }
  }

  return key;
}

interface CacheOptions {
  /** Paths to exclude from caching (they get Cache-Control: no-store) */
  excludePaths?: string[];
  /** TTL in seconds (default: 14400 = 4 hours) */
  ttl?: number;
}

/**
 * Create a Hono cache middleware backed by Redis with gzip compression.
 * Gracefully degrades if Redis is unreachable.
 */
export function createCacheMiddleware(
  redisUrl: string,
  options?: CacheOptions,
): MiddlewareHandler {
  const ttl = options?.ttl ?? 14400;
  const excludePaths = options?.excludePaths ?? [];

  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    enableReadyCheck: false, // pogocache doesn't support INFO command
    retryStrategy: () => null,
  });

  redis.connect().catch(() => {});

  return async (c, next) => {
    const method = c.req.method;
    const url = new URL(c.req.url);
    const path = url.pathname;

    // Skip non-GET requests entirely
    if (method !== "GET") {
      await next();
      return;
    }

    // Skip excluded paths
    if (excludePaths.some((p) => path === p || path.startsWith(p + "/"))) {
      await next();
      c.res.headers.set("Cache-Control", "no-store");
      return;
    }

    const cacheKey = buildCacheKey(method, path, url.search.slice(1));
    const cacheControl = `public, max-age=${ttl}, s-maxage=${ttl}, stale-while-revalidate=3600`;

    // Try cache HIT
    try {
      if (redis.status === "ready") {
        const cached = await redis.getBuffer(cacheKey);
        if (cached) {
          const decompressed = Bun.gunzipSync(cached);
          c.res = new Response(decompressed, {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": cacheControl,
              "X-Cache": "HIT",
            },
          });
          return;
        }
      }
    } catch {
      // Redis error — fall through to handler
    }

    // Cache MISS — run handler
    await next();

    // Only cache successful responses (2xx status codes)
    if (c.res.status < 200 || c.res.status >= 300) {
      c.header("X-Cache", "MISS");
      c.header("Cache-Control", cacheControl);
      return;
    }

    // Read the response body, compress, and store
    try {
      const bodyBytes = await c.res.arrayBuffer();
      const bodyBuffer = Buffer.from(bodyBytes);

      // Rebuild the response since reading arrayBuffer consumes it
      c.res = new Response(bodyBuffer, {
        status: c.res.status,
        headers: c.res.headers,
      });

      c.res.headers.set("X-Cache", "MISS");
      c.res.headers.set("Cache-Control", cacheControl);

      // Compress and store in Redis (fire-and-forget)
      if (redis.status === "ready") {
        try {
          const compressed = Bun.gzipSync(bodyBuffer);
          redis.set(cacheKey, Buffer.from(compressed), "EX", ttl).catch(() => {});
        } catch {
          // Compression failed — skip caching
        }
      }
    } catch {
      // If response body reading fails, just continue
    }
  };
}
