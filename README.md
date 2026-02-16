# COPRHub

A Flathub-style web store for [Fedora COPR](https://copr.fedorainfracloud.org/) repositories. Browse, search, and discover COPR packages with upstream GitHub/GitLab integration, star counts, and community comments.

**Website:** [coprhub.org](https://coprhub.org)

## Features

- **Full-text search** across project names, descriptions, owners, and upstream metadata
- **Upstream auto-detection** - automatically discovers GitHub/GitLab repos from COPR project metadata
- **Star counts** - fetches and displays GitHub/GitLab stars for upstream repos
- **Community comments** - powered by [Giscus](https://giscus.app/) (GitHub Discussions)
- **RESTful API** with OpenAPI 3.1.0 spec and Swagger UI
- **Periodic sync** - automatically indexes new COPR projects every 6 hours

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌──────────────┐
│  Frontend   │────>│   API       │────>│  PostgreSQL  │
│  Next.js    │     │   Hono      │     │              │
│  :3000      │     │   :4000     │     │   :5432      │
└─────────────┘     └─────────────┘     └──────────────┘
                                              ^
                    ┌─────────────┐            │
                    │ Sync Worker │────────────┘
                    │ (cron)      │
                    └─────────────┘
```

| Package | Description |
|---------|-------------|
| `packages/shared` | Drizzle schema, types, DB connection, URL parser |
| `packages/api` | Hono REST API with Swagger UI |
| `packages/frontend` | Next.js 15 App Router SSR frontend |
| `packages/sync` | COPR and GitHub/GitLab sync worker |

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) (package manager and runtime)
- [Podman](https://podman.io/) and [podman-compose](https://github.com/containers/podman-compose) (deployment)

### Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/cyberbalsa/coprhub.git
   cd coprhub
   ```

2. Copy the environment file and configure:
   ```bash
   cp .env.example .env
   # Edit .env with your values
   ```

3. Start the full stack:
   ```bash
   podman-compose up -d
   ```

4. Initialize the database (first time only):
   ```bash
   # Push the Drizzle schema (run inside API container)
   podman exec -w /app/packages/shared copr-index_api_1 \
     bunx drizzle-kit push --config drizzle.config.ts

   # Apply the full-text search migration
   podman exec -i copr-index_postgres_1 \
     psql -U copr -d coprhub < packages/shared/drizzle/0001_search_vector.sql
   ```

5. The sync worker starts automatically and begins indexing COPR projects. Access the site at:
   - **Frontend:** http://localhost:3000
   - **API / Swagger UI:** http://localhost:4000/api

### Local Development

```bash
bun install                  # Install dependencies
bun run dev:api              # Start API dev server (port 4000)
bun run dev:frontend         # Start frontend dev server (port 3000)
bun run test                 # Run all tests
```

## API

Interactive API documentation is available at `/api` (Swagger UI). The OpenAPI 3.1.0 spec is at `/api/openapi.json`.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects` | List/search projects |
| `GET` | `/api/projects/:owner/:name` | Project detail with packages |
| `GET` | `/api/categories` | All categories with counts |
| `GET` | `/api/categories/:slug` | Single category |
| `GET` | `/api/stats` | Index statistics |
| `GET` | `/api/health` | Health check |

#### Search Parameters

`GET /api/projects` accepts:
- `q` - Full-text search query
- `sort` - Sort by: `stars`, `recent`, `name` (default: `stars`)
- `category` - Filter by category slug
- `owner` - Filter by COPR owner
- `page` - Page number (default: 1)
- `limit` - Results per page (default: 24, max: 100)

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `POSTGRES_PASSWORD` | Yes | PostgreSQL password |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `GITHUB_TOKEN` | No | GitHub API token (increases rate limit for star sync) |
| `GISCUS_REPO` | No | GitHub repo for Giscus comments (e.g., `user/repo`) |
| `GISCUS_REPO_ID` | No | Giscus repo ID |
| `GISCUS_CATEGORY_ID` | No | Giscus category ID |
| `CLOUDFLARED_TUNNEL_TOKEN` | No | Cloudflare tunnel token for production exposure |

## Tech Stack

- **Runtime:** [Bun](https://bun.sh/)
- **API:** [Hono](https://hono.dev/) with OpenAPI/Swagger
- **Frontend:** [Next.js 15](https://nextjs.org/) (App Router, SSR)
- **Database:** [PostgreSQL 16](https://www.postgresql.org/) with full-text search
- **ORM:** [Drizzle](https://orm.drizzle.team/)
- **Comments:** [Giscus](https://giscus.app/)
- **Testing:** [Vitest](https://vitest.dev/)
- **Containers:** [Podman Compose](https://github.com/containers/podman-compose)

## License

MIT
