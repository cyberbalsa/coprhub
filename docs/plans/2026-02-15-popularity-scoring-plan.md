# Popularity Scoring Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add COPR votes, download stats, Discourse engagement, upstream READMEs, and a composite popularity score to COPRHub, replacing Giscus with Discourse embeds.

**Architecture:** Extend the existing sync worker with a new DB dump parser (votes/downloads) and Discourse API fetcher. Extend stars sync to fetch READMEs. Add new schema columns, API sort options, and frontend components for README display, vote button, and Discourse comments.

**Tech Stack:** Bun, TypeScript, Drizzle ORM, PostgreSQL, Hono, Next.js 15, react-markdown, Vitest

---

### Task 1: Schema — Add New Columns to Drizzle Schema

**Files:**
- Modify: `packages/shared/src/schema.ts`

**Step 1: Add new columns to the projects table definition**

In `packages/shared/src/schema.ts`, add these columns after `upstreamTopics` (line 33) and before `searchVector` (line 34):

```typescript
    upstreamReadme: text("upstream_readme"),
    coprVotes: integer("copr_votes").default(0),
    coprDownloads: integer("copr_downloads").default(0),
    coprRepoEnables: integer("copr_repo_enables").default(0),
    discourseTopicId: integer("discourse_topic_id"),
    discourseLikes: integer("discourse_likes").default(0),
    discourseViews: integer("discourse_views").default(0),
    discourseReplies: integer("discourse_replies").default(0),
    popularityScore: integer("popularity_score").default(0),
    readmeSyncedAt: timestamp("readme_synced_at"),
    votesSyncedAt: timestamp("votes_synced_at"),
```

**Step 2: Add popularity score index**

In the table's index array (after line 45), add:

```typescript
    index("projects_popularity_score_idx").on(table.popularityScore),
```

**Step 3: Commit**

```bash
git add packages/shared/src/schema.ts
git commit -m "feat(shared): add popularity, votes, discourse, and readme schema columns"
```

---

### Task 2: Schema — Add Types for New Fields

**Files:**
- Modify: `packages/shared/src/types.ts`

**Step 1: Add new fields to ProjectSummary**

Add after `upstreamLanguage` (line 10):

```typescript
  popularityScore: number;
  coprVotes: number;
  coprDownloads: number;
```

**Step 2: Add new fields to ProjectDetail**

Add after `upstreamTopics` (line 20):

```typescript
  coprRepoEnables: number;
  discourseLikes: number;
  discourseViews: number;
  discourseReplies: number;
  upstreamReadme: string | null;
  popularityScore: number;
```

Note: `popularityScore`, `coprVotes`, and `coprDownloads` are inherited from `ProjectSummary` via `extends`.

**Step 3: Expand sort options in ProjectsQuery**

Change line 56 from:

```typescript
  sort?: "stars" | "name" | "updated";
```

to:

```typescript
  sort?: "popularity" | "stars" | "votes" | "downloads" | "likes" | "views" | "replies" | "name" | "updated";
```

**Step 4: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat(shared): add popularity and discourse fields to types"
```

---

### Task 3: SQL Migration — Add Columns and Update Search Trigger

**Files:**
- Create: `packages/shared/drizzle/0002_popularity_columns.sql`

**Step 1: Write the migration file**

```sql
-- Add new columns for votes, downloads, discourse, readme, and popularity
ALTER TABLE projects ADD COLUMN IF NOT EXISTS copr_votes integer DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS copr_downloads integer DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS copr_repo_enables integer DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS discourse_topic_id integer;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS discourse_likes integer DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS discourse_views integer DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS discourse_replies integer DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS upstream_readme text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS popularity_score integer DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS readme_synced_at timestamp;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS votes_synced_at timestamp;

-- Index for sorting by popularity
CREATE INDEX IF NOT EXISTS projects_popularity_score_idx ON projects (popularity_score);

-- Update the search vector trigger to include README content
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
    )), 'D') ||
    setweight(to_tsvector('english', coalesce(NEW.upstream_readme, '')), 'D');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

**Step 2: Commit**

```bash
git add packages/shared/drizzle/0002_popularity_columns.sql
git commit -m "feat(shared): add migration for popularity columns and search trigger update"
```

---

### Task 4: Sync — COPR DB Dump Parser

**Files:**
- Create: `packages/sync/src/dump-parser.ts`
- Create: `packages/sync/src/dump-parser.test.ts`

**Step 1: Write the failing test**

Create `packages/sync/src/dump-parser.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseCoprScoreLines, parseCounterStatLines } from "./dump-parser.js";

describe("parseCoprScoreLines", () => {
  it("aggregates scores by copr_id", () => {
    const lines = [
      "1\t5893\t25\t1",
      "2\t5893\t100\t1",
      "3\t5893\t200\t-1",
      "4\t1234\t25\t1",
    ];
    const result = parseCoprScoreLines(lines);
    expect(result.get(5893)).toBe(1); // 1 + 1 - 1
    expect(result.get(1234)).toBe(1);
    expect(result.size).toBe(2);
  });

  it("returns empty map for no lines", () => {
    expect(parseCoprScoreLines([]).size).toBe(0);
  });
});

describe("parseCounterStatLines", () => {
  it("aggregates project_rpms_dl by owner/name", () => {
    const lines = [
      "project_rpms_dl_stat:hset::atim@lazygit\tproject_rpms_dl\t500",
      "project_rpms_dl_stat:hset::atim@lazygit\tproject_rpms_dl\t200",
      "repo_dl_stat::atim@lazygit:fedora-40\trepo_dl\t100",
      "repo_dl_stat::atim@lazygit:fedora-39\trepo_dl\t50",
      "chroot_rpms_dl\tchroot_rpms_dl\t999",
    ];
    const result = parseCounterStatLines(lines);
    expect(result.get("atim/lazygit")).toEqual({
      downloads: 700,
      repoEnables: 150,
    });
  });

  it("handles group projects with @ prefix", () => {
    const lines = [
      "project_rpms_dl_stat:hset::@fedora-llvm-team@llvm-snapshots\tproject_rpms_dl\t42",
    ];
    const result = parseCounterStatLines(lines);
    expect(result.get("@fedora-llvm-team/llvm-snapshots")).toEqual({
      downloads: 42,
      repoEnables: 0,
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /home/balsa/Documents/Projects/copr-index && bun --filter @coprhub/sync test`
Expected: FAIL — module not found

**Step 3: Write the implementation**

Create `packages/sync/src/dump-parser.ts`:

```typescript
/**
 * Parses tab-separated copr_score COPY lines.
 * Format: id\tcopr_id\tuser_id\tscore
 * Returns: Map<copr_id, net_score>
 */
export function parseCoprScoreLines(lines: string[]): Map<number, number> {
  const scores = new Map<number, number>();
  for (const line of lines) {
    const parts = line.split("\t");
    if (parts.length < 4) continue;
    const coprId = parseInt(parts[1], 10);
    const score = parseInt(parts[3], 10);
    if (isNaN(coprId) || isNaN(score)) continue;
    scores.set(coprId, (scores.get(coprId) ?? 0) + score);
  }
  return scores;
}

export interface DownloadStats {
  downloads: number;
  repoEnables: number;
}

/**
 * Parses tab-separated counter_stat COPY lines.
 * Extracts project_rpms_dl and repo_dl entries.
 * Returns: Map<"owner/name", DownloadStats>
 */
export function parseCounterStatLines(lines: string[]): Map<string, DownloadStats> {
  const stats = new Map<string, DownloadStats>();

  for (const line of lines) {
    const parts = line.split("\t");
    if (parts.length < 3) continue;

    const name = parts[0];
    const type = parts[1];
    const count = parseInt(parts[2], 10);
    if (isNaN(count)) continue;

    let ownerName: string | null = null;

    if (type === "project_rpms_dl") {
      // Format: project_rpms_dl_stat:hset::{owner}@{name}
      const match = name.match(/^project_rpms_dl_stat:hset::(.+)$/);
      if (!match) continue;
      ownerName = parseOwnerAtName(match[1]);
      if (!ownerName) continue;
      const existing = stats.get(ownerName) ?? { downloads: 0, repoEnables: 0 };
      existing.downloads += count;
      stats.set(ownerName, existing);
    } else if (type === "repo_dl") {
      // Format: repo_dl_stat::{owner}@{name}:{chroot}
      const match = name.match(/^repo_dl_stat::(.+)$/);
      if (!match) continue;
      // Strip the :chroot suffix
      const withChroot = match[1];
      const lastColon = withChroot.lastIndexOf(":");
      if (lastColon === -1) continue;
      const ownerAtName = withChroot.substring(0, lastColon);
      ownerName = parseOwnerAtName(ownerAtName);
      if (!ownerName) continue;
      const existing = stats.get(ownerName) ?? { downloads: 0, repoEnables: 0 };
      existing.repoEnables += count;
      stats.set(ownerName, existing);
    }
  }

  return stats;
}

/**
 * Converts "owner@name" to "owner/name".
 * Handles group projects: "@group@name" → "@group/name"
 */
function parseOwnerAtName(raw: string): string | null {
  if (raw.startsWith("@")) {
    // Group project: @group@name
    const atIdx = raw.indexOf("@", 1);
    if (atIdx === -1) return null;
    const group = raw.substring(0, atIdx);
    const name = raw.substring(atIdx + 1);
    if (!name) return null;
    return `${group}/${name}`;
  }
  const atIdx = raw.indexOf("@");
  if (atIdx === -1) return null;
  const owner = raw.substring(0, atIdx);
  const name = raw.substring(atIdx + 1);
  if (!owner || !name) return null;
  return `${owner}/${name}`;
}
```

**Step 4: Run test to verify it passes**

Run: `cd /home/balsa/Documents/Projects/copr-index && bun --filter @coprhub/sync test`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/sync/src/dump-parser.ts packages/sync/src/dump-parser.test.ts
git commit -m "feat(sync): add COPR DB dump parser for votes and download stats"
```

---

### Task 5: Sync — DB Dump Stream Extractor

**Files:**
- Create: `packages/sync/src/dump-stream.ts`
- Create: `packages/sync/src/dump-stream.test.ts`

**Step 1: Write the failing test**

Create `packages/sync/src/dump-stream.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { extractCopySections } from "./dump-stream.js";

describe("extractCopySections", () => {
  it("extracts COPY sections from dump text", () => {
    const dumpContent = [
      "-- some header",
      "COPY public.copr_score (id, copr_id, user_id, score) FROM stdin;",
      "1\t100\t25\t1",
      "2\t200\t30\t-1",
      "\\.",
      "-- other stuff",
      "COPY public.counter_stat (name, counter_type, counter) FROM stdin;",
      "repo_dl_stat::a@b:f40\trepo_dl\t5",
      "\\.",
      "COPY public.build (id) FROM stdin;",
      "999",
      "\\.",
    ].join("\n");

    const result = extractCopySections(dumpContent, [
      "public.copr_score",
      "public.counter_stat",
    ]);

    expect(result["public.copr_score"]).toEqual([
      "1\t100\t25\t1",
      "2\t200\t30\t-1",
    ]);
    expect(result["public.counter_stat"]).toEqual([
      "repo_dl_stat::a@b:f40\trepo_dl\t5",
    ]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /home/balsa/Documents/Projects/copr-index && bun --filter @coprhub/sync test`
Expected: FAIL

**Step 3: Write the implementation**

Create `packages/sync/src/dump-stream.ts`:

```typescript
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";

/**
 * Extracts COPY sections from a pg_dump text string.
 * Used for testing with small inputs.
 */
export function extractCopySections(
  content: string,
  tableNames: string[]
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const t of tableNames) result[t] = [];

  const lines = content.split("\n");
  let currentTable: string | null = null;

  for (const line of lines) {
    if (currentTable) {
      if (line === "\\.") {
        currentTable = null;
        continue;
      }
      result[currentTable].push(line);
      continue;
    }

    for (const tableName of tableNames) {
      if (line.startsWith(`COPY ${tableName} `)) {
        currentTable = tableName;
        break;
      }
    }
  }

  return result;
}

/**
 * Streams a gzipped pg_dump file and extracts COPY sections line by line.
 * Memory-efficient: only stores lines from requested tables.
 */
export async function streamExtractCopySections(
  filePath: string,
  tableNames: string[]
): Promise<Record<string, string[]>> {
  const result: Record<string, string[]> = {};
  for (const t of tableNames) result[t] = [];

  const isGzipped = filePath.endsWith(".gz");
  const fileStream = createReadStream(filePath);
  const inputStream = isGzipped ? fileStream.pipe(createGunzip()) : fileStream;

  const rl = createInterface({ input: inputStream, crlfDelay: Infinity });

  let currentTable: string | null = null;

  for await (const line of rl) {
    if (currentTable) {
      if (line === "\\.") {
        currentTable = null;
        continue;
      }
      result[currentTable].push(line);
      continue;
    }

    for (const tableName of tableNames) {
      if (line.startsWith(`COPY ${tableName} `)) {
        currentTable = tableName;
        break;
      }
    }
  }

  return result;
}
```

**Step 4: Run test to verify it passes**

Run: `cd /home/balsa/Documents/Projects/copr-index && bun --filter @coprhub/sync test`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/sync/src/dump-stream.ts packages/sync/src/dump-stream.test.ts
git commit -m "feat(sync): add COPY section extractor for streaming pg_dump files"
```

---

### Task 6: Sync — Discourse Stats Fetcher

**Files:**
- Create: `packages/sync/src/discourse-sync.ts`
- Create: `packages/sync/src/discourse-sync.test.ts`

**Step 1: Write the failing test**

Create `packages/sync/src/discourse-sync.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { fetchDiscourseTopicByEmbedUrl, fetchDiscourseTopicStats } from "./discourse-sync.js";

describe("fetchDiscourseTopicByEmbedUrl", () => {
  it("returns topic data from search results", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        topics: [
          { id: 45706, slug: "solopasha-hyprland", like_count: 29, views: 7268, posts_count: 141, reply_count: 82 },
        ],
      }),
    });

    const result = await fetchDiscourseTopicByEmbedUrl("solopasha", "hyprland");
    expect(result).toEqual({
      topicId: 45706,
      slug: "solopasha-hyprland",
      likes: 29,
      views: 7268,
      replies: 82,
    });
  });

  it("returns null when no topics found", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ topics: [] }),
    });

    const result = await fetchDiscourseTopicByEmbedUrl("nobody", "nothing");
    expect(result).toBeNull();
  });
});

describe("fetchDiscourseTopicStats", () => {
  it("fetches stats for a known topic ID", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        id: 45706,
        like_count: 29,
        views: 7268,
        posts_count: 141,
        reply_count: 82,
      }),
    });

    const result = await fetchDiscourseTopicStats(45706);
    expect(result).toEqual({ likes: 29, views: 7268, replies: 82 });
  });

  it("returns null on 404", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    const result = await fetchDiscourseTopicStats(99999);
    expect(result).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /home/balsa/Documents/Projects/copr-index && bun --filter @coprhub/sync test`
Expected: FAIL

**Step 3: Write the implementation**

Create `packages/sync/src/discourse-sync.ts`:

```typescript
import { USER_AGENT } from "./user-agent.js";

const DISCOURSE_BASE = "https://discussion.fedoraproject.org";

export interface DiscourseTopicInfo {
  topicId: number;
  slug: string;
  likes: number;
  views: number;
  replies: number;
}

export interface DiscourseStats {
  likes: number;
  views: number;
  replies: number;
}

/**
 * Searches Discourse for a topic matching the COPR project embed URL.
 */
export async function fetchDiscourseTopicByEmbedUrl(
  owner: string,
  name: string
): Promise<DiscourseTopicInfo | null> {
  const embedUrl = `copr.fedorainfracloud.org/coprs/${owner}/${name}`;
  const searchUrl = `${DISCOURSE_BASE}/search.json?q=${encodeURIComponent(embedUrl)}`;

  const res = await fetch(searchUrl, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) return null;

  const data = await res.json();
  const topics = data.topics;
  if (!topics || topics.length === 0) return null;

  const topic = topics[0];
  return {
    topicId: topic.id,
    slug: topic.slug,
    likes: topic.like_count ?? 0,
    views: topic.views ?? 0,
    replies: topic.reply_count ?? 0,
  };
}

/**
 * Fetches stats for a known Discourse topic ID.
 */
export async function fetchDiscourseTopicStats(
  topicId: number
): Promise<DiscourseStats | null> {
  const res = await fetch(`${DISCOURSE_BASE}/t/${topicId}.json`, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) return null;

  const data = await res.json();
  return {
    likes: data.like_count ?? 0,
    views: data.views ?? 0,
    replies: data.reply_count ?? 0,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `cd /home/balsa/Documents/Projects/copr-index && bun --filter @coprhub/sync test`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/sync/src/discourse-sync.ts packages/sync/src/discourse-sync.test.ts
git commit -m "feat(sync): add Discourse topic discovery and stats fetcher"
```

---

### Task 7: Sync — Popularity Score Calculator

**Files:**
- Create: `packages/sync/src/popularity.ts`
- Create: `packages/sync/src/popularity.test.ts`

**Step 1: Write the failing test**

Create `packages/sync/src/popularity.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { computePopularityScore, WEIGHTS } from "./popularity.js";

describe("computePopularityScore", () => {
  it("computes weighted score", () => {
    const score = computePopularityScore({
      stars: 100,
      votes: 10,
      downloads: 50000,
      repoEnables: 2000,
      discourseLikes: 20,
      discourseReplies: 50,
      discourseViews: 5000,
    });

    // stars*10 + votes*5 + min(downloads*0.01, 1000) + min(repoEnables*0.1, 500)
    // + likes*3 + replies*1 + ln(5000)*2
    const expected =
      100 * WEIGHTS.stars +
      10 * WEIGHTS.votes +
      Math.min(50000 * WEIGHTS.downloads, WEIGHTS.downloadsCap) +
      Math.min(2000 * WEIGHTS.repoEnables, WEIGHTS.repoEnablesCap) +
      20 * WEIGHTS.discourseLikes +
      50 * WEIGHTS.discourseReplies +
      Math.floor(Math.log(5000) * WEIGHTS.discourseViews);

    expect(score).toBe(expected);
  });

  it("handles all zeros", () => {
    const score = computePopularityScore({
      stars: 0, votes: 0, downloads: 0, repoEnables: 0,
      discourseLikes: 0, discourseReplies: 0, discourseViews: 0,
    });
    expect(score).toBe(0);
  });

  it("caps downloads and repo enables", () => {
    const score1 = computePopularityScore({
      stars: 0, votes: 0, downloads: 999999, repoEnables: 999999,
      discourseLikes: 0, discourseReplies: 0, discourseViews: 0,
    });
    const score2 = computePopularityScore({
      stars: 0, votes: 0, downloads: 100000, repoEnables: 5000,
      discourseLikes: 0, discourseReplies: 0, discourseViews: 0,
    });
    // Both should be capped at the same value
    expect(score1).toBe(score2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /home/balsa/Documents/Projects/copr-index && bun --filter @coprhub/sync test`
Expected: FAIL

**Step 3: Write the implementation**

Create `packages/sync/src/popularity.ts`:

```typescript
import { sql } from "drizzle-orm";
import { projects } from "@coprhub/shared";
import type { Db } from "@coprhub/shared";

export const WEIGHTS = {
  stars: 10,
  votes: 5,
  downloads: 0.01,
  downloadsCap: 1000,
  repoEnables: 0.1,
  repoEnablesCap: 500,
  discourseLikes: 3,
  discourseReplies: 1,
  discourseViews: 2,
} as const;

export interface PopularityInput {
  stars: number;
  votes: number;
  downloads: number;
  repoEnables: number;
  discourseLikes: number;
  discourseReplies: number;
  discourseViews: number;
}

export function computePopularityScore(input: PopularityInput): number {
  return Math.floor(
    input.stars * WEIGHTS.stars +
    input.votes * WEIGHTS.votes +
    Math.min(input.downloads * WEIGHTS.downloads, WEIGHTS.downloadsCap) +
    Math.min(input.repoEnables * WEIGHTS.repoEnables, WEIGHTS.repoEnablesCap) +
    input.discourseLikes * WEIGHTS.discourseLikes +
    input.discourseReplies * WEIGHTS.discourseReplies +
    (input.discourseViews > 0
      ? Math.log(input.discourseViews) * WEIGHTS.discourseViews
      : 0)
  );
}

/**
 * Recomputes popularity_score for all projects using a single SQL UPDATE.
 */
export async function recomputeAllPopularityScores(db: Db): Promise<void> {
  console.log("Recomputing popularity scores...");
  await db.execute(sql`
    UPDATE projects SET popularity_score =
      (COALESCE(upstream_stars, 0) * ${WEIGHTS.stars}) +
      (COALESCE(copr_votes, 0) * ${WEIGHTS.votes}) +
      LEAST(COALESCE(copr_downloads, 0) * ${WEIGHTS.downloads}, ${WEIGHTS.downloadsCap})::integer +
      LEAST(COALESCE(copr_repo_enables, 0) * ${WEIGHTS.repoEnables}, ${WEIGHTS.repoEnablesCap})::integer +
      (COALESCE(discourse_likes, 0) * ${WEIGHTS.discourseLikes}) +
      (COALESCE(discourse_replies, 0) * ${WEIGHTS.discourseReplies}) +
      (ln(greatest(COALESCE(discourse_views, 0), 1)) * ${WEIGHTS.discourseViews})::integer
  `);
  console.log("Popularity scores recomputed.");
}
```

**Step 4: Run test to verify it passes**

Run: `cd /home/balsa/Documents/Projects/copr-index && bun --filter @coprhub/sync test`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/sync/src/popularity.ts packages/sync/src/popularity.test.ts
git commit -m "feat(sync): add popularity score calculator with configurable weights"
```

---

### Task 8: Sync — Votes Sync Orchestrator

**Files:**
- Create: `packages/sync/src/votes-sync.ts`

**Step 1: Write the orchestrator**

Create `packages/sync/src/votes-sync.ts`:

```typescript
import { eq } from "drizzle-orm";
import { projects } from "@coprhub/shared";
import type { Db } from "@coprhub/shared";
import { streamExtractCopySections } from "./dump-stream.js";
import { parseCoprScoreLines, parseCounterStatLines } from "./dump-parser.js";
import { fetchDiscourseTopicByEmbedUrl, fetchDiscourseTopicStats } from "./discourse-sync.js";
import { recomputeAllPopularityScores } from "./popularity.js";
import { USER_AGENT } from "./user-agent.js";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const DUMP_INDEX_URL = "https://copr.fedorainfracloud.org/db_dumps/";

async function findLatestDumpUrl(): Promise<string> {
  const res = await fetch(DUMP_INDEX_URL, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) throw new Error(`Failed to fetch dump index: ${res.status}`);

  const html = await res.text();
  // Find all .gz links in the directory listing
  const matches = [...html.matchAll(/href="(copr_db-[^"]+\.gz)"/g)];
  if (matches.length === 0) throw new Error("No dump files found");

  // Take the last (most recent) one
  const latest = matches[matches.length - 1][1];
  return `${DUMP_INDEX_URL}${latest}`;
}

async function downloadDump(url: string): Promise<string> {
  console.log(`Downloading dump: ${url}`);
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) throw new Error(`Failed to download dump: ${res.status}`);

  const destPath = join(tmpdir(), "copr_dump.gz");
  const buffer = Buffer.from(await res.arrayBuffer());
  await writeFile(destPath, buffer);
  console.log(`Dump saved to ${destPath} (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`);
  return destPath;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function syncVotesAndDownloads(db: Db): Promise<void> {
  console.log("Starting votes/downloads sync from COPR DB dump...");

  // 1. Download the latest dump
  const dumpUrl = await findLatestDumpUrl();
  const dumpPath = await downloadDump(dumpUrl);

  try {
    // 2. Extract relevant COPY sections
    console.log("Parsing dump file...");
    const sections = await streamExtractCopySections(dumpPath, [
      "public.copr_score",
      "public.counter_stat",
    ]);

    // 3. Parse votes
    const votesByCoprId = parseCoprScoreLines(sections["public.copr_score"]);
    console.log(`Parsed ${votesByCoprId.size} projects with votes`);

    // 4. Parse download stats
    const downloadsByFullName = parseCounterStatLines(sections["public.counter_stat"]);
    console.log(`Parsed ${downloadsByFullName.size} projects with download stats`);

    // 5. Fetch all projects to match IDs
    const allProjects = await db
      .select({
        id: projects.id,
        coprId: projects.coprId,
        fullName: projects.fullName,
        owner: projects.owner,
        name: projects.name,
        discourseTopicId: projects.discourseTopicId,
      })
      .from(projects);

    // 6. Batch update votes and downloads
    let votesUpdated = 0;
    let downloadsUpdated = 0;

    for (const project of allProjects) {
      const updates: Record<string, unknown> = {};

      // Match votes by coprId
      if (project.coprId && votesByCoprId.has(project.coprId)) {
        updates.coprVotes = votesByCoprId.get(project.coprId)!;
        votesUpdated++;
      }

      // Match downloads by fullName
      const dlStats = downloadsByFullName.get(project.fullName);
      if (dlStats) {
        updates.coprDownloads = dlStats.downloads;
        updates.coprRepoEnables = dlStats.repoEnables;
        downloadsUpdated++;
      }

      if (Object.keys(updates).length > 0) {
        updates.votesSyncedAt = new Date();
        await db.update(projects).set(updates).where(eq(projects.id, project.id));
      }
    }

    console.log(`Updated ${votesUpdated} projects with votes, ${downloadsUpdated} with downloads`);

    // 7. Sync Discourse stats
    await syncDiscourseStats(db, allProjects);

    // 8. Recompute popularity scores
    await recomputeAllPopularityScores(db);
  } finally {
    // Clean up the downloaded dump
    await unlink(dumpPath).catch(() => {});
  }

  console.log("Votes/downloads sync complete.");
}

async function syncDiscourseStats(
  db: Db,
  allProjects: { id: number; owner: string; name: string; discourseTopicId: number | null }[]
): Promise<void> {
  console.log("Syncing Discourse stats...");
  let discovered = 0;
  let updated = 0;

  for (const project of allProjects) {
    if (project.discourseTopicId) {
      // Already have topic ID — just refresh stats
      const stats = await fetchDiscourseTopicStats(project.discourseTopicId);
      if (stats) {
        await db.update(projects).set({
          discourseLikes: stats.likes,
          discourseViews: stats.views,
          discourseReplies: stats.replies,
        }).where(eq(projects.id, project.id));
        updated++;
      }
    } else {
      // Try to discover topic
      const topic = await fetchDiscourseTopicByEmbedUrl(project.owner, project.name);
      if (topic) {
        await db.update(projects).set({
          discourseTopicId: topic.topicId,
          discourseLikes: topic.likes,
          discourseViews: topic.views,
          discourseReplies: topic.replies,
        }).where(eq(projects.id, project.id));
        discovered++;
      }
    }
    await sleep(200); // Rate limit: ~5 req/s
  }

  console.log(`Discourse sync: ${discovered} discovered, ${updated} updated`);
}
```

**Step 2: Commit**

```bash
git add packages/sync/src/votes-sync.ts
git commit -m "feat(sync): add votes/downloads orchestrator with Discourse stats"
```

---

### Task 9: Sync — Extend Stars Sync to Fetch README

**Files:**
- Modify: `packages/sync/src/stars-sync.ts`

**Step 1: Add README fetch functions**

Add after the `fetchGitLabStars` function (after line 62):

```typescript
const MAX_README_SIZE = 5 * 1024; // 5KB

export async function fetchGitHubReadme(owner: string, repo: string): Promise<string | null> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.raw+json",
    "User-Agent": USER_AGENT,
  };
  if (GITHUB_TOKEN) {
    headers["Authorization"] = `Bearer ${GITHUB_TOKEN}`;
  }

  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/readme`, { headers });
  if (!res.ok) return null;

  const text = await res.text();
  return text.length > MAX_README_SIZE ? text.slice(0, MAX_README_SIZE) : text;
}

export async function fetchGitLabReadme(host: string, projectPath: string): Promise<string | null> {
  const encodedPath = encodeURIComponent(projectPath);
  // Try README.md first, then readme.md
  for (const filename of ["README.md", "readme.md"]) {
    const encodedFile = encodeURIComponent(filename);
    const res = await fetch(
      `https://${host}/api/v4/projects/${encodedPath}/repository/files/${encodedFile}/raw?ref=HEAD`,
      { headers: { "User-Agent": USER_AGENT } }
    );
    if (res.ok) {
      const text = await res.text();
      return text.length > MAX_README_SIZE ? text.slice(0, MAX_README_SIZE) : text;
    }
  }
  return null;
}
```

**Step 2: Update syncAllStars to also fetch README**

In the `syncAllStars` function, update the select query (line 68-74) to also select `upstreamProvider`:

Already selected. Good.

Update the loop body (after line 103, before `await sleep(100)`) to also fetch README:

```typescript
    // Fetch README
    let readme: string | null = null;
    if (parsed.provider === "github") {
      readme = await fetchGitHubReadme(parsed.owner, parsed.repo);
    } else if (parsed.provider === "gitlab") {
      const host = new URL(project.upstreamUrl!).host;
      readme = await fetchGitLabReadme(host, `${parsed.owner}/${parsed.repo}`);
    }
```

Update the db update `.set()` call (lines 94-101) to include:

```typescript
          upstreamReadme: readme,
          readmeSyncedAt: new Date(),
```

**Step 3: Add test for README functions**

Add to `packages/sync/src/stars-sync.test.ts`:

```typescript
import { fetchGitHubReadme } from "./stars-sync.js";

describe("fetchGitHubReadme", () => {
  it("fetches raw README content", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("# My Project\n\nDescription here"),
    });

    const result = await fetchGitHubReadme("owner", "repo");
    expect(result).toBe("# My Project\n\nDescription here");
  });

  it("truncates README to 5KB", async () => {
    const longContent = "x".repeat(10000);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(longContent),
    });

    const result = await fetchGitHubReadme("owner", "repo");
    expect(result?.length).toBe(5120);
  });

  it("returns null on 404", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    const result = await fetchGitHubReadme("owner", "repo");
    expect(result).toBeNull();
  });
});
```

**Step 4: Run tests**

Run: `cd /home/balsa/Documents/Projects/copr-index && bun --filter @coprhub/sync test`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/sync/src/stars-sync.ts packages/sync/src/stars-sync.test.ts
git commit -m "feat(sync): extend stars sync to fetch upstream README (max 5KB)"
```

---

### Task 10: Sync — Wire New Jobs Into Worker

**Files:**
- Modify: `packages/sync/src/index.ts`

**Step 1: Add votes sync to the worker**

Replace the entire file with:

```typescript
import { createDb } from "@coprhub/shared";
import { syncCoprProjects } from "./copr-sync.js";
import { syncAllStars } from "./stars-sync.js";
import { syncVotesAndDownloads } from "./votes-sync.js";
import { recomputeAllPopularityScores } from "./popularity.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const COPR_SYNC_INTERVAL_HOURS = parseInt(process.env.COPR_SYNC_INTERVAL_HOURS || "6", 10);
const STARS_SYNC_INTERVAL_HOURS = parseInt(process.env.STARS_SYNC_INTERVAL_HOURS || "12", 10);
const VOTES_SYNC_INTERVAL_HOURS = parseInt(process.env.VOTES_SYNC_INTERVAL_HOURS || "24", 10);

const db = createDb(DATABASE_URL);

async function runCoprSync() {
  try {
    await syncCoprProjects(db);
    await recomputeAllPopularityScores(db);
  } catch (err) {
    console.error("COPR sync failed:", err);
  }
}

async function runStarSync() {
  try {
    await syncAllStars(db);
    await recomputeAllPopularityScores(db);
  } catch (err) {
    console.error("Star sync failed:", err);
  }
}

async function runVotesSync() {
  try {
    await syncVotesAndDownloads(db);
  } catch (err) {
    console.error("Votes/downloads sync failed:", err);
  }
}

console.log("Sync worker starting...");
console.log(
  `Intervals — COPR: ${COPR_SYNC_INTERVAL_HOURS}h, Stars: ${STARS_SYNC_INTERVAL_HOURS}h, Votes: ${VOTES_SYNC_INTERVAL_HOURS}h`
);

await runCoprSync();
await runStarSync();
await runVotesSync();

setInterval(runCoprSync, COPR_SYNC_INTERVAL_HOURS * 60 * 60 * 1000);
setInterval(runStarSync, STARS_SYNC_INTERVAL_HOURS * 60 * 60 * 1000);
setInterval(runVotesSync, VOTES_SYNC_INTERVAL_HOURS * 60 * 60 * 1000);

console.log("Sync worker running. Waiting for next interval...");
```

**Step 2: Commit**

```bash
git add packages/sync/src/index.ts
git commit -m "feat(sync): wire votes/downloads/discourse sync into worker"
```

---

### Task 11: API — Add New Sort Options and Response Fields

**Files:**
- Modify: `packages/api/src/routes/projects.ts`

**Step 1: Add new sort columns to orderMap**

Replace the `orderMap` (lines 38-42) with:

```typescript
    const orderMap: Record<string, any> = {
      popularity: projects.popularityScore,
      stars: projects.upstreamStars,
      votes: projects.coprVotes,
      downloads: projects.coprDownloads,
      likes: projects.discourseLikes,
      views: projects.discourseViews,
      replies: projects.discourseReplies,
      name: projects.fullName,
      updated: projects.updatedAt,
    };
    const orderCol = orderMap[query.sort || "popularity"] ?? projects.popularityScore;
```

**Step 2: Add new fields to the listing select**

Add after `upstreamLanguage` (line 58):

```typescript
          popularityScore: projects.popularityScore,
          coprVotes: projects.coprVotes,
          coprDownloads: projects.coprDownloads,
```

**Step 3: Add new fields to the detail response**

In the `/:owner/:name` handler, add after `upstreamTopics` (line 113):

```typescript
      coprVotes: project.coprVotes ?? 0,
      coprDownloads: project.coprDownloads ?? 0,
      coprRepoEnables: project.coprRepoEnables ?? 0,
      discourseLikes: project.discourseLikes ?? 0,
      discourseViews: project.discourseViews ?? 0,
      discourseReplies: project.discourseReplies ?? 0,
      upstreamReadme: project.upstreamReadme ?? null,
      popularityScore: project.popularityScore ?? 0,
```

**Step 4: Commit**

```bash
git add packages/api/src/routes/projects.ts
git commit -m "feat(api): add popularity sort options and new response fields"
```

---

### Task 12: Frontend — Replace Giscus with Discourse Embed

**Files:**
- Modify: `packages/frontend/src/components/GiscusComments.tsx` → rename/replace with `DiscourseComments.tsx`
- Create: `packages/frontend/src/components/DiscourseComments.tsx`
- Modify: `packages/frontend/src/app/projects/[owner]/[name]/page.tsx`

**Step 1: Create the Discourse embed component**

Create `packages/frontend/src/components/DiscourseComments.tsx`:

```tsx
"use client";

import { useEffect, useRef } from "react";

interface DiscourseCommentsProps {
  owner: string;
  name: string;
}

export function DiscourseComments({ owner, name }: DiscourseCommentsProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== "https://discussion.fedoraproject.org") return;
      if (event.data?.type === "resize" && iframeRef.current) {
        iframeRef.current.style.height = `${event.data.height}px`;
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const embedUrl = encodeURIComponent(
    `https://copr.fedorainfracloud.org/coprs/${owner}/${name}/`
  );

  return (
    <iframe
      ref={iframeRef}
      src={`https://discussion.fedoraproject.org/embed/comments?embed_url=${embedUrl}`}
      width="100%"
      style={{ border: "none", minHeight: "300px" }}
      scrolling="no"
      referrerPolicy="no-referrer-when-downgrade"
      title="Community Discussion"
    />
  );
}
```

**Step 2: Update the project page to use DiscourseComments**

In `packages/frontend/src/app/projects/[owner]/[name]/page.tsx`:

Replace the import (line 3):
```typescript
// OLD: import { GiscusComments } from "@/components/GiscusComments";
import { DiscourseComments } from "@/components/DiscourseComments";
```

Replace the comments section (lines 119-122):
```tsx
      <section className="comments-section">
        <h2>Community</h2>
        <DiscourseComments owner={owner} name={name} />
      </section>
```

**Step 3: Delete the old GiscusComments component**

Delete `packages/frontend/src/components/GiscusComments.tsx`.

**Step 4: Remove @giscus/react dependency**

Run: `cd /home/balsa/Documents/Projects/copr-index/packages/frontend && bun remove @giscus/react`

**Step 5: Commit**

```bash
git add packages/frontend/src/components/DiscourseComments.tsx packages/frontend/src/app/projects/\[owner\]/\[name\]/page.tsx packages/frontend/package.json
git rm packages/frontend/src/components/GiscusComments.tsx
git commit -m "feat(frontend): replace Giscus with Discourse comment embed"
```

---

### Task 13: Frontend — Add Vote Button, README Display, and Popularity Badge

**Files:**
- Modify: `packages/frontend/src/app/projects/[owner]/[name]/page.tsx`
- Modify: `packages/frontend/src/components/ProjectCard.tsx`
- Install: `react-markdown`, `remark-gfm`

**Step 1: Install markdown dependencies**

Run: `cd /home/balsa/Documents/Projects/copr-index/packages/frontend && bun add react-markdown remark-gfm`

**Step 2: Create a README renderer component**

Create `packages/frontend/src/components/ReadmeDisplay.tsx`:

```tsx
"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ReadmeDisplayProps {
  content: string;
}

export function ReadmeDisplay({ content }: ReadmeDisplayProps) {
  const [expanded, setExpanded] = useState(false);
  const isLong = content.length > 2000;

  return (
    <div className="readme-container">
      <div
        className={`readme-content ${!expanded && isLong ? "readme-collapsed" : ""}`}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
      {isLong && (
        <button
          className="readme-toggle"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
```

**Step 3: Update the project detail page**

Update `packages/frontend/src/app/projects/[owner]/[name]/page.tsx` to add:

Import at top:
```typescript
import { ReadmeDisplay } from "@/components/ReadmeDisplay";
```

Add vote button in the project header (after the stars-badge span, ~line 49):
```tsx
        {project.coprVotes > 0 && (
          <a
            href={`https://copr.fedorainfracloud.org/coprs/${owner}/${name}/`}
            target="_blank"
            rel="noopener"
            className="votes-badge"
            title="Vote on COPR"
          >
            &#128077; {project.coprVotes}
          </a>
        )}
        {project.popularityScore > 0 && (
          <span className="popularity-badge" title="Popularity score">
            &#x1f525; {project.popularityScore.toLocaleString()}
          </span>
        )}
```

Add README section before the comments section (before the `<section className="comments-section">`):
```tsx
      {project.upstreamReadme && (
        <section>
          <h2>README</h2>
          <ReadmeDisplay content={project.upstreamReadme} />
        </section>
      )}
```

**Step 4: Update ProjectCard to show popularity score**

In `packages/frontend/src/components/ProjectCard.tsx`, add after the stars span (after line 19):

```tsx
        {project.popularityScore > 0 && (
          <span className="popularity">
            &#x1f525; {project.popularityScore.toLocaleString()}
          </span>
        )}
        {project.coprVotes > 0 && (
          <span className="votes">&#128077; {project.coprVotes}</span>
        )}
```

**Step 5: Commit**

```bash
git add packages/frontend/src/components/ReadmeDisplay.tsx \
  packages/frontend/src/app/projects/\[owner\]/\[name\]/page.tsx \
  packages/frontend/src/components/ProjectCard.tsx \
  packages/frontend/package.json
git commit -m "feat(frontend): add vote button, popularity badge, and README display"
```

---

### Task 14: Frontend — Update API Client and Sort Options

**Files:**
- Modify: `packages/frontend/src/lib/api-client.ts`
- Modify: `packages/frontend/src/app/page.tsx`

**Step 1: Update the home page to use popularity sort**

In `packages/frontend/src/app/page.tsx`, change line 9 from:

```typescript
    getProjects({ sort: "stars", limit: 12 }),
```

to:

```typescript
    getProjects({ sort: "popularity", limit: 12 }),
```

**Step 2: Commit**

```bash
git add packages/frontend/src/app/page.tsx
git commit -m "feat(frontend): default home page sort to popularity score"
```

---

### Task 15: Update .env.example and Clean Up

**Files:**
- Modify: `.env.example`

**Step 1: Update .env.example**

Remove Giscus vars, add new vars:

Replace `.env.example` contents with:

```
POSTGRES_PASSWORD=changeme
DATABASE_URL=postgresql://copr:changeme@localhost:5432/coprhub
GITHUB_TOKEN=
VOTES_SYNC_INTERVAL_HOURS=24
CLOUDFLARED_TUNNEL_TOKEN=
```

**Step 2: Commit**

```bash
git add .env.example
git commit -m "chore: update .env.example — remove Giscus, add votes sync interval"
```

---

### Task 16: Integration Test — Verify Build

**Step 1: Run all tests**

Run: `cd /home/balsa/Documents/Projects/copr-index && bun run test`
Expected: All tests PASS

**Step 2: Run type check**

Run: `cd /home/balsa/Documents/Projects/copr-index && bun --filter '*' build`
Expected: No type errors

**Step 3: Fix any issues found**

If tests or build fail, fix the issues and create a new commit.

---

## Task Dependency Order

```
Task 1 (schema) → Task 2 (types) → Task 3 (migration SQL)
Task 4 (dump parser) → Task 5 (dump stream) → Task 8 (votes orchestrator)
Task 6 (discourse sync) → Task 8 (votes orchestrator)
Task 7 (popularity calc) → Task 8 (votes orchestrator)
Task 9 (README in stars sync)
Task 10 (wire worker) — depends on Tasks 8, 9
Task 11 (API changes) — depends on Tasks 1, 2
Task 12 (Discourse embed) — independent
Task 13 (vote button, README, popularity) — depends on Tasks 11, 12
Task 14 (sort + home page) — depends on Task 11
Task 15 (env cleanup) — independent
Task 16 (integration test) — depends on all
```

Parallelizable groups:
- **Group A** (schema layer): Tasks 1 → 2 → 3
- **Group B** (sync layer): Tasks 4, 5, 6, 7 → 8 → 9 → 10
- **Group C** (frontend): Tasks 12 → 13 → 14
- **Finale**: Task 15, 16
