# CLAUDE.md - COPRHub

## Project Overview

COPRHub (coprhub.org) is a Flathub-style web store for Fedora COPR repositories. It indexes all COPR projects, auto-detects upstream GitHub/GitLab repos, fetches star counts, and provides full-text search with Giscus-powered comments.

## Tech Stack

- **Runtime:** Bun (package manager + runtime for API/sync)
- **Language:** TypeScript (strict, ES2022, bundler module resolution)
- **API:** Hono on port 4000 with OpenAPI 3.1.0 / Swagger UI at `/api`
- **Frontend:** Next.js 15 App Router on port 3000 (standalone output)
- **Database:** PostgreSQL 16 with Drizzle ORM
- **Search:** PostgreSQL tsvector with weighted fields + GIN index
- **Comments:** Giscus (GitHub Discussions)
- **Testing:** Vitest
- **Cache:** pogocache (Redis/RESP protocol) with gzip compression
- **Deployment:** Podman Compose (6 containers: postgres, pogocache, api, frontend, sync-worker, cloudflared)

## Monorepo Structure

```
packages/
  shared/    - Drizzle schema, types, DB connection, URL parser (the foundation)
  api/       - Hono REST API server
  frontend/  - Next.js SSR frontend
  sync/      - COPR + GitHub/GitLab sync worker (cron-based)
```

All packages depend on `@coprhub/shared` for schema and types.

## Common Commands

```bash
bun install                    # Install all dependencies
bun run test                   # Run all tests across packages
bun run dev:api                # Dev API server (port 4000)
bun run dev:frontend           # Dev frontend (port 3000)
bun run build                  # Build all packages
bun run db:generate            # Generate Drizzle migrations
bun run db:migrate             # Push Drizzle schema to DB
```

### Podman Compose

```bash
podman-compose build           # Build all container images
podman-compose up -d           # Start full stack
podman-compose logs -f <svc>   # Follow logs (api, frontend, sync-worker, postgres)
podman-compose down            # Stop everything
```

After first start, initialize the database (run inside containers):
```bash
# Push the Drizzle schema
podman exec -w /app/packages/shared copr-index_api_1 \
  bunx drizzle-kit push --config drizzle.config.ts

# Apply the full-text search migration
podman exec -i copr-index_postgres_1 \
  psql -U copr -d coprhub < packages/shared/drizzle/0001_search_vector.sql
```

## Key Architectural Decisions

- **No user system** - comments/reactions via Giscus (GitHub OAuth built in)
- **COPR API uses `/api_3/project/list`** - not `/project/search` (search requires 3+ char query)
- **Upstream auto-detection** - parses GitHub/GitLab URLs from homepage, description, instructions, and package clone_url fields
- **All frontend pages use `export const dynamic = "force-dynamic"`** - prevents static prerender at build time (API not available during Docker build)
- **Podman requires fully qualified image names** - always use `docker.io/` prefix
- **Bun workspaces** - all workspace `package.json` files must be copied in every Dockerfile for `--frozen-lockfile` to work
- **Three-tier caching** - Cloudflare edge (Cache-Control headers) → pogocache (in-memory, 4h TTL) → PostgreSQL (source of truth)

## Database

Schema defined in `packages/shared/src/schema.ts`. Six tables:
- `projects` - COPR projects with upstream metadata, search vector, and `last_build_at`
- `packages` - RPM packages belonging to projects
- `categories` - browsing categories
- `project_categories` - many-to-many junction
- `sync_jobs` - Tracks last completion time and duration per sync job
- `discourse_cache` - Caches Discourse API responses per project (12h TTL)

Full-text search uses a trigger (`packages/shared/drizzle/0001_search_vector.sql`) that auto-updates `search_vector` on INSERT/UPDATE with weighted fields (A=name, B=owner, C=descriptions, D=language/topics).

### Popularity Score

Popularity score is a weighted sum of stars, votes, downloads, repo enables, and discourse metrics, multiplied by a **staleness decay** based on `last_build_at`:
- **7-day grace period** — no penalty for recently built projects
- **Exponential decay** — `max(0.05, exp(-3.0 * (days - 7) / 83))` after grace period
- **95% cap at 90 days** — dormant projects retain only 5% of their base score
- **NULL `last_build_at`** — no penalty (build date unknown)

Constants and formula defined in `packages/sync/src/popularity.ts`. SQL equivalents exist in `recomputeAllPopularityScores()` and inline in `dump-sync.ts`.

## API Endpoints

All routes prefixed with `/api`:
- `GET /api` - Swagger UI
- `GET /api/openapi.json` - OpenAPI 3.1.0 spec
- `GET /api/cf` - Cloudflare API Shield-compatible OpenAPI 3.0.0 spec (auto-converted from 3.1.0)
- `GET /api/projects` - List/search projects (see filtering/sorting below)
- `GET /api/projects/:owner/:name` - Project detail (all DB fields exposed)
- `GET /api/projects/:owner/:name/packages` - RPM packages for a project
- `GET /api/projects/:owner/:name/comments` - Discourse comments (cached 12h)
- `GET /api/categories` - All categories with project counts
- `GET /api/categories/:slug` - Projects in a category
- `GET /api/stats` - Index statistics
- `GET /api/health` - Health check with sync job status and data freshness

### Project List Filtering

All text filters support ILIKE wildcards (`*` → `%`). Without `*`, exact match is used.

**Filter params:** `q` (full-text), `owner`, `name`, `fullName`, `language`, `provider`, `description`, `instructions`, `homepage`, `upstreamUrl`, `upstreamDescription`, `upstreamReadme`, `category` (slug, join-based)

**Sort params (24 values):** `id`, `coprId`, `popularity` (default), `stars`, `forks`, `votes`, `downloads`, `enables`, `likes`, `views`, `replies`, `discourseTopicId`, `name`, `owner`, `language`, `provider`, `updated`, `created`, `lastBuild`, `lastSynced`, `starsSynced`, `readmeSynced`, `votesSynced`, `discourseSynced`

**Pagination:** `page` (default 1), `limit` (default 24, max 100), `order` (`asc`/`desc`, default `desc`)

## Response Cache

A Hono middleware (`packages/api/src/cache.ts`) caches all GET API responses in pogocache via the Redis/RESP protocol with gzip compression.

- **TTL:** 4 hours (14400 seconds) — no active invalidation, TTL-only expiry
- **Cache key:** `api:GET:{path}?{sorted-query-params}` — query params sorted alphabetically for normalization
- **Compression:** Bun built-in `gzipSync`/`gunzipSync` (native `@napi-rs/zstd` doesn't work in Bun Docker containers)
- **Headers:** `Cache-Control: public, max-age=14400, s-maxage=14400, stale-while-revalidate=3600` + `X-Cache: HIT|MISS`
- **Excluded:** `/api/health`, `/api/openapi.json`, and `/api/cf` get `Cache-Control: no-store`
- **Non-2xx responses are never cached** — only successful responses are stored
- **Graceful degradation:** if pogocache is down, requests fall through to PostgreSQL transparently
- **Conditional activation:** middleware only mounts when `CACHE_URL` env var is set (tests run without cache)

### pogocache Gotchas

- Image is `docker.io/pogocache/pogocache` (not `tidwall/pogocache`)
- All protocols (RESP, HTTP, Memcache, Postgres) share **port 9401** (not 6379)
- Default bind is `127.0.0.1` — use `-h 0.0.0.0` in Docker for container networking
- Does not support Redis `INFO` command — set `enableReadyCheck: false` in ioredis

## Sync Worker

Runs three sync jobs on configurable intervals:
1. **Dump sync** (every 24h) - imports COPR database dump with all projects, packages, votes, downloads, and last build dates; recomputes popularity scores with staleness decay
2. **Star sync** (every 12h) - fetches GitHub/GitLab stars for projects with detected upstream URLs
3. **Discourse sync** (every 24h) - fetches Discourse topic stats (likes, views, replies)

All sync workers have per-project or job-level TTL checks — on restart, they skip recently-synced work instead of re-fetching everything.

User-Agent for all external API calls: `COPRHub/1.0 (https://coprhub.org; github.com/cyberbalsa/coprhub)`

## Testing

```bash
bun run test                   # All packages
bun --filter @coprhub/api test       # API only
bun --filter @coprhub/sync test      # Sync only
bun --filter @coprhub/shared test    # Shared only
```

Tests use Vitest. API tests use Hono's `app.request()` for in-process testing without a running server.

## Environment Variables

See `.env.example`. Key vars:
- `DATABASE_URL` - PostgreSQL connection string
- `GITHUB_TOKEN` - GitHub API token (optional, increases rate limit for star sync)
- `GISCUS_REPO`, `GISCUS_REPO_ID`, `GISCUS_CATEGORY_ID` - Giscus config
- `DUMP_SYNC_TTL_HOURS` - Hours before dump sync can re-run (default: matches interval)
- `STARS_SYNC_TTL_HOURS` - Hours before per-project star sync repeats (default: matches interval)
- `DISCOURSE_SYNC_TTL_HOURS` - Hours before per-project discourse sync repeats (default: matches interval)
- `FORCE_SYNC` - Set to `true` to bypass all TTL checks
- `CACHE_URL` - Redis URL for pogocache (e.g., `redis://localhost:9401`; omit to disable caching)
- `CLOUDFLARED_TUNNEL_TOKEN` - Cloudflare tunnel token for production
