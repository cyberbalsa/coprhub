# API Schema Update Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bring the REST API and OpenAPI spec in line with every column in the database — expose all fields, add ILIKE wildcard filtering on text columns, expand sort to every sortable column, and document the comments endpoint.

**Architecture:** Flat additive expansion. No breaking changes. New fields added to existing response shapes. A small `textFilter` helper handles `*` → ILIKE conversion. All changes are in 4 files plus 1 new test file.

**Tech Stack:** TypeScript, Hono, Drizzle ORM, PostgreSQL ILIKE, OpenAPI 3.1.0, Vitest

---

### Task 1: Update shared types — ProjectSummary

**Files:**
- Modify: `packages/shared/src/types.ts:1-14`

**Step 1: Add new fields to ProjectSummary**

Replace the entire `ProjectSummary` interface:

```typescript
export interface ProjectSummary {
  id: number;
  coprId: number | null;
  fullName: string;
  owner: string;
  name: string;
  description: string | null;
  upstreamUrl: string | null;
  upstreamProvider: "github" | "gitlab" | null;
  upstreamStars: number;
  upstreamLanguage: string | null;
  popularityScore: number;
  coprVotes: number;
  coprDownloads: number;
  coprRepoEnables: number;
  discourseLikes: number;
  discourseViews: number;
  discourseReplies: number;
  lastBuildAt: string | null;
  updatedAt: string | null;
}
```

**Step 2: Add new fields to ProjectDetail**

Replace the entire `ProjectDetail` interface:

```typescript
export interface ProjectDetail extends ProjectSummary {
  instructions: string | null;
  homepage: string | null;
  chroots: string[] | null;
  repoUrl: string | null;
  upstreamForks: number;
  upstreamDescription: string | null;
  upstreamTopics: string[] | null;
  upstreamReadme: string | null;
  discourseTopicId: number | null;
  lastSyncedAt: string | null;
  lastBuildAt: string | null;
  createdAt: string | null;
  readmeSyncedAt: string | null;
  votesSyncedAt: string | null;
  starsSyncedAt: string | null;
  discourseSyncedAt: string | null;
  updatedAt: string | null;
}
```

Note: `lastBuildAt` and `updatedAt` appear in both — ProjectDetail re-declares them (inherited from Summary, listed here for clarity since both interfaces existed with these already).

**Step 3: Update ProjectsQuery sort type and add filter fields**

Replace the `ProjectsQuery` interface:

```typescript
export interface ProjectsQuery {
  q?: string;
  sort?: "id" | "coprId" | "popularity" | "stars" | "forks" | "votes" | "downloads" | "enables" | "likes" | "views" | "replies" | "discourseTopicId" | "name" | "owner" | "language" | "provider" | "updated" | "created" | "lastBuild" | "lastSynced" | "starsSynced" | "readmeSynced" | "votesSynced" | "discourseSynced";
  order?: "asc" | "desc";
  category?: string;
  owner?: string;
  name?: string;
  fullName?: string;
  language?: string;
  provider?: string;
  description?: string;
  instructions?: string;
  homepage?: string;
  upstreamUrl?: string;
  upstreamDescription?: string;
  upstreamReadme?: string;
  page?: number;
  limit?: number;
}
```

**Step 4: Run type check**

Run: `cd /home/balsa/Documents/Projects/copr-index && ~/.bun/bin/bun run build 2>&1 | head -50`
Expected: Type errors in projects.ts and categories.ts (they don't return the new fields yet). That's expected — we fix them in later tasks.

**Step 5: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat(shared): expand ProjectSummary, ProjectDetail, ProjectsQuery types"
```

---

### Task 2: Write and test ILIKE filter helper

**Files:**
- Create: `packages/api/src/filters.ts`
- Create: `packages/api/src/filters.test.ts`

**Step 1: Write the failing test**

Create `packages/api/src/filters.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildTextFilter } from "./filters.js";
import { sql } from "drizzle-orm";
import { projects } from "@coprhub/shared";

describe("buildTextFilter", () => {
  it("returns eq condition for exact match (no wildcard)", () => {
    const result = buildTextFilter(projects.owner, "atim");
    // Should produce an eq() condition
    expect(result).toBeDefined();
    expect(result!.toSQL).toBeDefined(); // is a Drizzle SQL expression
  });

  it("returns ilike condition when value contains *", () => {
    const result = buildTextFilter(projects.owner, "@group*");
    expect(result).toBeDefined();
  });

  it("converts * to % for ILIKE", () => {
    const result = buildTextFilter(projects.owner, "*neovim*");
    expect(result).toBeDefined();
  });

  it("returns undefined for empty/undefined value", () => {
    expect(buildTextFilter(projects.owner, undefined)).toBeUndefined();
    expect(buildTextFilter(projects.owner, "")).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /home/balsa/Documents/Projects/copr-index && ~/.bun/bin/bun --filter @coprhub/api test -- filters`
Expected: FAIL — module `./filters.js` not found

**Step 3: Write minimal implementation**

Create `packages/api/src/filters.ts`:

```typescript
import { eq, ilike } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

export function buildTextFilter(column: PgColumn, value: string | undefined) {
  if (!value) return undefined;
  if (value.includes("*")) {
    return ilike(column, value.replaceAll("*", "%"));
  }
  return eq(column, value);
}
```

**Step 4: Run test to verify it passes**

Run: `cd /home/balsa/Documents/Projects/copr-index && ~/.bun/bin/bun --filter @coprhub/api test -- filters`
Expected: PASS (all 4 tests)

**Step 5: Commit**

```bash
git add packages/api/src/filters.ts packages/api/src/filters.test.ts
git commit -m "feat(api): add buildTextFilter helper for ILIKE wildcard support"
```

---

### Task 3: Update project list endpoint

**Files:**
- Modify: `packages/api/src/routes/projects.ts:1-100`

**Step 1: Add import for buildTextFilter and ilike**

At the top of the file, add the `buildTextFilter` import and update drizzle-orm import:

```typescript
import { Hono } from "hono";
import { eq, desc, asc, sql, and } from "drizzle-orm";
import {
  projects,
  packages as packagesTable,
  categories,
  projectCategories,
  discourseCache,
} from "@coprhub/shared";
import type { Db } from "@coprhub/shared";
import type { ProjectsQuery, PaginatedResponse, ProjectSummary, ProjectDetail, PackageInfo } from "@coprhub/shared";
import { buildTextFilter } from "../filters.js";
```

**Step 2: Update query parameter parsing in GET /**

Replace the query parsing block (lines ~17-26) with:

```typescript
    const query: ProjectsQuery = {
      q: c.req.query("q"),
      sort: (c.req.query("sort") as ProjectsQuery["sort"]) || "popularity",
      order: (c.req.query("order") as ProjectsQuery["order"]) || "desc",
      category: c.req.query("category"),
      owner: c.req.query("owner"),
      name: c.req.query("name"),
      fullName: c.req.query("fullName"),
      language: c.req.query("language"),
      provider: c.req.query("provider"),
      description: c.req.query("description"),
      instructions: c.req.query("instructions"),
      homepage: c.req.query("homepage"),
      upstreamUrl: c.req.query("upstreamUrl"),
      upstreamDescription: c.req.query("upstreamDescription"),
      upstreamReadme: c.req.query("upstreamReadme"),
      page: parseInt(c.req.query("page") || "1", 10),
      limit: Math.min(parseInt(c.req.query("limit") || "24", 10), 100),
    };
```

**Step 3: Replace filter conditions block**

Replace the conditions block (lines ~28-35) with:

```typescript
    const conditions: any[] = [];

    // ILIKE text filters (supports * wildcards)
    const textFilters: [typeof projects.owner, string | undefined][] = [
      [projects.owner, query.owner],
      [projects.name, query.name],
      [projects.fullName, query.fullName],
      [projects.upstreamLanguage, query.language],
      [projects.upstreamProvider, query.provider],
      [projects.description, query.description],
      [projects.instructions, query.instructions],
      [projects.homepage, query.homepage],
      [projects.upstreamUrl, query.upstreamUrl],
      [projects.upstreamDescription, query.upstreamDescription],
      [projects.upstreamReadme, query.upstreamReadme],
    ];
    for (const [col, val] of textFilters) {
      const f = buildTextFilter(col, val);
      if (f) conditions.push(f);
    }

    // Full-text search
    if (query.q) {
      conditions.push(
        sql`${projects.searchVector}::tsvector @@ plainto_tsquery('english', ${query.q})`
      );
    }
```

**Step 4: Expand orderMap to all 24 sort fields**

Replace the orderMap (lines ~39-49) with:

```typescript
    const orderMap: Record<string, any> = {
      id: projects.id,
      coprId: projects.coprId,
      popularity: projects.popularityScore,
      stars: projects.upstreamStars,
      forks: projects.upstreamForks,
      votes: projects.coprVotes,
      downloads: projects.coprDownloads,
      enables: projects.coprRepoEnables,
      likes: projects.discourseLikes,
      views: projects.discourseViews,
      replies: projects.discourseReplies,
      discourseTopicId: projects.discourseTopicId,
      name: projects.fullName,
      owner: projects.owner,
      language: projects.upstreamLanguage,
      provider: projects.upstreamProvider,
      updated: projects.updatedAt,
      created: projects.createdAt,
      lastBuild: projects.lastBuildAt,
      lastSynced: projects.lastSyncedAt,
      starsSynced: projects.starsSyncedAt,
      readmeSynced: projects.readmeSyncedAt,
      votesSynced: projects.votesSyncedAt,
      discourseSynced: projects.discourseSyncedAt,
    };
```

**Step 5: Expand the select to include all ProjectSummary fields**

Replace the `.select({...})` block (lines ~56-69) with:

```typescript
      db
        .select({
          id: projects.id,
          coprId: projects.coprId,
          fullName: projects.fullName,
          owner: projects.owner,
          name: projects.name,
          description: projects.description,
          upstreamUrl: projects.upstreamUrl,
          upstreamProvider: projects.upstreamProvider,
          upstreamStars: projects.upstreamStars,
          upstreamLanguage: projects.upstreamLanguage,
          popularityScore: projects.popularityScore,
          coprVotes: projects.coprVotes,
          coprDownloads: projects.coprDownloads,
          coprRepoEnables: projects.coprRepoEnables,
          discourseLikes: projects.discourseLikes,
          discourseViews: projects.discourseViews,
          discourseReplies: projects.discourseReplies,
          lastBuildAt: projects.lastBuildAt,
          updatedAt: projects.updatedAt,
        })
```

**Step 6: Update the mapping function to handle all new fields**

Replace the `mapped` block (lines ~83-89) with:

```typescript
    const mapped: ProjectSummary[] = data.map((row) => ({
      ...row,
      upstreamStars: row.upstreamStars ?? 0,
      popularityScore: row.popularityScore ?? 0,
      coprVotes: row.coprVotes ?? 0,
      coprDownloads: row.coprDownloads ?? 0,
      coprRepoEnables: row.coprRepoEnables ?? 0,
      discourseLikes: row.discourseLikes ?? 0,
      discourseViews: row.discourseViews ?? 0,
      discourseReplies: row.discourseReplies ?? 0,
      lastBuildAt: row.lastBuildAt?.toISOString() ?? null,
      updatedAt: row.updatedAt?.toISOString() ?? null,
    }));
```

**Step 7: Commit**

```bash
git add packages/api/src/routes/projects.ts
git commit -m "feat(api): expand project list with all fields, ILIKE filters, full sort"
```

---

### Task 4: Update project detail endpoint

**Files:**
- Modify: `packages/api/src/routes/projects.ts:102-144`

**Step 1: Add all missing fields to the detail response**

Replace the return block in `GET /:owner/:name` (lines ~115-143) with:

```typescript
    const project = result[0];
    return c.json({
      id: project.id,
      coprId: project.coprId,
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
      upstreamReadme: project.upstreamReadme ?? null,
      coprVotes: project.coprVotes ?? 0,
      coprDownloads: project.coprDownloads ?? 0,
      coprRepoEnables: project.coprRepoEnables ?? 0,
      discourseLikes: project.discourseLikes ?? 0,
      discourseViews: project.discourseViews ?? 0,
      discourseReplies: project.discourseReplies ?? 0,
      discourseTopicId: project.discourseTopicId,
      popularityScore: project.popularityScore ?? 0,
      lastBuildAt: project.lastBuildAt?.toISOString() ?? null,
      lastSyncedAt: project.lastSyncedAt?.toISOString() ?? null,
      createdAt: project.createdAt?.toISOString() ?? null,
      readmeSyncedAt: project.readmeSyncedAt?.toISOString() ?? null,
      votesSyncedAt: project.votesSyncedAt?.toISOString() ?? null,
      starsSyncedAt: project.starsSyncedAt?.toISOString() ?? null,
      discourseSyncedAt: project.discourseSyncedAt?.toISOString() ?? null,
      updatedAt: project.updatedAt?.toISOString() ?? null,
    } satisfies ProjectDetail);
```

**Step 2: Commit**

```bash
git add packages/api/src/routes/projects.ts
git commit -m "feat(api): expose all DB fields in project detail response"
```

---

### Task 5: Update categories endpoint

**Files:**
- Modify: `packages/api/src/routes/categories.ts:31-49`

**Step 1: Expand the select in GET /:slug to match ProjectSummary**

Replace the `.select({...})` block (lines ~32-42) with:

```typescript
      .select({
        id: projects.id,
        coprId: projects.coprId,
        fullName: projects.fullName,
        owner: projects.owner,
        name: projects.name,
        description: projects.description,
        upstreamUrl: projects.upstreamUrl,
        upstreamProvider: projects.upstreamProvider,
        upstreamStars: projects.upstreamStars,
        upstreamLanguage: projects.upstreamLanguage,
        popularityScore: projects.popularityScore,
        coprVotes: projects.coprVotes,
        coprDownloads: projects.coprDownloads,
        coprRepoEnables: projects.coprRepoEnables,
        discourseLikes: projects.discourseLikes,
        discourseViews: projects.discourseViews,
        discourseReplies: projects.discourseReplies,
        lastBuildAt: projects.lastBuildAt,
        updatedAt: projects.updatedAt,
      })
```

**Step 2: Commit**

```bash
git add packages/api/src/routes/categories.ts
git commit -m "feat(api): expand category project list to match ProjectSummary"
```

---

### Task 6: Update OpenAPI spec — schemas

**Files:**
- Modify: `packages/api/src/openapi.ts`

**Step 1: Update ProjectSummary schema**

Replace the `ProjectSummary` schema (lines ~306-321) with:

```typescript
      ProjectSummary: {
        type: "object",
        properties: {
          id: { type: "integer" },
          coprId: { type: ["integer", "null"] },
          fullName: { type: "string", examples: ["atim/lazygit"] },
          owner: { type: "string", examples: ["atim"] },
          name: { type: "string", examples: ["lazygit"] },
          description: { type: ["string", "null"] },
          upstreamUrl: { type: ["string", "null"], format: "uri" },
          upstreamProvider: {
            type: ["string", "null"],
            enum: ["github", "gitlab", null],
          },
          upstreamStars: { type: "integer", examples: [42000] },
          upstreamLanguage: { type: ["string", "null"], examples: ["Go"] },
          popularityScore: { type: "integer" },
          coprVotes: { type: "integer" },
          coprDownloads: { type: "integer" },
          coprRepoEnables: { type: "integer" },
          discourseLikes: { type: "integer" },
          discourseViews: { type: "integer" },
          discourseReplies: { type: "integer" },
          lastBuildAt: { type: ["string", "null"], format: "date-time" },
          updatedAt: { type: ["string", "null"], format: "date-time" },
        },
      },
```

**Step 2: Update ProjectDetail schema**

Replace the `ProjectDetail` schema (lines ~323-343) with:

```typescript
      ProjectDetail: {
        type: "object",
        allOf: [{ $ref: "#/components/schemas/ProjectSummary" }],
        properties: {
          instructions: { type: ["string", "null"] },
          homepage: { type: ["string", "null"], format: "uri" },
          chroots: {
            type: ["array", "null"],
            items: { type: "string" },
            examples: [["fedora-40-x86_64", "fedora-41-x86_64"]],
          },
          repoUrl: { type: ["string", "null"], format: "uri" },
          upstreamForks: { type: "integer" },
          upstreamDescription: { type: ["string", "null"] },
          upstreamTopics: {
            type: ["array", "null"],
            items: { type: "string" },
          },
          upstreamReadme: { type: ["string", "null"] },
          discourseTopicId: { type: ["integer", "null"] },
          lastSyncedAt: { type: ["string", "null"], format: "date-time" },
          createdAt: { type: ["string", "null"], format: "date-time" },
          readmeSyncedAt: { type: ["string", "null"], format: "date-time" },
          votesSyncedAt: { type: ["string", "null"], format: "date-time" },
          starsSyncedAt: { type: ["string", "null"], format: "date-time" },
          discourseSyncedAt: { type: ["string", "null"], format: "date-time" },
        },
      },
```

**Step 3: Add CommentPost and CommentsResponse schemas**

Add after the `Error` schema (after line ~394):

```typescript
      CommentPost: {
        type: "object",
        properties: {
          id: { type: "integer" },
          username: { type: "string" },
          avatarUrl: { type: ["string", "null"], format: "uri" },
          content: { type: "string", description: "HTML content from Discourse" },
          createdAt: { type: "string", format: "date-time" },
          likeCount: { type: "integer" },
          replyCount: { type: "integer" },
          postNumber: { type: "integer" },
        },
      },
      CommentsResponse: {
        type: "object",
        properties: {
          data: {
            type: "array",
            items: { $ref: "#/components/schemas/CommentPost" },
          },
          topicUrl: { type: ["string", "null"], format: "uri" },
          title: { type: "string" },
        },
      },
```

**Step 4: Commit**

```bash
git add packages/api/src/openapi.ts
git commit -m "feat(api): update OpenAPI schemas with all DB fields and CommentPost"
```

---

### Task 7: Update OpenAPI spec — parameters and comments path

**Files:**
- Modify: `packages/api/src/openapi.ts`

**Step 1: Update sort enum and default in parameters**

Replace the sort parameter (lines ~42-46) with:

```typescript
          {
            name: "sort",
            in: "query",
            description: "Sort field",
            schema: {
              type: "string",
              enum: ["id", "coprId", "popularity", "stars", "forks", "votes", "downloads", "enables", "likes", "views", "replies", "discourseTopicId", "name", "owner", "language", "provider", "updated", "created", "lastBuild", "lastSynced", "starsSynced", "readmeSynced", "votesSynced", "discourseSynced"],
              default: "popularity",
            },
          },
```

**Step 2: Add all ILIKE filter parameters**

After the existing `language` parameter, add these new parameters (before `page`):

```typescript
          {
            name: "name",
            in: "query",
            description: "Filter by project name (supports * wildcard for ILIKE)",
            schema: { type: "string" },
          },
          {
            name: "fullName",
            in: "query",
            description: "Filter by owner/name (supports * wildcard for ILIKE)",
            schema: { type: "string" },
          },
          {
            name: "provider",
            in: "query",
            description: "Filter by upstream provider (supports * wildcard for ILIKE)",
            schema: { type: "string" },
          },
          {
            name: "description",
            in: "query",
            description: "Filter by description (supports * wildcard for ILIKE)",
            schema: { type: "string" },
          },
          {
            name: "instructions",
            in: "query",
            description: "Filter by instructions text (supports * wildcard for ILIKE)",
            schema: { type: "string" },
          },
          {
            name: "homepage",
            in: "query",
            description: "Filter by homepage URL (supports * wildcard for ILIKE)",
            schema: { type: "string" },
          },
          {
            name: "upstreamUrl",
            in: "query",
            description: "Filter by upstream URL (supports * wildcard for ILIKE)",
            schema: { type: "string" },
          },
          {
            name: "upstreamDescription",
            in: "query",
            description: "Filter by upstream description (supports * wildcard for ILIKE)",
            schema: { type: "string" },
          },
          {
            name: "upstreamReadme",
            in: "query",
            description: "Filter by upstream readme content (supports * wildcard for ILIKE)",
            schema: { type: "string" },
          },
```

**Step 3: Update descriptions for existing filter params**

Update the `owner` parameter description:
```
"Filter by COPR owner username (supports * wildcard for ILIKE)"
```

Update the `language` parameter description:
```
"Filter by upstream primary language (supports * wildcard for ILIKE)"
```

Update the list endpoint description:
```
"Returns a paginated list of COPR projects. Supports full-text search, ILIKE wildcard filtering (use * as wildcard) on text fields, and sorting by any column."
```

**Step 4: Add comments endpoint path**

Add after the `/api/projects/{owner}/{name}/packages` path block:

```typescript
    "/api/projects/{owner}/{name}/comments": {
      get: {
        tags: ["Projects"],
        summary: "Get comments for a project",
        description: "Returns Discourse comments for a COPR project, cached for 12 hours.",
        parameters: [
          {
            name: "owner",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "name",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Comments list",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CommentsResponse" },
              },
            },
          },
          "404": {
            description: "Project not found",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
        },
      },
    },
```

**Step 5: Commit**

```bash
git add packages/api/src/openapi.ts
git commit -m "feat(api): add ILIKE filter params, full sort enum, comments path to OpenAPI"
```

---

### Task 8: Run full test suite and verify

**Step 1: Run all tests**

Run: `cd /home/balsa/Documents/Projects/copr-index && ~/.bun/bin/bun run test`
Expected: All tests pass (openapi.test.ts, health.test.ts, filters.test.ts)

**Step 2: Type-check the whole workspace**

Run: `cd /home/balsa/Documents/Projects/copr-index && ~/.bun/bin/bun run build 2>&1 | tail -20`
Expected: Clean build, no type errors

**Step 3: Verify OpenAPI spec is valid JSON**

Run: `cd /home/balsa/Documents/Projects/copr-index && node -e "const s = require('./packages/api/src/openapi.ts'); console.log('paths:', Object.keys(s.openApiSpec.paths).length, 'schemas:', Object.keys(s.openApiSpec.components.schemas).length)"`
Or simply run the dev server and check `/api/openapi.json` manually.

**Step 4: If any issues, fix and re-run**

Fix any type errors or test failures, then re-run the test suite.

**Step 5: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(api): address test/type issues from API schema update"
```
