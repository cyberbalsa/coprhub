# COPR Index Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Flathub-style web store for Fedora COPR repositories with search, upstream GitHub/GitLab star counts, and Giscus-powered comments/reactions.

**Architecture:** Separate Hono REST API + Next.js frontend + PostgreSQL + sync worker, all in a pnpm monorepo deployed via Podman Compose with Cloudflare Tunnel. Shared Drizzle schema and TypeScript types across packages.

**Tech Stack:** TypeScript, Hono, Next.js (App Router), PostgreSQL 16, Drizzle ORM, Giscus, Vitest, pnpm workspaces, Podman Compose.

**Design Doc:** `docs/plans/2026-02-14-copr-index-design.md`

---

## Task 1: Initialize Monorepo

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/api/package.json`
- Create: `packages/api/tsconfig.json`
- Create: `packages/frontend/package.json`
- Create: `packages/frontend/tsconfig.json`
- Create: `packages/sync/package.json`
- Create: `packages/sync/tsconfig.json`

**Step 1: Create root workspace config**

`package.json`:
```json
{
  "name": "copr-index",
  "private": true,
  "scripts": {
    "dev:api": "pnpm --filter @copr-index/api dev",
    "dev:frontend": "pnpm --filter @copr-index/frontend dev",
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "db:generate": "pnpm --filter @copr-index/shared db:generate",
    "db:migrate": "pnpm --filter @copr-index/shared db:migrate"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist"
  }
}
```

`.gitignore`:
```
node_modules/
dist/
.next/
.env
*.tsbuildinfo
```

`.env.example`:
```env
POSTGRES_PASSWORD=changeme
DATABASE_URL=postgresql://copr:changeme@localhost:5432/copr_index
GITHUB_TOKEN=
GISCUS_REPO=
GISCUS_REPO_ID=
GISCUS_CATEGORY_ID=
CLOUDFLARED_TUNNEL_TOKEN=
```

**Step 2: Create shared package**

`packages/shared/package.json`:
```json
{
  "name": "@copr-index/shared",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "build": "tsc",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "test": "vitest run"
  },
  "dependencies": {
    "drizzle-orm": "^0.39.0",
    "postgres": "^3.4.0"
  },
  "devDependencies": {
    "drizzle-kit": "^0.30.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

`packages/shared/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}
```

**Step 3: Create API package**

`packages/api/package.json`:
```json
{
  "name": "@copr-index/api",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@copr-index/shared": "workspace:*",
    "@hono/node-server": "^1.14.0",
    "hono": "^4.7.0",
    "drizzle-orm": "^0.39.0",
    "postgres": "^3.4.0"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

`packages/api/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}
```

**Step 4: Create frontend package**

`packages/frontend/package.json`:
```json
{
  "name": "@copr-index/frontend",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run"
  },
  "dependencies": {
    "@copr-index/shared": "workspace:*",
    "@giscus/react": "^3.1.0",
    "next": "^15.2.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@testing-library/react": "^16.1.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

`packages/frontend/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "lib": ["dom", "dom.iterable", "esnext"],
    "module": "esnext",
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src", "next-env.d.ts", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

**Step 5: Create sync package**

`packages/sync/package.json`:
```json
{
  "name": "@copr-index/sync",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@copr-index/shared": "workspace:*",
    "drizzle-orm": "^0.39.0",
    "postgres": "^3.4.0"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

`packages/sync/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}
```

**Step 6: Install dependencies**

Run: `pnpm install`
Expected: Lockfile created, all workspace packages linked.

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: initialize pnpm monorepo with workspace packages"
```

---

## Task 2: Shared Package - Drizzle Schema

**Files:**
- Create: `packages/shared/src/schema.ts`
- Create: `packages/shared/src/db.ts`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/drizzle.config.ts`

**Step 1: Write the Drizzle schema**

`packages/shared/src/schema.ts`:
```typescript
import {
  pgTable,
  serial,
  text,
  integer,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const projects = pgTable(
  "projects",
  {
    id: serial("id").primaryKey(),
    coprId: integer("copr_id").unique(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    fullName: text("full_name").unique().notNull(),
    description: text("description"),
    instructions: text("instructions"),
    homepage: text("homepage"),
    chroots: jsonb("chroots").$type<string[]>(),
    repoUrl: text("repo_url"),
    upstreamUrl: text("upstream_url"),
    upstreamProvider: text("upstream_provider").$type<
      "github" | "gitlab" | null
    >(),
    upstreamStars: integer("upstream_stars").default(0),
    upstreamForks: integer("upstream_forks").default(0),
    upstreamDescription: text("upstream_description"),
    upstreamLanguage: text("upstream_language"),
    upstreamTopics: jsonb("upstream_topics").$type<string[]>(),
    searchVector: text("search_vector"),
    lastSyncedAt: timestamp("last_synced_at"),
    starsSyncedAt: timestamp("stars_synced_at"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("projects_owner_name_idx").on(table.owner, table.name),
    index("projects_upstream_stars_idx").on(table.upstreamStars),
    index("projects_full_name_idx").on(table.fullName),
    index("projects_owner_idx").on(table.owner),
    index("projects_updated_at_idx").on(table.updatedAt),
  ]
);

export const packages = pgTable("packages", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .references(() => projects.id, { onDelete: "cascade" })
    .notNull(),
  name: text("name").notNull(),
  sourceType: text("source_type"),
  sourceUrl: text("source_url"),
});

export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  slug: text("slug").unique().notNull(),
  name: text("name").notNull(),
});

export const projectCategories = pgTable(
  "project_categories",
  {
    projectId: integer("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    categoryId: integer("category_id")
      .references(() => categories.id, { onDelete: "cascade" })
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.categoryId] })]
);
```

Note: The `search_vector` column is `text` in Drizzle because Drizzle doesn't have native tsvector support. We'll create it as a real tsvector column and the search trigger via a custom SQL migration.

**Step 2: Write the database connection helper**

`packages/shared/src/db.ts`:
```typescript
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export function createDb(connectionString: string) {
  const client = postgres(connectionString);
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;
```

**Step 3: Write the barrel export**

`packages/shared/src/index.ts`:
```typescript
export * from "./schema.js";
export * from "./db.js";
export * from "./types.js";
export * from "./url-parser.js";
```

(We'll create `types.ts` and `url-parser.ts` in the next tasks.)

**Step 4: Write Drizzle config**

`packages/shared/drizzle.config.ts`:
```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

**Step 5: Commit**

```bash
git add packages/shared/
git commit -m "feat(shared): add Drizzle schema for projects, packages, categories"
```

---

## Task 3: Shared Package - TypeScript Types

**Files:**
- Create: `packages/shared/src/types.ts`

**Step 1: Write API response types**

`packages/shared/src/types.ts`:
```typescript
export interface ProjectSummary {
  id: number;
  fullName: string;
  owner: string;
  name: string;
  description: string | null;
  upstreamUrl: string | null;
  upstreamProvider: "github" | "gitlab" | null;
  upstreamStars: number;
  upstreamLanguage: string | null;
}

export interface ProjectDetail extends ProjectSummary {
  instructions: string | null;
  homepage: string | null;
  chroots: string[] | null;
  repoUrl: string | null;
  upstreamForks: number;
  upstreamDescription: string | null;
  upstreamTopics: string[] | null;
  lastSyncedAt: string | null;
  createdAt: string | null;
}

export interface PackageInfo {
  id: number;
  name: string;
  sourceType: string | null;
  sourceUrl: string | null;
}

export interface CategoryInfo {
  id: number;
  slug: string;
  name: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export interface StatsResponse {
  totalProjects: number;
  totalWithUpstream: number;
  topLanguages: { language: string; count: number }[];
}

export interface ProjectsQuery {
  q?: string;
  sort?: "stars" | "name" | "updated";
  order?: "asc" | "desc";
  category?: string;
  owner?: string;
  language?: string;
  page?: number;
  limit?: number;
}
```

**Step 2: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat(shared): add API response TypeScript types"
```

---

## Task 4: Shared Package - URL Parser

**Files:**
- Create: `packages/shared/src/url-parser.ts`
- Create: `packages/shared/src/url-parser.test.ts`

**Step 1: Write the failing tests**

`packages/shared/src/url-parser.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { parseUpstreamUrl, type UpstreamInfo } from "./url-parser.js";

describe("parseUpstreamUrl", () => {
  it("parses a GitHub repo URL", () => {
    const result = parseUpstreamUrl("https://github.com/neovim/neovim");
    expect(result).toEqual({
      provider: "github",
      owner: "neovim",
      repo: "neovim",
      url: "https://github.com/neovim/neovim",
    });
  });

  it("parses a GitHub URL with .git suffix", () => {
    const result = parseUpstreamUrl("https://github.com/user/repo.git");
    expect(result).toEqual({
      provider: "github",
      owner: "user",
      repo: "repo",
      url: "https://github.com/user/repo",
    });
  });

  it("parses a GitHub URL with trailing path segments", () => {
    const result = parseUpstreamUrl(
      "https://github.com/user/repo/tree/main/subdir"
    );
    expect(result).toEqual({
      provider: "github",
      owner: "user",
      repo: "repo",
      url: "https://github.com/user/repo",
    });
  });

  it("parses a GitHub archive URL", () => {
    const result = parseUpstreamUrl(
      "https://github.com/user/repo/archive/v1.0.0/repo-1.0.0.tar.gz"
    );
    expect(result).toEqual({
      provider: "github",
      owner: "user",
      repo: "repo",
      url: "https://github.com/user/repo",
    });
  });

  it("parses a gitlab.com URL", () => {
    const result = parseUpstreamUrl("https://gitlab.com/fdroid/fdroidclient");
    expect(result).toEqual({
      provider: "gitlab",
      owner: "fdroid",
      repo: "fdroidclient",
      url: "https://gitlab.com/fdroid/fdroidclient",
    });
  });

  it("parses a self-hosted GitLab URL", () => {
    const result = parseUpstreamUrl(
      "https://gitlab.gnome.org/GNOME/gnome-shell"
    );
    expect(result).toEqual({
      provider: "gitlab",
      owner: "GNOME",
      repo: "gnome-shell",
      url: "https://gitlab.gnome.org/GNOME/gnome-shell",
    });
  });

  it("returns null for non-forge URLs", () => {
    expect(parseUpstreamUrl("https://example.com/project")).toBeNull();
    expect(parseUpstreamUrl("https://sourceforge.net/projects/foo")).toBeNull();
  });

  it("returns null for empty/undefined input", () => {
    expect(parseUpstreamUrl("")).toBeNull();
    expect(parseUpstreamUrl(undefined as unknown as string)).toBeNull();
  });
});

describe("extractUpstreamFromTexts", () => {
  // Import and test the extraction function that searches through
  // multiple text fields for forge URLs
  it("finds GitHub URL in homepage field", async () => {
    const { extractUpstreamFromTexts } = await import("./url-parser.js");
    const result = extractUpstreamFromTexts({
      homepage: "https://github.com/user/repo",
    });
    expect(result?.provider).toBe("github");
  });

  it("finds URL in description text", async () => {
    const { extractUpstreamFromTexts } = await import("./url-parser.js");
    const result = extractUpstreamFromTexts({
      description:
        "A cool tool. See https://github.com/user/repo for more info.",
    });
    expect(result?.provider).toBe("github");
    expect(result?.owner).toBe("user");
  });

  it("prefers homepage over description", async () => {
    const { extractUpstreamFromTexts } = await import("./url-parser.js");
    const result = extractUpstreamFromTexts({
      homepage: "https://github.com/correct/repo",
      description: "See https://github.com/wrong/repo",
    });
    expect(result?.owner).toBe("correct");
  });

  it("finds URL in clone_url field", async () => {
    const { extractUpstreamFromTexts } = await import("./url-parser.js");
    const result = extractUpstreamFromTexts({
      cloneUrl: "https://github.com/user/repo.git",
    });
    expect(result?.provider).toBe("github");
    expect(result?.repo).toBe("repo");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/shared && pnpm vitest run src/url-parser.test.ts`
Expected: FAIL - module not found

**Step 3: Write the implementation**

`packages/shared/src/url-parser.ts`:
```typescript
export interface UpstreamInfo {
  provider: "github" | "gitlab";
  owner: string;
  repo: string;
  url: string;
}

const GITHUB_REGEX =
  /https?:\/\/github\.com\/([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)/;

const GITLAB_REGEX =
  /https?:\/\/(gitlab\.[a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)/;

export function parseUpstreamUrl(url: string): UpstreamInfo | null {
  if (!url) return null;

  const ghMatch = url.match(GITHUB_REGEX);
  if (ghMatch) {
    return {
      provider: "github",
      owner: ghMatch[1],
      repo: ghMatch[2].replace(/\.git$/, ""),
      url: `https://github.com/${ghMatch[1]}/${ghMatch[2].replace(/\.git$/, "")}`,
    };
  }

  const glMatch = url.match(GITLAB_REGEX);
  if (glMatch) {
    const host = glMatch[1];
    const owner = glMatch[2];
    const repo = glMatch[3].replace(/\.git$/, "");
    return {
      provider: "gitlab",
      owner,
      repo,
      url: `https://${host}/${owner}/${repo}`,
    };
  }

  return null;
}

export function extractUpstreamFromTexts(fields: {
  homepage?: string | null;
  cloneUrl?: string | null;
  description?: string | null;
  instructions?: string | null;
}): UpstreamInfo | null {
  // Priority order: homepage > cloneUrl > description > instructions
  const sources = [
    fields.homepage,
    fields.cloneUrl,
    fields.description,
    fields.instructions,
  ];

  for (const source of sources) {
    if (!source) continue;
    const result = parseUpstreamUrl(source);
    if (result) return result;
  }

  return null;
}
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/shared && pnpm vitest run src/url-parser.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add packages/shared/src/url-parser.ts packages/shared/src/url-parser.test.ts
git commit -m "feat(shared): add upstream URL parser with GitHub/GitLab support"
```

---

## Task 5: API - Hono Server with Health Endpoint

**Files:**
- Create: `packages/api/src/index.ts`
- Create: `packages/api/src/routes/health.ts`
- Create: `packages/api/src/routes/health.test.ts`

**Step 1: Write the failing test**

`packages/api/src/routes/health.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { app } from "../index.js";

describe("GET /api/health", () => {
  it("returns 200 with status ok", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/api && pnpm vitest run src/routes/health.test.ts`
Expected: FAIL - module not found

**Step 3: Write the health route**

`packages/api/src/routes/health.ts`:
```typescript
import { Hono } from "hono";

export const healthRouter = new Hono();

healthRouter.get("/", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});
```

**Step 4: Write the Hono app entry**

`packages/api/src/index.ts`:
```typescript
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { healthRouter } from "./routes/health.js";

export const app = new Hono();

app.use("*", logger());
app.use("*", cors());

app.route("/api/health", healthRouter);

// Only start listening when run directly (not during tests)
if (process.env.NODE_ENV !== "test") {
  const { serve } = await import("@hono/node-server");
  const port = parseInt(process.env.PORT || "4000", 10);
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`API server running on http://localhost:${info.port}`);
  });
}
```

**Step 5: Run test to verify it passes**

Run: `cd packages/api && pnpm vitest run src/routes/health.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/api/src/
git commit -m "feat(api): add Hono server with health endpoint"
```

---

## Task 6: API - Database Connection and Projects Routes

**Files:**
- Create: `packages/api/src/db.ts`
- Create: `packages/api/src/routes/projects.ts`
- Create: `packages/api/src/routes/projects.test.ts`

**Step 1: Write the database connection module**

`packages/api/src/db.ts`:
```typescript
import { createDb } from "@copr-index/shared";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL && process.env.NODE_ENV !== "test") {
  throw new Error("DATABASE_URL environment variable is required");
}

export const db = DATABASE_URL ? createDb(DATABASE_URL) : (null as any);
```

**Step 2: Write the projects route**

`packages/api/src/routes/projects.ts`:
```typescript
import { Hono } from "hono";
import { eq, desc, asc, sql, and, ilike } from "drizzle-orm";
import {
  projects,
  packages as packagesTable,
  categories,
  projectCategories,
} from "@copr-index/shared";
import type { Db } from "@copr-index/shared";
import type { ProjectsQuery, PaginatedResponse, ProjectSummary, ProjectDetail, PackageInfo } from "@copr-index/shared";

export function createProjectsRouter(db: Db) {
  const router = new Hono();

  // GET /api/projects - list/search
  router.get("/", async (c) => {
    const query: ProjectsQuery = {
      q: c.req.query("q"),
      sort: (c.req.query("sort") as ProjectsQuery["sort"]) || "stars",
      order: (c.req.query("order") as ProjectsQuery["order"]) || "desc",
      category: c.req.query("category"),
      owner: c.req.query("owner"),
      language: c.req.query("language"),
      page: parseInt(c.req.query("page") || "1", 10),
      limit: Math.min(parseInt(c.req.query("limit") || "24", 10), 100),
    };

    const conditions: any[] = [];

    if (query.owner) {
      conditions.push(eq(projects.owner, query.owner));
    }
    if (query.language) {
      conditions.push(eq(projects.upstreamLanguage, query.language));
    }
    if (query.q) {
      conditions.push(
        sql`${projects.searchVector}::tsvector @@ plainto_tsquery('english', ${query.q})`
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const orderMap = {
      stars: projects.upstreamStars,
      name: projects.fullName,
      updated: projects.updatedAt,
    };
    const orderCol = orderMap[query.sort || "stars"];
    const orderDir = query.order === "asc" ? asc(orderCol) : desc(orderCol);

    const offset = ((query.page || 1) - 1) * (query.limit || 24);

    // If category filter, join through project_categories
    let baseQuery;
    if (query.category) {
      baseQuery = db
        .select({
          id: projects.id,
          fullName: projects.fullName,
          owner: projects.owner,
          name: projects.name,
          description: projects.description,
          upstreamUrl: projects.upstreamUrl,
          upstreamProvider: projects.upstreamProvider,
          upstreamStars: projects.upstreamStars,
          upstreamLanguage: projects.upstreamLanguage,
        })
        .from(projects)
        .innerJoin(
          projectCategories,
          eq(projects.id, projectCategories.projectId)
        )
        .innerJoin(
          categories,
          eq(projectCategories.categoryId, categories.id)
        )
        .where(
          and(eq(categories.slug, query.category), where)
        );
    } else {
      baseQuery = db
        .select({
          id: projects.id,
          fullName: projects.fullName,
          owner: projects.owner,
          name: projects.name,
          description: projects.description,
          upstreamUrl: projects.upstreamUrl,
          upstreamProvider: projects.upstreamProvider,
          upstreamStars: projects.upstreamStars,
          upstreamLanguage: projects.upstreamLanguage,
        })
        .from(projects)
        .where(where);
    }

    const [data, countResult] = await Promise.all([
      baseQuery.orderBy(orderDir).limit(query.limit || 24).offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(projects)
        .where(where),
    ]);

    const total = countResult[0]?.count || 0;

    return c.json({
      data,
      meta: {
        page: query.page || 1,
        limit: query.limit || 24,
        total,
        pages: Math.ceil(total / (query.limit || 24)),
      },
    } satisfies PaginatedResponse<ProjectSummary>);
  });

  // GET /api/projects/:owner/:name - detail
  router.get("/:owner/:name", async (c) => {
    const { owner, name } = c.req.param();
    const result = await db
      .select()
      .from(projects)
      .where(
        and(eq(projects.owner, owner), eq(projects.name, name))
      )
      .limit(1);

    if (result.length === 0) {
      return c.json({ error: "Project not found" }, 404);
    }

    const project = result[0];
    return c.json({
      id: project.id,
      fullName: project.fullName,
      owner: project.owner,
      name: project.name,
      description: project.description,
      instructions: project.instructions,
      homepage: project.homepage,
      chroots: project.chroots,
      repoUrl: project.repoUrl,
      upstreamUrl: project.upstreamUrl,
      upstreamProvider: project.upstreamProvider,
      upstreamStars: project.upstreamStars ?? 0,
      upstreamForks: project.upstreamForks ?? 0,
      upstreamDescription: project.upstreamDescription,
      upstreamLanguage: project.upstreamLanguage,
      upstreamTopics: project.upstreamTopics,
      lastSyncedAt: project.lastSyncedAt?.toISOString() ?? null,
      createdAt: project.createdAt?.toISOString() ?? null,
    } satisfies ProjectDetail);
  });

  // GET /api/projects/:owner/:name/packages
  router.get("/:owner/:name/packages", async (c) => {
    const { owner, name } = c.req.param();
    const project = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.owner, owner), eq(projects.name, name)))
      .limit(1);

    if (project.length === 0) {
      return c.json({ error: "Project not found" }, 404);
    }

    const pkgs = await db
      .select({
        id: packagesTable.id,
        name: packagesTable.name,
        sourceType: packagesTable.sourceType,
        sourceUrl: packagesTable.sourceUrl,
      })
      .from(packagesTable)
      .where(eq(packagesTable.projectId, project[0].id));

    return c.json({ data: pkgs satisfies PackageInfo[] });
  });

  return router;
}
```

**Step 3: Wire into the main app**

Update `packages/api/src/index.ts` to add:
```typescript
import { createProjectsRouter } from "./routes/projects.js";
import { db } from "./db.js";

// After healthRouter line:
app.route("/api/projects", createProjectsRouter(db));
```

**Step 4: Commit**

```bash
git add packages/api/src/
git commit -m "feat(api): add projects routes with search, detail, packages endpoints"
```

---

## Task 7: API - Categories and Stats Routes

**Files:**
- Create: `packages/api/src/routes/categories.ts`
- Create: `packages/api/src/routes/stats.ts`

**Step 1: Write categories route**

`packages/api/src/routes/categories.ts`:
```typescript
import { Hono } from "hono";
import { eq, sql, desc } from "drizzle-orm";
import { categories, projectCategories, projects } from "@copr-index/shared";
import type { Db } from "@copr-index/shared";

export function createCategoriesRouter(db: Db) {
  const router = new Hono();

  // GET /api/categories - list all
  router.get("/", async (c) => {
    const result = await db
      .select({
        id: categories.id,
        slug: categories.slug,
        name: categories.name,
        projectCount: sql<number>`count(${projectCategories.projectId})::int`,
      })
      .from(categories)
      .leftJoin(
        projectCategories,
        eq(categories.id, projectCategories.categoryId)
      )
      .groupBy(categories.id)
      .orderBy(categories.name);

    return c.json({ data: result });
  });

  // GET /api/categories/:slug - projects in category
  router.get("/:slug", async (c) => {
    const { slug } = c.req.param();
    const page = parseInt(c.req.query("page") || "1", 10);
    const limit = Math.min(parseInt(c.req.query("limit") || "24", 10), 100);
    const offset = (page - 1) * limit;

    const data = await db
      .select({
        id: projects.id,
        fullName: projects.fullName,
        owner: projects.owner,
        name: projects.name,
        description: projects.description,
        upstreamUrl: projects.upstreamUrl,
        upstreamProvider: projects.upstreamProvider,
        upstreamStars: projects.upstreamStars,
        upstreamLanguage: projects.upstreamLanguage,
      })
      .from(projects)
      .innerJoin(
        projectCategories,
        eq(projects.id, projectCategories.projectId)
      )
      .innerJoin(categories, eq(projectCategories.categoryId, categories.id))
      .where(eq(categories.slug, slug))
      .orderBy(desc(projects.upstreamStars))
      .limit(limit)
      .offset(offset);

    return c.json({ data });
  });

  return router;
}
```

**Step 2: Write stats route**

`packages/api/src/routes/stats.ts`:
```typescript
import { Hono } from "hono";
import { sql, isNotNull } from "drizzle-orm";
import { projects } from "@copr-index/shared";
import type { Db } from "@copr-index/shared";

export function createStatsRouter(db: Db) {
  const router = new Hono();

  router.get("/", async (c) => {
    const [totals, languages] = await Promise.all([
      db
        .select({
          totalProjects: sql<number>`count(*)::int`,
          totalWithUpstream: sql<number>`count(${projects.upstreamUrl})::int`,
        })
        .from(projects),
      db
        .select({
          language: projects.upstreamLanguage,
          count: sql<number>`count(*)::int`,
        })
        .from(projects)
        .where(isNotNull(projects.upstreamLanguage))
        .groupBy(projects.upstreamLanguage)
        .orderBy(sql`count(*) desc`)
        .limit(20),
    ]);

    return c.json({
      totalProjects: totals[0]?.totalProjects || 0,
      totalWithUpstream: totals[0]?.totalWithUpstream || 0,
      topLanguages: languages.map((l) => ({
        language: l.language!,
        count: l.count,
      })),
    });
  });

  return router;
}
```

**Step 3: Wire routes into main app**

Update `packages/api/src/index.ts`:
```typescript
import { createCategoriesRouter } from "./routes/categories.js";
import { createStatsRouter } from "./routes/stats.js";

app.route("/api/categories", createCategoriesRouter(db));
app.route("/api/stats", createStatsRouter(db));
```

**Step 4: Commit**

```bash
git add packages/api/src/
git commit -m "feat(api): add categories and stats routes"
```

---

## Task 8: Sync Worker - COPR Sync

**Files:**
- Create: `packages/sync/src/copr-sync.ts`
- Create: `packages/sync/src/copr-sync.test.ts`

**Step 1: Write the failing test**

`packages/sync/src/copr-sync.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { parseCoprProject, type CoprApiProject } from "./copr-sync.js";

describe("parseCoprProject", () => {
  it("converts COPR API response to database shape", () => {
    const apiProject: CoprApiProject = {
      id: 123,
      name: "lazygit",
      ownername: "atim",
      full_name: "atim/lazygit",
      description: "A simple terminal UI for git",
      instructions: "dnf copr enable atim/lazygit",
      homepage: "https://github.com/jesseduffield/lazygit",
      chroot_repos: {
        "fedora-40-x86_64": "https://download.copr.fedorainfracloud.org/...",
      },
      repo_url: "https://copr.fedorainfracloud.org/coprs/atim/lazygit/",
    };

    const result = parseCoprProject(apiProject);

    expect(result.coprId).toBe(123);
    expect(result.owner).toBe("atim");
    expect(result.name).toBe("lazygit");
    expect(result.fullName).toBe("atim/lazygit");
    expect(result.homepage).toBe("https://github.com/jesseduffield/lazygit");
    expect(result.chroots).toEqual(["fedora-40-x86_64"]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/sync && pnpm vitest run src/copr-sync.test.ts`
Expected: FAIL

**Step 3: Write the COPR sync implementation**

`packages/sync/src/copr-sync.ts`:
```typescript
import { eq } from "drizzle-orm";
import { projects, packages as packagesTable } from "@copr-index/shared";
import { extractUpstreamFromTexts } from "@copr-index/shared";
import type { Db } from "@copr-index/shared";

const COPR_API_BASE = "https://copr.fedorainfracloud.org/api_3";

export interface CoprApiProject {
  id: number;
  name: string;
  ownername: string;
  full_name: string;
  description: string | null;
  instructions: string | null;
  homepage: string | null;
  chroot_repos: Record<string, string>;
  repo_url: string | null;
}

interface CoprApiPackage {
  id: number;
  name: string;
  source_type: string | null;
  source_dict: {
    clone_url?: string;
    [key: string]: unknown;
  } | null;
}

interface CoprSearchResponse {
  items: CoprApiProject[];
  meta: {
    limit: number;
    offset: number;
    count: number;
  };
}

export function parseCoprProject(apiProject: CoprApiProject) {
  const chroots = Object.keys(apiProject.chroot_repos || {});

  return {
    coprId: apiProject.id,
    owner: apiProject.ownername,
    name: apiProject.name,
    fullName: apiProject.full_name,
    description: apiProject.description,
    instructions: apiProject.instructions,
    homepage: apiProject.homepage,
    chroots,
    repoUrl: apiProject.repo_url,
  };
}

export async function syncCoprProjects(db: Db): Promise<number> {
  let offset = 0;
  const limit = 100;
  let totalSynced = 0;

  console.log("Starting COPR project sync...");

  while (true) {
    const url = `${COPR_API_BASE}/project/search?query=*&limit=${limit}&offset=${offset}`;
    console.log(`Fetching: ${url}`);

    const response = await fetch(url);
    if (!response.ok) {
      console.error(`COPR API error: ${response.status}`);
      break;
    }

    const data: CoprSearchResponse = await response.json();
    if (data.items.length === 0) break;

    for (const apiProject of data.items) {
      const parsed = parseCoprProject(apiProject);

      // Attempt upstream discovery
      const upstream = extractUpstreamFromTexts({
        homepage: apiProject.homepage,
        description: apiProject.description,
        instructions: apiProject.instructions,
      });

      const projectData = {
        ...parsed,
        upstreamUrl: upstream?.url ?? null,
        upstreamProvider: upstream?.provider ?? null,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      };

      // Upsert by coprId
      await db
        .insert(projects)
        .values(projectData)
        .onConflictDoUpdate({
          target: projects.coprId,
          set: projectData,
        });

      // Sync packages for this project
      await syncProjectPackages(db, apiProject.ownername, apiProject.name);

      totalSynced++;
    }

    offset += limit;
    if (offset >= data.meta.count) break;

    // Be polite to the COPR API
    await sleep(500);
  }

  console.log(`COPR sync complete. Synced ${totalSynced} projects.`);
  return totalSynced;
}

async function syncProjectPackages(
  db: Db,
  owner: string,
  projectName: string
) {
  const url = `${COPR_API_BASE}/package/list?ownername=${owner}&projectname=${projectName}&limit=100`;
  const response = await fetch(url);
  if (!response.ok) return;

  const data: { items: CoprApiPackage[] } = await response.json();

  // Find the project in our DB
  const project = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.fullName, `${owner}/${projectName}`))
    .limit(1);

  if (project.length === 0) return;

  for (const pkg of data.items) {
    const cloneUrl = pkg.source_dict?.clone_url ?? null;

    // If the project doesn't have an upstream URL yet, try the package clone_url
    if (cloneUrl) {
      const upstream = extractUpstreamFromTexts({ cloneUrl });
      if (upstream) {
        await db
          .update(projects)
          .set({
            upstreamUrl: upstream.url,
            upstreamProvider: upstream.provider,
          })
          .where(eq(projects.id, project[0].id));
      }
    }

    await db
      .insert(packagesTable)
      .values({
        projectId: project[0].id,
        name: pkg.name,
        sourceType: pkg.source_type,
        sourceUrl: cloneUrl,
      })
      .onConflictDoNothing();
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/sync && pnpm vitest run src/copr-sync.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/sync/src/copr-sync.ts packages/sync/src/copr-sync.test.ts
git commit -m "feat(sync): add COPR project sync with upstream URL discovery"
```

---

## Task 9: Sync Worker - Star Sync (GitHub + GitLab)

**Files:**
- Create: `packages/sync/src/stars-sync.ts`
- Create: `packages/sync/src/stars-sync.test.ts`

**Step 1: Write the failing test**

`packages/sync/src/stars-sync.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { fetchGitHubStars, fetchGitLabStars } from "./stars-sync.js";

describe("fetchGitHubStars", () => {
  it("extracts stargazers_count from GitHub API response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        "x-ratelimit-remaining": "4999",
      }),
      json: () =>
        Promise.resolve({
          stargazers_count: 42000,
          forks_count: 3000,
          language: "Go",
          description: "A terminal UI for git",
          topics: ["git", "terminal", "tui"],
        }),
    });

    const result = await fetchGitHubStars("jesseduffield", "lazygit");
    expect(result?.stars).toBe(42000);
    expect(result?.forks).toBe(3000);
    expect(result?.language).toBe("Go");
  });

  it("returns null for 404", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: new Headers(),
    });

    const result = await fetchGitHubStars("nonexistent", "repo");
    expect(result).toBeNull();
  });
});

describe("fetchGitLabStars", () => {
  it("extracts star_count from GitLab API response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () =>
        Promise.resolve({
          star_count: 2100,
          forks_count: 450,
          topics: ["android"],
          description: "F-Droid client",
        }),
    });

    const result = await fetchGitLabStars("gitlab.com", "fdroid/fdroidclient");
    expect(result?.stars).toBe(2100);
    expect(result?.forks).toBe(450);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/sync && pnpm vitest run src/stars-sync.test.ts`
Expected: FAIL

**Step 3: Write the star sync implementation**

`packages/sync/src/stars-sync.ts`:
```typescript
import { eq, isNotNull } from "drizzle-orm";
import { projects } from "@copr-index/shared";
import { parseUpstreamUrl } from "@copr-index/shared";
import type { Db } from "@copr-index/shared";

export interface UpstreamMeta {
  stars: number;
  forks: number;
  language: string | null;
  description: string | null;
  topics: string[];
}

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

export async function fetchGitHubStars(
  owner: string,
  repo: string
): Promise<UpstreamMeta | null> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "copr-index",
  };
  if (GITHUB_TOKEN) {
    headers["Authorization"] = `Bearer ${GITHUB_TOKEN}`;
  }

  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers,
  });

  if (!res.ok) return null;

  const remaining = res.headers.get("x-ratelimit-remaining");
  if (remaining && parseInt(remaining, 10) < 10) {
    const resetAt = res.headers.get("x-ratelimit-reset");
    const waitMs = resetAt
      ? parseInt(resetAt, 10) * 1000 - Date.now() + 1000
      : 60000;
    console.log(`GitHub rate limit low, sleeping ${waitMs}ms`);
    await sleep(Math.max(waitMs, 1000));
  }

  const data = await res.json();
  return {
    stars: data.stargazers_count,
    forks: data.forks_count,
    language: data.language ?? null,
    description: data.description ?? null,
    topics: data.topics ?? [],
  };
}

export async function fetchGitLabStars(
  host: string,
  projectPath: string
): Promise<UpstreamMeta | null> {
  const encodedPath = encodeURIComponent(projectPath);
  const res = await fetch(`https://${host}/api/v4/projects/${encodedPath}`);

  if (!res.ok) return null;

  const data = await res.json();
  return {
    stars: data.star_count,
    forks: data.forks_count,
    language: null, // GitLab doesn't return primary language from this endpoint
    description: data.description ?? null,
    topics: data.topics ?? [],
  };
}

export async function syncAllStars(db: Db): Promise<number> {
  console.log("Starting star sync...");

  const projectsWithUpstream = await db
    .select({
      id: projects.id,
      upstreamUrl: projects.upstreamUrl,
      upstreamProvider: projects.upstreamProvider,
    })
    .from(projects)
    .where(isNotNull(projects.upstreamUrl));

  let synced = 0;

  for (const project of projectsWithUpstream) {
    const parsed = parseUpstreamUrl(project.upstreamUrl!);
    if (!parsed) continue;

    let meta: UpstreamMeta | null = null;

    if (parsed.provider === "github") {
      meta = await fetchGitHubStars(parsed.owner, parsed.repo);
    } else if (parsed.provider === "gitlab") {
      const host = new URL(project.upstreamUrl!).host;
      meta = await fetchGitLabStars(host, `${parsed.owner}/${parsed.repo}`);
    }

    if (meta) {
      await db
        .update(projects)
        .set({
          upstreamStars: meta.stars,
          upstreamForks: meta.forks,
          upstreamLanguage: meta.language,
          upstreamDescription: meta.description,
          upstreamTopics: meta.topics,
          starsSyncedAt: new Date(),
        })
        .where(eq(projects.id, project.id));
      synced++;
    }

    // Small delay between requests
    await sleep(100);
  }

  console.log(`Star sync complete. Updated ${synced} projects.`);
  return synced;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/sync && pnpm vitest run src/stars-sync.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/sync/src/stars-sync.ts packages/sync/src/stars-sync.test.ts
git commit -m "feat(sync): add GitHub/GitLab star sync with rate limiting"
```

---

## Task 10: Sync Worker - Cron Scheduler Entry Point

**Files:**
- Create: `packages/sync/src/index.ts`

**Step 1: Write the scheduler**

`packages/sync/src/index.ts`:
```typescript
import { createDb } from "@copr-index/shared";
import { syncCoprProjects } from "./copr-sync.js";
import { syncAllStars } from "./stars-sync.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const COPR_SYNC_INTERVAL_HOURS = parseInt(
  process.env.COPR_SYNC_INTERVAL_HOURS || "6",
  10
);
const STARS_SYNC_INTERVAL_HOURS = parseInt(
  process.env.STARS_SYNC_INTERVAL_HOURS || "12",
  10
);

const db = createDb(DATABASE_URL);

async function runCoprSync() {
  try {
    await syncCoprProjects(db);
  } catch (err) {
    console.error("COPR sync failed:", err);
  }
}

async function runStarSync() {
  try {
    await syncAllStars(db);
  } catch (err) {
    console.error("Star sync failed:", err);
  }
}

// Run immediately on startup, then on interval
console.log("Sync worker starting...");
console.log(
  `COPR sync interval: ${COPR_SYNC_INTERVAL_HOURS}h, Star sync interval: ${STARS_SYNC_INTERVAL_HOURS}h`
);

await runCoprSync();
await runStarSync();

setInterval(runCoprSync, COPR_SYNC_INTERVAL_HOURS * 60 * 60 * 1000);
setInterval(runStarSync, STARS_SYNC_INTERVAL_HOURS * 60 * 60 * 1000);

console.log("Sync worker running. Waiting for next interval...");
```

**Step 2: Commit**

```bash
git add packages/sync/src/index.ts
git commit -m "feat(sync): add cron scheduler entry point"
```

---

## Task 11: Frontend - Next.js Setup and API Client

**Files:**
- Create: `packages/frontend/src/app/layout.tsx`
- Create: `packages/frontend/src/app/globals.css`
- Create: `packages/frontend/src/lib/api-client.ts`
- Create: `packages/frontend/next.config.ts`

**Step 1: Create Next.js config**

`packages/frontend/next.config.ts`:
```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
```

**Step 2: Create root layout**

`packages/frontend/src/app/layout.tsx`:
```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "COPR Index",
  description: "Discover Fedora COPR packages",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header>
          <nav>
            <a href="/">COPR Index</a>
            <a href="/search">Browse</a>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
```

**Step 3: Create minimal globals.css**

`packages/frontend/src/app/globals.css`:
```css
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

:root {
  --bg: #0f0f0f;
  --fg: #e8e8e8;
  --card-bg: #1a1a1a;
  --border: #2a2a2a;
  --accent: #3b82f6;
  --muted: #888;
}

body {
  font-family: system-ui, -apple-system, sans-serif;
  background: var(--bg);
  color: var(--fg);
  line-height: 1.6;
}

main {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem 1rem;
}

header nav {
  display: flex;
  gap: 1.5rem;
  align-items: center;
  padding: 1rem 2rem;
  border-bottom: 1px solid var(--border);
}

header nav a {
  color: var(--fg);
  text-decoration: none;
}

header nav a:first-child {
  font-weight: 700;
  font-size: 1.2rem;
}
```

**Step 4: Create typed API client**

`packages/frontend/src/lib/api-client.ts`:
```typescript
import type {
  PaginatedResponse,
  ProjectSummary,
  ProjectDetail,
  PackageInfo,
  CategoryInfo,
  StatsResponse,
  ProjectsQuery,
} from "@copr-index/shared";

const API_URL = process.env.API_URL || "http://localhost:4000";

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { next: { revalidate: 300 } });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function getProjects(
  params: ProjectsQuery = {}
): Promise<PaginatedResponse<ProjectSummary>> {
  const searchParams = new URLSearchParams();
  if (params.q) searchParams.set("q", params.q);
  if (params.sort) searchParams.set("sort", params.sort);
  if (params.order) searchParams.set("order", params.order);
  if (params.category) searchParams.set("category", params.category);
  if (params.owner) searchParams.set("owner", params.owner);
  if (params.language) searchParams.set("language", params.language);
  if (params.page) searchParams.set("page", params.page.toString());
  if (params.limit) searchParams.set("limit", params.limit.toString());

  const qs = searchParams.toString();
  return apiFetch(`/api/projects${qs ? `?${qs}` : ""}`);
}

export async function getProject(
  owner: string,
  name: string
): Promise<ProjectDetail> {
  return apiFetch(`/api/projects/${owner}/${name}`);
}

export async function getProjectPackages(
  owner: string,
  name: string
): Promise<{ data: PackageInfo[] }> {
  return apiFetch(`/api/projects/${owner}/${name}/packages`);
}

export async function getCategories(): Promise<{
  data: (CategoryInfo & { projectCount: number })[];
}> {
  return apiFetch("/api/categories");
}

export async function getStats(): Promise<StatsResponse> {
  return apiFetch("/api/stats");
}
```

**Step 5: Commit**

```bash
git add packages/frontend/
git commit -m "feat(frontend): add Next.js setup, root layout, and typed API client"
```

---

## Task 12: Frontend - ProjectCard and SearchBar Components

**Files:**
- Create: `packages/frontend/src/components/ProjectCard.tsx`
- Create: `packages/frontend/src/components/SearchBar.tsx`

**Step 1: Write ProjectCard**

`packages/frontend/src/components/ProjectCard.tsx`:
```tsx
import type { ProjectSummary } from "@copr-index/shared";

export function ProjectCard({ project }: { project: ProjectSummary }) {
  return (
    <a href={`/projects/${project.owner}/${project.name}`} className="card">
      <div className="card-header">
        <h3>{project.name}</h3>
        <span className="owner">{project.owner}</span>
      </div>
      <p className="description">
        {project.description?.slice(0, 120) || "No description"}
        {(project.description?.length ?? 0) > 120 ? "..." : ""}
      </p>
      <div className="card-footer">
        {project.upstreamStars > 0 && (
          <span className="stars">
            {project.upstreamProvider === "github" ? "GitHub" : "GitLab"}{" "}
            &#9733; {project.upstreamStars.toLocaleString()}
          </span>
        )}
        {project.upstreamLanguage && (
          <span className="language">{project.upstreamLanguage}</span>
        )}
      </div>
    </a>
  );
}
```

**Step 2: Write SearchBar**

`packages/frontend/src/components/SearchBar.tsx`:
```tsx
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

export function SearchBar({ initialQuery = "" }: { initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    router.push(`/search?${params.toString()}`);
  };

  return (
    <form onSubmit={handleSubmit} className="search-bar">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search COPR packages..."
        aria-label="Search packages"
      />
      <button type="submit">Search</button>
    </form>
  );
}
```

**Step 3: Commit**

```bash
git add packages/frontend/src/components/
git commit -m "feat(frontend): add ProjectCard and SearchBar components"
```

---

## Task 13: Frontend - Homepage

**Files:**
- Create: `packages/frontend/src/app/page.tsx`

**Step 1: Write the homepage**

`packages/frontend/src/app/page.tsx`:
```tsx
import { getProjects, getCategories } from "@/lib/api-client";
import { ProjectCard } from "@/components/ProjectCard";
import { SearchBar } from "@/components/SearchBar";

export default async function HomePage() {
  const [popular, recent, categoriesRes] = await Promise.all([
    getProjects({ sort: "stars", limit: 12 }),
    getProjects({ sort: "updated", limit: 12 }),
    getCategories(),
  ]);

  return (
    <div>
      <section className="hero">
        <h1>Discover Fedora COPR Packages</h1>
        <p>Browse, search, and explore community-built RPM packages</p>
        <SearchBar />
      </section>

      <section className="section">
        <h2>Popular</h2>
        <div className="card-grid">
          {popular.data.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      </section>

      <section className="section">
        <h2>Recently Updated</h2>
        <div className="card-grid">
          {recent.data.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      </section>

      {categoriesRes.data.length > 0 && (
        <section className="section">
          <h2>Categories</h2>
          <div className="category-grid">
            {categoriesRes.data.map((cat) => (
              <a
                key={cat.id}
                href={`/categories/${cat.slug}`}
                className="category-tile"
              >
                <span>{cat.name}</span>
                <span className="count">{cat.projectCount}</span>
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add packages/frontend/src/app/page.tsx
git commit -m "feat(frontend): add homepage with popular, recent, and categories"
```

---

## Task 14: Frontend - Search/Browse Page

**Files:**
- Create: `packages/frontend/src/app/search/page.tsx`

**Step 1: Write the search page**

`packages/frontend/src/app/search/page.tsx`:
```tsx
import { getProjects, getCategories } from "@/lib/api-client";
import { ProjectCard } from "@/components/ProjectCard";
import { SearchBar } from "@/components/SearchBar";

interface SearchPageProps {
  searchParams: Promise<{
    q?: string;
    sort?: string;
    category?: string;
    language?: string;
    page?: string;
  }>;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const page = parseInt(params.page || "1", 10);

  const [results, categoriesRes] = await Promise.all([
    getProjects({
      q: params.q,
      sort: (params.sort as "stars" | "name" | "updated") || "stars",
      category: params.category,
      language: params.language,
      page,
      limit: 24,
    }),
    getCategories(),
  ]);

  return (
    <div>
      <SearchBar initialQuery={params.q} />

      <div className="browse-layout">
        <aside className="filters">
          <h3>Sort</h3>
          <ul>
            {["stars", "name", "updated"].map((s) => (
              <li key={s}>
                <a
                  href={`/search?${new URLSearchParams({ ...params, sort: s, page: "1" }).toString()}`}
                  className={params.sort === s ? "active" : ""}
                >
                  {s === "stars" ? "Most Stars" : s === "name" ? "Name" : "Recently Updated"}
                </a>
              </li>
            ))}
          </ul>

          {categoriesRes.data.length > 0 && (
            <>
              <h3>Categories</h3>
              <ul>
                {categoriesRes.data.map((cat) => (
                  <li key={cat.id}>
                    <a
                      href={`/search?${new URLSearchParams({ ...params, category: cat.slug, page: "1" }).toString()}`}
                      className={params.category === cat.slug ? "active" : ""}
                    >
                      {cat.name} ({cat.projectCount})
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>

        <div className="results">
          <p className="result-count">
            {results.meta.total} packages found
          </p>
          <div className="card-grid">
            {results.data.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>

          {results.meta.pages > 1 && (
            <nav className="pagination">
              {page > 1 && (
                <a
                  href={`/search?${new URLSearchParams({ ...params, page: (page - 1).toString() }).toString()}`}
                >
                  Previous
                </a>
              )}
              <span>
                Page {page} of {results.meta.pages}
              </span>
              {page < results.meta.pages && (
                <a
                  href={`/search?${new URLSearchParams({ ...params, page: (page + 1).toString() }).toString()}`}
                >
                  Next
                </a>
              )}
            </nav>
          )}
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add packages/frontend/src/app/search/
git commit -m "feat(frontend): add search/browse page with filters and pagination"
```

---

## Task 15: Frontend - Project Detail Page with Giscus

**Files:**
- Create: `packages/frontend/src/app/projects/[owner]/[name]/page.tsx`
- Create: `packages/frontend/src/components/GiscusComments.tsx`
- Create: `packages/frontend/src/components/CopyButton.tsx`

**Step 1: Write GiscusComments component**

`packages/frontend/src/components/GiscusComments.tsx`:
```tsx
"use client";

import Giscus from "@giscus/react";

export function GiscusComments() {
  const repo = process.env.NEXT_PUBLIC_GISCUS_REPO;
  const repoId = process.env.NEXT_PUBLIC_GISCUS_REPO_ID;
  const categoryId = process.env.NEXT_PUBLIC_GISCUS_CATEGORY_ID;

  if (!repo || !repoId || !categoryId) return null;

  return (
    <Giscus
      repo={repo as `${string}/${string}`}
      repoId={repoId}
      category="Announcements"
      categoryId={categoryId}
      mapping="pathname"
      strict="0"
      reactionsEnabled="1"
      emitMetadata="0"
      inputPosition="bottom"
      theme="dark"
      lang="en"
      loading="lazy"
    />
  );
}
```

**Step 2: Write CopyButton component**

`packages/frontend/src/components/CopyButton.tsx`:
```tsx
"use client";

import { useState } from "react";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button onClick={handleCopy} className="copy-btn">
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}
```

**Step 3: Write the project detail page**

`packages/frontend/src/app/projects/[owner]/[name]/page.tsx`:
```tsx
import { getProject, getProjectPackages } from "@/lib/api-client";
import { GiscusComments } from "@/components/GiscusComments";
import { CopyButton } from "@/components/CopyButton";
import { notFound } from "next/navigation";

interface ProjectPageProps {
  params: Promise<{ owner: string; name: string }>;
}

export default async function ProjectPage({ params }: ProjectPageProps) {
  const { owner, name } = await params;

  let project;
  try {
    project = await getProject(owner, name);
  } catch {
    notFound();
  }

  const { data: packages } = await getProjectPackages(owner, name);
  const enableCommand = `sudo dnf copr enable ${owner}/${name}`;

  return (
    <div className="project-detail">
      <div className="project-header">
        <h1>{project.name}</h1>
        <span className="owner">by {project.owner}</span>
        {project.upstreamStars > 0 && (
          <span className="stars-badge">
            &#9733; {project.upstreamStars.toLocaleString()}
          </span>
        )}
      </div>

      {project.description && (
        <section>
          <p>{project.description}</p>
        </section>
      )}

      <section className="install-section">
        <h2>Install</h2>
        <div className="code-block">
          <code>{enableCommand}</code>
          <CopyButton text={enableCommand} />
        </div>
        {project.instructions && (
          <div className="instructions">{project.instructions}</div>
        )}
      </section>

      {project.chroots && project.chroots.length > 0 && (
        <section>
          <h2>Supported Releases</h2>
          <div className="badge-list">
            {project.chroots.map((chroot) => (
              <span key={chroot} className="badge">
                {chroot}
              </span>
            ))}
          </div>
        </section>
      )}

      {project.upstreamUrl && (
        <section>
          <h2>Upstream</h2>
          <a href={project.upstreamUrl} target="_blank" rel="noopener">
            {project.upstreamUrl}
          </a>
          {project.upstreamLanguage && (
            <span className="language-badge">{project.upstreamLanguage}</span>
          )}
          {project.upstreamTopics && project.upstreamTopics.length > 0 && (
            <div className="badge-list">
              {project.upstreamTopics.map((t) => (
                <span key={t} className="badge">
                  {t}
                </span>
              ))}
            </div>
          )}
        </section>
      )}

      {packages.length > 0 && (
        <section>
          <h2>Packages</h2>
          <ul className="package-list">
            {packages.map((pkg) => (
              <li key={pkg.id}>
                <strong>{pkg.name}</strong>
                {pkg.sourceType && (
                  <span className="source-type">{pkg.sourceType}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="comments-section">
        <h2>Community</h2>
        <GiscusComments />
      </section>
    </div>
  );
}
```

**Step 4: Commit**

```bash
git add packages/frontend/src/app/projects/ packages/frontend/src/components/GiscusComments.tsx packages/frontend/src/components/CopyButton.tsx
git commit -m "feat(frontend): add project detail page with Giscus comments"
```

---

## Task 16: Frontend - Owner and Category Pages

**Files:**
- Create: `packages/frontend/src/app/owners/[owner]/page.tsx`
- Create: `packages/frontend/src/app/categories/[slug]/page.tsx`

**Step 1: Write owner page**

`packages/frontend/src/app/owners/[owner]/page.tsx`:
```tsx
import { getProjects } from "@/lib/api-client";
import { ProjectCard } from "@/components/ProjectCard";

interface OwnerPageProps {
  params: Promise<{ owner: string }>;
  searchParams: Promise<{ page?: string }>;
}

export default async function OwnerPage({
  params,
  searchParams,
}: OwnerPageProps) {
  const { owner } = await params;
  const { page: pageStr } = await searchParams;
  const page = parseInt(pageStr || "1", 10);

  const results = await getProjects({ owner, page, sort: "stars", limit: 24 });

  return (
    <div>
      <h1>Projects by {owner}</h1>
      <p>{results.meta.total} projects</p>
      <div className="card-grid">
        {results.data.map((p) => (
          <ProjectCard key={p.id} project={p} />
        ))}
      </div>
    </div>
  );
}
```

**Step 2: Write category page**

`packages/frontend/src/app/categories/[slug]/page.tsx`:
```tsx
import { getProjects, getCategories } from "@/lib/api-client";
import { ProjectCard } from "@/components/ProjectCard";

interface CategoryPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}

export default async function CategoryPage({
  params,
  searchParams,
}: CategoryPageProps) {
  const { slug } = await params;
  const { page: pageStr } = await searchParams;
  const page = parseInt(pageStr || "1", 10);

  const [results, categoriesRes] = await Promise.all([
    getProjects({ category: slug, page, sort: "stars", limit: 24 }),
    getCategories(),
  ]);

  const category = categoriesRes.data.find((c) => c.slug === slug);
  const categoryName = category?.name || slug;

  return (
    <div>
      <h1>{categoryName}</h1>
      <p>{results.meta.total} projects</p>
      <div className="card-grid">
        {results.data.map((p) => (
          <ProjectCard key={p.id} project={p} />
        ))}
      </div>
    </div>
  );
}
```

**Step 3: Commit**

```bash
git add packages/frontend/src/app/owners/ packages/frontend/src/app/categories/
git commit -m "feat(frontend): add owner and category pages"
```

---

## Task 17: Database Migration - Full-Text Search

**Files:**
- Create: `packages/shared/drizzle/0001_search_vector.sql`

**Step 1: Generate Drizzle migration**

Run: `cd packages/shared && pnpm db:generate`
Expected: Migration files created in `drizzle/` directory.

**Step 2: Create custom migration for tsvector and trigger**

`packages/shared/drizzle/0001_search_vector.sql`:
```sql
-- Convert the search_vector column to a real tsvector type
ALTER TABLE projects ALTER COLUMN search_vector TYPE tsvector USING search_vector::tsvector;

-- Create the GIN index for full-text search
CREATE INDEX IF NOT EXISTS projects_search_vector_gin_idx ON projects USING GIN (search_vector);

-- Create the trigger function to update search_vector
CREATE OR REPLACE FUNCTION projects_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.owner, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW.upstream_description, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW.upstream_language, '')), 'D') ||
    setweight(to_tsvector('english', coalesce(
      (SELECT string_agg(t, ' ') FROM jsonb_array_elements_text(coalesce(NEW.upstream_topics, '[]'::jsonb)) AS t),
      ''
    )), 'D');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach the trigger
CREATE TRIGGER projects_search_vector_trigger
  BEFORE INSERT OR UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION projects_search_vector_update();
```

**Step 3: Commit**

```bash
git add packages/shared/drizzle/
git commit -m "feat(shared): add full-text search migration with weighted tsvector trigger"
```

---

## Task 18: Dockerfiles

**Files:**
- Create: `packages/api/Dockerfile`
- Create: `packages/frontend/Dockerfile`
- Create: `packages/sync/Dockerfile`

**Step 1: Write API Dockerfile**

`packages/api/Dockerfile`:
```dockerfile
FROM node:22-alpine AS base
RUN corepack enable

FROM base AS build
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/
RUN pnpm install --frozen-lockfile
COPY packages/shared/ packages/shared/
COPY packages/api/ packages/api/
RUN pnpm --filter @copr-index/shared build
RUN pnpm --filter @copr-index/api build

FROM base AS runtime
WORKDIR /app
COPY --from=build /app/packages/api/dist ./dist
COPY --from=build /app/packages/api/package.json ./
COPY --from=build /app/packages/shared/dist ./node_modules/@copr-index/shared/dist
COPY --from=build /app/packages/shared/package.json ./node_modules/@copr-index/shared/
COPY --from=build /app/node_modules ./node_modules
EXPOSE 4000
CMD ["node", "dist/index.js"]
```

**Step 2: Write Frontend Dockerfile**

`packages/frontend/Dockerfile`:
```dockerfile
FROM node:22-alpine AS base
RUN corepack enable

FROM base AS build
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/frontend/package.json packages/frontend/
RUN pnpm install --frozen-lockfile
COPY packages/shared/ packages/shared/
COPY packages/frontend/ packages/frontend/
RUN pnpm --filter @copr-index/shared build
RUN pnpm --filter @copr-index/frontend build

FROM base AS runtime
WORKDIR /app
COPY --from=build /app/packages/frontend/.next/standalone ./
COPY --from=build /app/packages/frontend/.next/static ./.next/static
COPY --from=build /app/packages/frontend/public ./public
EXPOSE 3000
ENV PORT=3000
CMD ["node", "server.js"]
```

**Step 3: Write Sync Dockerfile**

`packages/sync/Dockerfile`:
```dockerfile
FROM node:22-alpine AS base
RUN corepack enable

FROM base AS build
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/sync/package.json packages/sync/
RUN pnpm install --frozen-lockfile
COPY packages/shared/ packages/shared/
COPY packages/sync/ packages/sync/
RUN pnpm --filter @copr-index/shared build
RUN pnpm --filter @copr-index/sync build

FROM base AS runtime
WORKDIR /app
COPY --from=build /app/packages/sync/dist ./dist
COPY --from=build /app/packages/sync/package.json ./
COPY --from=build /app/packages/shared/dist ./node_modules/@copr-index/shared/dist
COPY --from=build /app/packages/shared/package.json ./node_modules/@copr-index/shared/
COPY --from=build /app/node_modules ./node_modules
CMD ["node", "dist/index.js"]
```

**Step 4: Commit**

```bash
git add packages/api/Dockerfile packages/frontend/Dockerfile packages/sync/Dockerfile
git commit -m "feat: add Dockerfiles for api, frontend, and sync-worker"
```

---

## Task 19: Podman Compose Configuration

**Files:**
- Create: `podman-compose.yml`

**Step 1: Write podman-compose.yml**

`podman-compose.yml`:
```yaml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    volumes:
      - pgdata:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: copr_index
      POSTGRES_USER: copr
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U copr -d copr_index"]
      interval: 5s
      timeout: 5s
      retries: 5

  api:
    build:
      context: .
      dockerfile: packages/api/Dockerfile
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://copr:${POSTGRES_PASSWORD}@postgres:5432/copr_index
      GITHUB_TOKEN: ${GITHUB_TOKEN}
      PORT: "4000"
    ports:
      - "4000:4000"

  frontend:
    build:
      context: .
      dockerfile: packages/frontend/Dockerfile
    restart: unless-stopped
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
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://copr:${POSTGRES_PASSWORD}@postgres:5432/copr_index
      GITHUB_TOKEN: ${GITHUB_TOKEN}
      COPR_SYNC_INTERVAL_HOURS: "6"
      STARS_SYNC_INTERVAL_HOURS: "12"

  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel run
    environment:
      TUNNEL_TOKEN: ${CLOUDFLARED_TUNNEL_TOKEN}
    depends_on:
      - frontend
      - api

volumes:
  pgdata:
```

**Step 2: Commit**

```bash
git add podman-compose.yml
git commit -m "feat: add podman-compose.yml with all 5 services"
```

---

## Task 20: Frontend Styles

**Files:**
- Modify: `packages/frontend/src/app/globals.css`

**Step 1: Add component styles**

Append to `packages/frontend/src/app/globals.css`:
```css
/* Hero */
.hero {
  text-align: center;
  padding: 3rem 0;
}

.hero h1 {
  font-size: 2.5rem;
  margin-bottom: 0.5rem;
}

.hero p {
  color: var(--muted);
  margin-bottom: 1.5rem;
}

/* Search */
.search-bar {
  display: flex;
  gap: 0.5rem;
  max-width: 600px;
  margin: 0 auto;
}

.search-bar input {
  flex: 1;
  padding: 0.75rem 1rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--card-bg);
  color: var(--fg);
  font-size: 1rem;
}

.search-bar button {
  padding: 0.75rem 1.5rem;
  background: var(--accent);
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 1rem;
}

/* Card Grid */
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 1rem;
  margin-top: 1rem;
}

.card {
  display: block;
  padding: 1.25rem;
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  text-decoration: none;
  color: var(--fg);
  transition: border-color 0.2s;
}

.card:hover {
  border-color: var(--accent);
}

.card-header h3 {
  font-size: 1.1rem;
  margin-bottom: 0.25rem;
}

.card-header .owner {
  font-size: 0.85rem;
  color: var(--muted);
}

.card .description {
  margin: 0.75rem 0;
  font-size: 0.9rem;
  color: var(--muted);
}

.card-footer {
  display: flex;
  gap: 0.75rem;
  font-size: 0.8rem;
}

.card-footer .stars {
  color: #fbbf24;
}

.card-footer .language {
  color: var(--accent);
}

/* Section */
.section {
  margin-top: 3rem;
}

.section h2 {
  margin-bottom: 1rem;
  font-size: 1.5rem;
}

/* Category Grid */
.category-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 0.75rem;
}

.category-tile {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  text-decoration: none;
  color: var(--fg);
}

.category-tile .count {
  color: var(--muted);
  font-size: 0.85rem;
}

/* Browse Layout */
.browse-layout {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 2rem;
  margin-top: 1.5rem;
}

.filters h3 {
  margin-top: 1.5rem;
  margin-bottom: 0.5rem;
  font-size: 0.9rem;
  text-transform: uppercase;
  color: var(--muted);
}

.filters h3:first-child {
  margin-top: 0;
}

.filters ul {
  list-style: none;
}

.filters ul li a {
  display: block;
  padding: 0.3rem 0;
  color: var(--fg);
  text-decoration: none;
  font-size: 0.9rem;
}

.filters ul li a.active {
  color: var(--accent);
  font-weight: 600;
}

.result-count {
  color: var(--muted);
  margin-bottom: 1rem;
}

/* Pagination */
.pagination {
  display: flex;
  gap: 1rem;
  align-items: center;
  justify-content: center;
  margin-top: 2rem;
}

.pagination a {
  color: var(--accent);
  text-decoration: none;
}

/* Project Detail */
.project-detail section {
  margin-top: 2rem;
}

.project-header {
  display: flex;
  align-items: baseline;
  gap: 1rem;
  flex-wrap: wrap;
}

.project-header .owner {
  color: var(--muted);
}

.stars-badge {
  background: #1c1c1c;
  border: 1px solid #333;
  padding: 0.25rem 0.75rem;
  border-radius: 20px;
  font-size: 0.85rem;
  color: #fbbf24;
}

.code-block {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  background: #111;
  padding: 0.75rem 1rem;
  border-radius: 8px;
  font-family: monospace;
  font-size: 0.9rem;
}

.copy-btn {
  padding: 0.4rem 0.75rem;
  background: var(--accent);
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.8rem;
  white-space: nowrap;
}

.badge-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.badge, .language-badge {
  padding: 0.2rem 0.6rem;
  background: #222;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 0.8rem;
}

.language-badge {
  color: var(--accent);
  margin-left: 0.5rem;
}

.instructions {
  margin-top: 1rem;
  white-space: pre-wrap;
  color: var(--muted);
}

.package-list {
  list-style: none;
}

.package-list li {
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--border);
  display: flex;
  gap: 0.75rem;
  align-items: center;
}

.source-type {
  font-size: 0.8rem;
  color: var(--muted);
}

.comments-section {
  margin-top: 3rem;
}

/* Responsive */
@media (max-width: 768px) {
  .browse-layout {
    grid-template-columns: 1fr;
  }

  .hero h1 {
    font-size: 1.75rem;
  }

  .card-grid {
    grid-template-columns: 1fr;
  }
}
```

**Step 2: Commit**

```bash
git add packages/frontend/src/app/globals.css
git commit -m "feat(frontend): add dark theme styles for all components"
```

---

## Task 21: Final Integration - Wire Up and Verify

**Step 1: Create `.env` from `.env.example`**

Run: `cp .env.example .env` and fill in at least `POSTGRES_PASSWORD`.

**Step 2: Start PostgreSQL**

Run: `podman-compose up -d postgres`
Expected: PostgreSQL container running, healthy.

**Step 3: Run Drizzle migrations**

Run: `cd packages/shared && DATABASE_URL=postgresql://copr:changeme@localhost:5432/copr_index pnpm db:migrate`
Expected: Tables created.

**Step 4: Apply the custom search vector migration**

Run: `psql postgresql://copr:changeme@localhost:5432/copr_index < packages/shared/drizzle/0001_search_vector.sql`
Expected: Trigger and index created.

**Step 5: Start the API**

Run: `cd packages/api && DATABASE_URL=postgresql://copr:changeme@localhost:5432/copr_index pnpm dev`
Expected: "API server running on http://localhost:4000"

**Step 6: Verify health endpoint**

Run: `curl http://localhost:4000/api/health`
Expected: `{"status":"ok","timestamp":"..."}`

**Step 7: Start the frontend**

Run: `cd packages/frontend && API_URL=http://localhost:4000 pnpm dev`
Expected: Next.js dev server on http://localhost:3000

**Step 8: Build and start full stack with podman-compose**

Run: `podman-compose up --build`
Expected: All 5 containers running. Frontend accessible on :3000, API on :4000.

**Step 9: Commit any remaining fixes**

```bash
git add -A
git commit -m "chore: finalize integration and configuration"
```

---

## Summary

| Task | Component | Description |
|------|-----------|-------------|
| 1 | Monorepo | pnpm workspace, tsconfig, packages |
| 2 | Shared | Drizzle schema (projects, packages, categories) |
| 3 | Shared | API response TypeScript types |
| 4 | Shared | Upstream URL parser + tests |
| 5 | API | Hono server + health endpoint + test |
| 6 | API | Projects routes (list/search, detail, packages) |
| 7 | API | Categories + stats routes |
| 8 | Sync | COPR project sync + upstream discovery + test |
| 9 | Sync | GitHub/GitLab star sync + test |
| 10 | Sync | Cron scheduler entry point |
| 11 | Frontend | Next.js setup, layout, API client |
| 12 | Frontend | ProjectCard + SearchBar components |
| 13 | Frontend | Homepage |
| 14 | Frontend | Search/browse page |
| 15 | Frontend | Project detail + Giscus + CopyButton |
| 16 | Frontend | Owner + category pages |
| 17 | DB | Full-text search migration (tsvector trigger) |
| 18 | Infra | Dockerfiles for api, frontend, sync |
| 19 | Infra | podman-compose.yml |
| 20 | Frontend | Dark theme CSS |
| 21 | Infra | Integration verification |
