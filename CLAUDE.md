# CLAUDE.md - COPR Index

## Project Overview

COPR Index is a Flathub-style web store for Fedora COPR repositories. It indexes all COPR projects, auto-detects upstream GitHub/GitLab repos, fetches star counts, and provides full-text search with Giscus-powered comments.

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

All packages depend on `@copr-index/shared` for schema and types.

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

After first start, initialize the database:
```bash
DATABASE_URL="postgresql://copr:devpassword@localhost:5432/copr_index" \
  bunx drizzle-kit push --config packages/shared/drizzle.config.ts
psql postgresql://copr:devpassword@localhost:5432/copr_index \
  -f packages/shared/drizzle/0001_search_vector.sql
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
- `projects` - COPR projects with upstream metadata and search vector
- `packages` - RPM packages belonging to projects
- `categories` - browsing categories
- `project_categories` - many-to-many junction

Full-text search uses a trigger (`packages/shared/drizzle/0001_search_vector.sql`) that auto-updates `search_vector` on INSERT/UPDATE with weighted fields (A=name, B=owner, C=descriptions, D=language/topics).

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

Runs two cron jobs:
1. **COPR sync** (every 6h) - fetches all projects and packages from COPR API v3
2. **Star sync** (every 12h) - fetches GitHub/GitLab stars for projects with detected upstream URLs

User-Agent for all external API calls: `FedoraCOPRHub/1.0 <Repo: github.com/cyberbalsa/coprhub>`

## Testing

```bash
bun run test                   # All packages
bun --filter @copr-index/api test       # API only
bun --filter @copr-index/sync test      # Sync only
bun --filter @copr-index/shared test    # Shared only
```

Tests use Vitest. API tests use Hono's `app.request()` for in-process testing without a running server.

## Environment Variables

See `.env.example`. Key vars:
- `DATABASE_URL` - PostgreSQL connection string
- `GITHUB_TOKEN` - GitHub API token (optional, increases rate limit for star sync)
- `GISCUS_REPO`, `GISCUS_REPO_ID`, `GISCUS_CATEGORY_ID` - Giscus config
- `CLOUDFLARED_TUNNEL_TOKEN` - Cloudflare tunnel token for production
