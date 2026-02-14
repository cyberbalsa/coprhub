# COPR Index - Design Document

A Flathub-style web store for Fedora COPR repositories, with search, upstream star counts, and community engagement via Giscus.

## Decisions

| Decision | Choice |
|----------|--------|
| Framework (frontend) | Next.js (TypeScript) |
| Framework (API) | Hono (TypeScript) |
| Database | PostgreSQL 16 |
| Search | PostgreSQL full-text search (tsvector/tsquery) |
| ORM | Drizzle |
| Comments/Ratings | Giscus (GitHub Discussions reactions) |
| Scope | All COPR projects |
| Data sync | Background cron job (6-12 hour intervals) |
| Deployment | Podman Compose (5 containers) |
| Reverse proxy | Cloudflare Tunnel (cloudflared) |
| User system | None (giscus handles GitHub OAuth for comments/reactions) |
| Upstream stars auth | GitHub API key (env var) for 5000 req/hr |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Podman Compose                     │
│                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │  Next.js      │  │  Hono API    │  │ PostgreSQL│ │
│  │  Frontend     │──│  Server      │──│           │ │
│  │  :3000        │  │  :4000       │  │  :5432    │ │
│  └──────────────┘  └──────────────┘  └───────────┘ │
│                          │                    │     │
│                    ┌─────┴──────┐             │     │
│                    │ Sync Worker│─────────────┘     │
│                    │ (cron)     │                    │
│                    └────────────┘                    │
│  ┌──────────────┐                                   │
│  │ cloudflared  │── exposes frontend + API          │
│  └──────────────┘                                   │
└─────────────────────────────────────────────────────┘
         │                  │
         │                  ├── COPR API v3 (read projects/packages)
         │                  ├── GitHub API (star counts, authenticated)
         │                  └── GitLab API (star counts)
         │
         └── Giscus (GitHub Discussions, client-side iframe)
```

Five containers:
1. **frontend** - Next.js app (SSR, serves HTML, calls Hono API internally)
2. **api** - Hono REST server (serves data from PostgreSQL)
3. **postgres** - PostgreSQL 16 database
4. **sync-worker** - Cron job that pulls COPR data and upstream star counts
5. **cloudflared** - Cloudflare Tunnel for exposing services to the internet

The API is designed to also serve a future desktop application.

## Monorepo Structure

```
copr-index/
├── packages/
│   ├── api/              # Hono API server
│   │   ├── src/
│   │   │   ├── index.ts          # Hono app entry
│   │   │   ├── routes/
│   │   │   │   ├── projects.ts   # /api/projects endpoints
│   │   │   │   ├── categories.ts # /api/categories endpoints
│   │   │   │   └── health.ts     # /api/health
│   │   │   └── middleware/
│   │   ├── Dockerfile
│   │   └── package.json
│   ├── frontend/         # Next.js app
│   │   ├── src/
│   │   │   ├── app/              # App Router pages
│   │   │   │   ├── page.tsx              # Homepage
│   │   │   │   ├── search/page.tsx       # Search/browse
│   │   │   │   ├── projects/
│   │   │   │   │   └── [owner]/[name]/page.tsx  # Project detail
│   │   │   │   ├── owners/[owner]/page.tsx      # Owner page
│   │   │   │   └── categories/[slug]/page.tsx   # Category page
│   │   │   ├── components/
│   │   │   │   ├── ProjectCard.tsx
│   │   │   │   ├── SearchBar.tsx
│   │   │   │   ├── GiscusComments.tsx
│   │   │   │   └── ...
│   │   │   └── lib/
│   │   │       └── api-client.ts  # Typed API client
│   │   ├── Dockerfile
│   │   └── package.json
│   ├── sync/             # Sync worker
│   │   ├── src/
│   │   │   ├── index.ts          # Cron scheduler entry
│   │   │   ├── copr-sync.ts      # COPR API sync logic
│   │   │   ├── stars-sync.ts     # GitHub/GitLab star fetching
│   │   │   └── upstream-discovery.ts  # URL extraction from COPR metadata
│   │   ├── Dockerfile
│   │   └── package.json
│   └── shared/           # Shared types & DB schema
│       ├── src/
│       │   ├── schema.ts         # Drizzle ORM schema
│       │   ├── types.ts          # API response types
│       │   └── url-parser.ts     # Upstream URL parsing utilities
│       └── package.json
├── podman-compose.yml
├── .env.example
├── package.json          # Workspace root (pnpm workspaces)
└── tsconfig.base.json
```

## Data Model

### projects table

| Column | Type | Description |
|--------|------|-------------|
| id | serial PK | Internal ID |
| copr_id | integer UNIQUE | ID from COPR API |
| owner | text NOT NULL | COPR username or @group |
| name | text NOT NULL | Project name |
| full_name | text UNIQUE NOT NULL | owner/name |
| description | text | Project description |
| instructions | text | Installation instructions |
| homepage | text | Upstream homepage URL |
| chroots | jsonb | Supported distro versions/arches |
| repo_url | text | COPR repo URL |
| upstream_url | text | Discovered GitHub/GitLab URL |
| upstream_provider | text | 'github', 'gitlab', or null |
| upstream_stars | integer DEFAULT 0 | Star count from upstream |
| upstream_forks | integer DEFAULT 0 | Fork count |
| upstream_description | text | Description from upstream |
| upstream_language | text | Primary language |
| upstream_topics | jsonb | Topics/tags from upstream |
| search_vector | tsvector | Full-text search index |
| last_synced_at | timestamp | Last COPR sync |
| stars_synced_at | timestamp | Last upstream star sync |
| created_at | timestamp DEFAULT now() | First seen |
| updated_at | timestamp DEFAULT now() | Last updated |

UNIQUE constraint on (owner, name).

### packages table

| Column | Type | Description |
|--------|------|-------------|
| id | serial PK | Internal ID |
| project_id | integer FK -> projects | Parent project |
| name | text NOT NULL | RPM package name |
| source_type | text | scm, pypi, rubygems, etc. |
| source_url | text | Clone URL or source reference |

### categories table

| Column | Type | Description |
|--------|------|-------------|
| id | serial PK | Internal ID |
| slug | text UNIQUE NOT NULL | URL-friendly name |
| name | text NOT NULL | Display name |

### project_categories table

| Column | Type |
|--------|------|
| project_id | integer FK -> projects |
| category_id | integer FK -> categories |
| PRIMARY KEY | (project_id, category_id) |

### Indexes

- GIN index on `projects.search_vector`
- B-tree on `projects.upstream_stars DESC`
- B-tree on `projects.full_name`
- B-tree on `projects.owner`
- B-tree on `projects.updated_at DESC`

### Full-text search

A PostgreSQL trigger updates `search_vector` on insert/update:

```sql
search_vector = to_tsvector('english',
  coalesce(name, '') || ' ' ||
  coalesce(owner, '') || ' ' ||
  coalesce(description, '') || ' ' ||
  coalesce(upstream_description, '') || ' ' ||
  coalesce(upstream_language, '')
)
```

Topics from `upstream_topics` jsonb array are also concatenated into the vector.

## API Endpoints

### Projects

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/projects | List/search projects |
| GET | /api/projects/:owner/:name | Single project detail |
| GET | /api/projects/:owner/:name/packages | Packages for a project |

**GET /api/projects** query params:
- `q` - search query (uses tsquery)
- `sort` - `stars` (default), `name`, `updated`
- `order` - `desc` (default), `asc`
- `category` - category slug filter
- `owner` - owner filter
- `language` - language filter
- `page` - page number (default 1)
- `limit` - results per page (default 24, max 100)

Response:
```json
{
  "data": [{ "id": 1, "full_name": "owner/project", "upstream_stars": 1500, ... }],
  "meta": { "page": 1, "limit": 24, "total": 500, "pages": 21 }
}
```

### Categories

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/categories | List all categories |
| GET | /api/categories/:slug | Projects in a category |

### Stats

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/stats | Aggregate stats (total projects, top languages) |

### Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/health | Health check (DB connectivity) |

## Frontend Pages

### Homepage (/)

- Hero section with tagline and search bar
- "Popular" row: projects sorted by upstream stars (horizontal scroll)
- "Recently Updated" row: projects sorted by updated_at
- Category grid tiles

### Search/Browse (/search)

- Search input at top
- Filter sidebar: category, language, sort order
- Responsive grid of ProjectCard components
- Paginated results

### Project Detail (/projects/:owner/:name)

- Project name, owner, upstream star badge
- Description
- Installation instructions with copy-to-clipboard (`dnf copr enable owner/name`)
- Supported Fedora/EPEL versions (chroot badges)
- Upstream repo link with star count
- Package list
- Giscus comment/reaction section at bottom

### Owner Page (/owners/:owner)

- All projects by this owner in card grid

### Category Page (/categories/:slug)

- Projects filtered by category, sortable

## Giscus Integration

- Dedicated GitHub repo for discussions (e.g., `your-org/copr-index-discussions`)
- GitHub Discussions enabled with "Announcements" category
- Giscus app installed on the repo
- `@giscus/react` component on project detail pages
- `data-mapping="pathname"` maps each project page to a Discussion thread
- Reactions enabled (thumbs up, heart, rocket, etc.) serve as ratings
- Theme follows site preference (light/dark)

## Sync Worker

### Phase 1: COPR Sync (every 6 hours)

1. Paginate through COPR API: `GET /api_3/project/search?query=*&limit=100&offset=N`
2. For each project, upsert into `projects` table
3. For each project's packages, fetch via `/api_3/package/list`
4. Attempt upstream URL autodiscovery:
   - Check `homepage` field for GitHub/GitLab URLs
   - Check package `source_dict.clone_url`
   - Parse `description` and `instructions` for URLs
   - Regex: `/https?:\/\/(github\.com|gitlab\.com|gitlab\.[^\/]+)\/([^\s\/]+\/[^\s\/]+)/`

### Phase 2: Star Sync (every 12 hours)

1. Query projects where `upstream_url IS NOT NULL`
2. GitHub repos: `GET https://api.github.com/repos/:owner/:repo` with `Authorization: Bearer $GITHUB_TOKEN`
3. GitLab repos: `GET https://gitlab.com/api/v4/projects/:encoded_path`
4. Update `upstream_stars`, `upstream_forks`, `upstream_language`, `upstream_topics`
5. Rate-limit aware: check `X-RateLimit-Remaining`, sleep when approaching limits

### Category Assignment

After syncing, assign categories based on:
- `upstream_language` maps to language-based categories
- `upstream_topics` keywords map to functional categories (e.g., "editor", "terminal", "game")
- Predefined mapping table from topics to categories

## Deployment (Podman Compose)

```yaml
services:
  postgres:
    image: postgres:16-alpine
    volumes:
      - pgdata:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: copr_index
      POSTGRES_USER: copr
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}

  api:
    build:
      context: .
      dockerfile: packages/api/Dockerfile
    depends_on:
      - postgres
    environment:
      DATABASE_URL: postgresql://copr:${POSTGRES_PASSWORD}@postgres:5432/copr_index
      GITHUB_TOKEN: ${GITHUB_TOKEN}
    ports:
      - "4000:4000"

  frontend:
    build:
      context: .
      dockerfile: packages/frontend/Dockerfile
    depends_on:
      - api
    environment:
      API_URL: http://api:4000
      NEXT_PUBLIC_GISCUS_REPO: ${GISCUS_REPO}
      NEXT_PUBLIC_GISCUS_REPO_ID: ${GISCUS_REPO_ID}
      NEXT_PUBLIC_GISCUS_CATEGORY_ID: ${GISCUS_CATEGORY_ID}
    ports:
      - "3000:3000"

  sync-worker:
    build:
      context: .
      dockerfile: packages/sync/Dockerfile
    depends_on:
      - postgres
    environment:
      DATABASE_URL: postgresql://copr:${POSTGRES_PASSWORD}@postgres:5432/copr_index
      GITHUB_TOKEN: ${GITHUB_TOKEN}
      COPR_SYNC_INTERVAL_HOURS: 6
      STARS_SYNC_INTERVAL_HOURS: 12

  cloudflared:
    image: cloudflare/cloudflared:latest
    command: tunnel run
    environment:
      TUNNEL_TOKEN: ${CLOUDFLARED_TUNNEL_TOKEN}
    depends_on:
      - frontend
      - api

volumes:
  pgdata:
```

## Environment Variables

```env
# PostgreSQL
POSTGRES_PASSWORD=

# GitHub API (for star count fetching, 5000 req/hr authenticated)
GITHUB_TOKEN=

# Giscus (GitHub Discussions)
GISCUS_REPO=org/copr-index-discussions
GISCUS_REPO_ID=R_...
GISCUS_CATEGORY_ID=DIC_...

# Cloudflare Tunnel
CLOUDFLARED_TUNNEL_TOKEN=
```
