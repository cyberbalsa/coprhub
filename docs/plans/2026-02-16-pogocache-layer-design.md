# pogocache Cache Layer Design

## Problem

All COPRHub API endpoints hit PostgreSQL on every request. Data only changes via daily sync jobs (dump-sync every 24h, star-sync every 12h, discourse-sync every 24h), so most queries return identical results for hours. Adding an in-memory cache layer reduces database load and improves response latency.

## Solution

Add pogocache as a cache layer between the Hono API and PostgreSQL, using a single Hono middleware that transparently caches all GET responses. Combine with Cache-Control headers for Cloudflare edge caching.

## Architecture

```
Client → Cloudflare Edge (Cache-Control headers, s-maxage=14400)
       → Hono API → pogocache middleware (Redis/RESP, 4h TTL, zstd compressed)
                   → PostgreSQL (source of truth)
```

Three-tier caching: Cloudflare edge, pogocache in-memory, PostgreSQL.

## Cache Middleware

### Flow

```
GET /api/projects?q=firefox
  1. Normalize URL → key: "api:GET:/api/projects?q=firefox"
  2. Redis GET key
     ├─ HIT  → zstd decompress → return JSON + cache headers
     └─ MISS → run handler → zstd compress → Redis SET (EX 14400) → return + cache headers
```

### Cache Key Format

`api:{method}:{path}?{sorted-query-params}`

Query params sorted alphabetically to normalize equivalent URLs:
- `/api/projects?sort=stars&q=rust` → `api:GET:/api/projects?q=rust&sort=stars`
- `/api/projects?q=rust&sort=stars` → same key

### What Gets Cached

| Endpoint | Cached | Notes |
|----------|--------|-------|
| GET /api/projects | Yes | All filter/sort/page variations |
| GET /api/projects/:owner/:name | Yes | Project detail |
| GET /api/projects/:owner/:name/packages | Yes | Package lists |
| GET /api/projects/:owner/:name/comments | Yes | Fast-path over existing 12h DB cache |
| GET /api/categories | Yes | Category list with counts |
| GET /api/categories/:slug | Yes | Per-category project lists |
| GET /api/stats | Yes | Aggregate statistics |
| GET /api/health | No | Must be live |
| GET /api/openapi.json | No | Static, already in memory |
| GET /api (Swagger UI) | No | HTML page |

### Cache Headers

Cached responses:
```
Cache-Control: public, max-age=14400, s-maxage=14400, stale-while-revalidate=3600
X-Cache: HIT | MISS
```

- `max-age=14400` — 4h browser cache
- `s-maxage=14400` — 4h Cloudflare edge cache
- `stale-while-revalidate=3600` — serve stale 1h while revalidating
- `X-Cache` — debug header

Health endpoint:
```
Cache-Control: no-store
```

### Compression

JSON responses are zstd-compressed before storing in pogocache:
- Reduces memory usage (JSON compresses ~80-90%)
- zstd is fast enough for real-time compress/decompress
- Library: `@napi-rs/zstd` (native binding)

### Graceful Degradation

If pogocache is unreachable, the middleware catches the error and falls through to the handler. The API continues working without cache — no crash, no error response.

## Deployment

### Podman Compose

Add pogocache as a 6th container:

```yaml
pogocache:
  image: docker.io/tidwall/pogocache:latest
  ports:
    - "6379:6379"
  restart: unless-stopped
```

API connects via `pogocache:6379` on the compose network.

### Cache Invalidation

TTL-only — no active invalidation. Cache entries expire after 4h. Sync jobs don't interact with the cache. Given daily sync intervals, 4h staleness is acceptable.

## Dependencies

- `ioredis` — Redis client for pogocache RESP protocol
- `@napi-rs/zstd` — native zstd compression

## Files

| File | Action | Purpose |
|------|--------|---------|
| `packages/api/src/cache.ts` | Create | Redis client, zstd helpers, Hono cache middleware |
| `packages/api/src/index.ts` | Modify | Mount cache middleware in chain |
| `docker-compose.yml` | Modify | Add pogocache service |
| `packages/api/package.json` | Modify | Add ioredis, @napi-rs/zstd dependencies |
