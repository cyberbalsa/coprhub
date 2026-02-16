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
- **Deployment:** Podman Compose (5 containers: postgres, api, frontend, sync-worker, cloudflared)

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

## Database

Schema defined in `packages/shared/src/schema.ts`. Four tables:
- `projects` - COPR projects with upstream metadata, search vector, and `last_build_at`
- `packages` - RPM packages belonging to projects
- `categories` - browsing categories
- `project_categories` - many-to-many junction

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
- `GET /api/projects` - List/search projects (params: q, sort, category, owner, page, limit)
- `GET /api/projects/:owner/:name` - Project detail with packages
- `GET /api/categories` - All categories with project counts
- `GET /api/categories/:slug` - Single category info
- `GET /api/stats` - Index statistics
- `GET /api/health` - Health check

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
- `CLOUDFLARED_TUNNEL_TOKEN` - Cloudflare tunnel token for production
