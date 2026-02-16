# Scraper TTL Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add TTL-based deduplication to all sync workers so restarts don't re-fetch recently synced data.

**Architecture:** Per-project TTL for stars and discourse syncs (filter by existing timestamp columns in SQL), job-level TTL for dump sync (new `sync_jobs` table). Configurable TTL durations via env vars, with a `FORCE_SYNC` flag to bypass.

**Tech Stack:** Drizzle ORM, PostgreSQL, Bun, Vitest

---

### Task 1: Schema — Add `syncJobs` table and `discourseSyncedAt` column

**Files:**
- Modify: `packages/shared/src/schema.ts:71` (after `discourseCache` table)
- Modify: `packages/shared/src/schema.ts:47` (after `starsSyncedAt`)

**Step 1: Add `syncJobs` table to schema**

In `packages/shared/src/schema.ts`, add after the `discourseCache` table (line 77):

```typescript
export const syncJobs = pgTable("sync_jobs", {
  jobName: text("job_name").primaryKey(),
  lastCompletedAt: timestamp("last_completed_at").notNull(),
  durationMs: integer("duration_ms"),
});
```

**Step 2: Add `discourseSyncedAt` column to projects**

In `packages/shared/src/schema.ts`, add after `starsSyncedAt` (line 47):

```typescript
    discourseSyncedAt: timestamp("discourse_synced_at"),
```

**Step 3: Commit**

```bash
git add packages/shared/src/schema.ts
git commit -m "feat(shared): add sync_jobs table and discourse_synced_at column"
```

---

### Task 2: SQL Migration

**Files:**
- Create: `packages/shared/drizzle/0004_sync_ttl.sql`

**Step 1: Write migration**

```sql
-- Sync TTL: job-level tracking table + per-project discourse timestamp
CREATE TABLE IF NOT EXISTS sync_jobs (
  job_name text PRIMARY KEY,
  last_completed_at timestamp NOT NULL,
  duration_ms integer
);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS discourse_synced_at timestamp;
```

**Step 2: Commit**

```bash
git add packages/shared/drizzle/0004_sync_ttl.sql
git commit -m "chore: add SQL migration for sync_jobs table and discourse_synced_at"
```

---

### Task 3: TTL Helper — Write test then implement

**Files:**
- Create: `packages/sync/src/ttl.ts`
- Create: `packages/sync/src/ttl.test.ts`

**Step 1: Write the failing test**

Create `packages/sync/src/ttl.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { shouldSkipSync } from "./ttl.js";

describe("shouldSkipSync", () => {
  it("returns false when lastSyncedAt is null", () => {
    expect(shouldSkipSync(null, 12)).toBe(false);
  });

  it("returns false when lastSyncedAt is older than TTL", () => {
    const thirteenHoursAgo = new Date(Date.now() - 13 * 60 * 60 * 1000);
    expect(shouldSkipSync(thirteenHoursAgo, 12)).toBe(false);
  });

  it("returns true when lastSyncedAt is within TTL", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    expect(shouldSkipSync(twoHoursAgo, 12)).toBe(true);
  });

  it("returns false when forceSync is true even if within TTL", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    expect(shouldSkipSync(twoHoursAgo, 12, true)).toBe(false);
  });

  it("returns true at exactly the TTL boundary", () => {
    const exactlyTwelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
    expect(shouldSkipSync(exactlyTwelveHoursAgo, 12)).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /home/balsa/Documents/Projects/copr-index && bun --filter @coprhub/sync test -- ttl`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `packages/sync/src/ttl.ts`:

```typescript
/**
 * Check if a sync should be skipped based on TTL.
 * Returns true if the last sync was within the TTL window and forceSync is not set.
 */
export function shouldSkipSync(
  lastSyncedAt: Date | null,
  ttlHours: number,
  forceSync = false,
): boolean {
  if (forceSync) return false;
  if (!lastSyncedAt) return false;
  const age = Date.now() - lastSyncedAt.getTime();
  return age <= ttlHours * 60 * 60 * 1000;
}
```

**Step 4: Run test to verify it passes**

Run: `cd /home/balsa/Documents/Projects/copr-index && bun --filter @coprhub/sync test -- ttl`
Expected: PASS — all 5 tests

**Step 5: Commit**

```bash
git add packages/sync/src/ttl.ts packages/sync/src/ttl.test.ts
git commit -m "feat(sync): add shouldSkipSync TTL helper with tests"
```

---

### Task 4: Update `index.ts` — Read TTL env vars and pass config

**Files:**
- Modify: `packages/sync/src/index.ts`

**Step 1: Update index.ts to read TTL config and pass to sync functions**

Replace the entire file content of `packages/sync/src/index.ts` with:

```typescript
import { createDb } from "@coprhub/shared";
import { syncFromDump } from "./dump-sync.js";
import { syncAllStars } from "./stars-sync.js";
import { syncAllDiscourseStats } from "./discourse-sync.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const DUMP_SYNC_INTERVAL_HOURS = parseInt(process.env.DUMP_SYNC_INTERVAL_HOURS || "24", 10);
const STARS_SYNC_INTERVAL_HOURS = parseInt(process.env.STARS_SYNC_INTERVAL_HOURS || "12", 10);
const DISCOURSE_SYNC_INTERVAL_HOURS = parseInt(process.env.DISCOURSE_SYNC_INTERVAL_HOURS || "24", 10);

const DUMP_SYNC_TTL_HOURS = parseInt(process.env.DUMP_SYNC_TTL_HOURS || String(DUMP_SYNC_INTERVAL_HOURS), 10);
const STARS_SYNC_TTL_HOURS = parseInt(process.env.STARS_SYNC_TTL_HOURS || String(STARS_SYNC_INTERVAL_HOURS), 10);
const DISCOURSE_SYNC_TTL_HOURS = parseInt(process.env.DISCOURSE_SYNC_TTL_HOURS || String(DISCOURSE_SYNC_INTERVAL_HOURS), 10);

const FORCE_SYNC = process.env.FORCE_SYNC === "true";

const db = createDb(DATABASE_URL);

async function runDumpSync() {
  try {
    await syncFromDump(db, { ttlHours: DUMP_SYNC_TTL_HOURS, forceSync: FORCE_SYNC });
  } catch (err) {
    console.error("Dump sync failed:", err);
  }
}

async function runStarSync() {
  try {
    await syncAllStars(db, { ttlHours: STARS_SYNC_TTL_HOURS, forceSync: FORCE_SYNC });
  } catch (err) {
    console.error("Star sync failed:", err);
  }
}

async function runDiscourseSync() {
  try {
    await syncAllDiscourseStats(db, { ttlHours: DISCOURSE_SYNC_TTL_HOURS, forceSync: FORCE_SYNC });
  } catch (err) {
    console.error("Discourse sync failed:", err);
  }
}

console.log("Sync worker starting...");
console.log(
  `Intervals — Dump: ${DUMP_SYNC_INTERVAL_HOURS}h, Stars: ${STARS_SYNC_INTERVAL_HOURS}h, Discourse: ${DISCOURSE_SYNC_INTERVAL_HOURS}h`
);
console.log(
  `TTLs — Dump: ${DUMP_SYNC_TTL_HOURS}h, Stars: ${STARS_SYNC_TTL_HOURS}h, Discourse: ${DISCOURSE_SYNC_TTL_HOURS}h`
);
if (FORCE_SYNC) {
  console.log("FORCE_SYNC enabled — all TTL checks bypassed");
}

await runDumpSync();
await runStarSync();
await runDiscourseSync();

setInterval(runDumpSync, DUMP_SYNC_INTERVAL_HOURS * 60 * 60 * 1000);
setInterval(runStarSync, STARS_SYNC_INTERVAL_HOURS * 60 * 60 * 1000);
setInterval(runDiscourseSync, DISCOURSE_SYNC_INTERVAL_HOURS * 60 * 60 * 1000);

console.log("Sync worker running. Waiting for next interval...");
```

**Step 2: Commit**

```bash
git add packages/sync/src/index.ts
git commit -m "feat(sync): read TTL env vars and pass config to sync functions"
```

---

### Task 5: Update `dump-sync.ts` — Job-level TTL check

**Files:**
- Modify: `packages/sync/src/dump-sync.ts`

**Step 1: Add TTL options parameter and job-level check**

Add at the top of `dump-sync.ts`, after existing imports:

```typescript
import { syncJobs } from "@coprhub/shared";
import { eq } from "drizzle-orm";
import { shouldSkipSync } from "./ttl.js";

export interface SyncOptions {
  ttlHours: number;
  forceSync: boolean;
}
```

**Step 2: Update `syncFromDump` function signature and add TTL check**

Change the function signature from:
```typescript
export async function syncFromDump(db: Db): Promise<void> {
```
to:
```typescript
export async function syncFromDump(db: Db, options: SyncOptions): Promise<void> {
```

Add TTL check at the top of the function body, right after `console.log("Starting dump-based sync...");`:

```typescript
  // Check job-level TTL
  const [lastRun] = await db
    .select({ lastCompletedAt: syncJobs.lastCompletedAt })
    .from(syncJobs)
    .where(eq(syncJobs.jobName, "dump_sync"));

  if (shouldSkipSync(lastRun?.lastCompletedAt ?? null, options.ttlHours, options.forceSync)) {
    const hoursAgo = ((Date.now() - lastRun!.lastCompletedAt.getTime()) / 3600000).toFixed(1);
    console.log(`Dump sync: skipped (last run ${hoursAgo}h ago, TTL is ${options.ttlHours}h)`);
    return;
  }
```

**Step 3: Record completion at the end of the function**

Add before the final `console.log("Dump-based sync complete.");` (but outside the `finally` block — right after the `finally` block, before the last console.log):

Actually, more precisely: the function ends with `} finally { ... } console.log(...)`. We need to track duration and record it. Wrap the main work in a timer:

Add `const startTime = Date.now();` right after the TTL check block.

Then replace the final `console.log("Dump-based sync complete.");` with:

```typescript
  const durationMs = Date.now() - startTime;
  await db
    .insert(syncJobs)
    .values({ jobName: "dump_sync", lastCompletedAt: new Date(), durationMs })
    .onConflictDoUpdate({
      target: syncJobs.jobName,
      set: { lastCompletedAt: new Date(), durationMs },
    });
  console.log(`Dump sync complete (${(durationMs / 60000).toFixed(1)}m).`);
```

**Step 4: Commit**

```bash
git add packages/sync/src/dump-sync.ts
git commit -m "feat(sync): add job-level TTL check to dump sync"
```

---

### Task 6: Update `stars-sync.ts` — Per-project TTL filtering

**Files:**
- Modify: `packages/sync/src/stars-sync.ts`

**Step 1: Add imports and options**

Add to the imports in `stars-sync.ts`:

```typescript
import { sql, and, or, isNull, lt } from "drizzle-orm";
import { syncJobs } from "@coprhub/shared";
```

Add the `SyncOptions` interface (or import from `ttl.ts` — better to import):

```typescript
import type { SyncOptions } from "./dump-sync.js";
```

**Step 2: Update `syncAllStars` signature and query**

Change function signature from:
```typescript
export async function syncAllStars(db: Db): Promise<number> {
```
to:
```typescript
export async function syncAllStars(db: Db, options: SyncOptions): Promise<number> {
```

Replace the project query (lines 101-108) from:
```typescript
  const projectsWithUpstream = await db
    .select({
      id: projects.id,
      upstreamUrl: projects.upstreamUrl,
      upstreamProvider: projects.upstreamProvider,
    })
    .from(projects)
    .where(isNotNull(projects.upstreamUrl));
```

to:
```typescript
  const ttlCutoff = new Date(Date.now() - options.ttlHours * 60 * 60 * 1000);

  const baseFilter = isNotNull(projects.upstreamUrl);
  const ttlFilter = options.forceSync
    ? baseFilter
    : and(
        baseFilter,
        or(
          isNull(projects.starsSyncedAt),
          lt(projects.starsSyncedAt, ttlCutoff),
        ),
      );

  const projectsWithUpstream = await db
    .select({
      id: projects.id,
      upstreamUrl: projects.upstreamUrl,
      upstreamProvider: projects.upstreamProvider,
    })
    .from(projects)
    .where(ttlFilter);

  // Count total for logging
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)`.mapWith(Number) })
    .from(projects)
    .where(isNotNull(projects.upstreamUrl));

  const skipped = total - projectsWithUpstream.length;
  if (skipped > 0) {
    console.log(
      `Stars sync: skipping ${skipped} of ${total} projects (within ${options.ttlHours}h TTL), syncing ${projectsWithUpstream.length} stale`
    );
  } else if (options.forceSync) {
    console.log(`Stars sync: FORCE_SYNC enabled, syncing all ${total} projects`);
  }
```

**Step 3: Record completion at the end**

Add before the final `return synced;`:

```typescript
  // Record job completion for observability
  await db
    .insert(syncJobs)
    .values({ jobName: "stars_sync", lastCompletedAt: new Date(), durationMs: null })
    .onConflictDoUpdate({
      target: syncJobs.jobName,
      set: { lastCompletedAt: new Date() },
    });
```

**Step 4: Run existing tests to verify nothing broke**

Run: `cd /home/balsa/Documents/Projects/copr-index && bun --filter @coprhub/sync test`
Expected: PASS — existing stars-sync tests still pass (they test individual fetch functions, not `syncAllStars`)

**Step 5: Commit**

```bash
git add packages/sync/src/stars-sync.ts
git commit -m "feat(sync): add per-project TTL filtering to stars sync"
```

---

### Task 7: Update `discourse-sync.ts` — Per-project TTL filtering + write timestamp

**Files:**
- Modify: `packages/sync/src/discourse-sync.ts`

**Step 1: Add imports**

Add to the imports:

```typescript
import { and, or, isNull, lt, sql } from "drizzle-orm";
import { syncJobs } from "@coprhub/shared";
import type { SyncOptions } from "./dump-sync.js";
```

**Step 2: Update `syncAllDiscourseStats` signature and query**

Change function signature from:
```typescript
export async function syncAllDiscourseStats(db: Db): Promise<void> {
```
to:
```typescript
export async function syncAllDiscourseStats(db: Db, options: SyncOptions): Promise<void> {
```

Replace the project query (lines 76-83) from:
```typescript
  const allProjects = await db
    .select({
      id: projects.id,
      owner: projects.owner,
      name: projects.name,
      discourseTopicId: projects.discourseTopicId,
    })
    .from(projects);
```

to:
```typescript
  const ttlCutoff = new Date(Date.now() - options.ttlHours * 60 * 60 * 1000);

  const ttlFilter = options.forceSync
    ? undefined
    : or(
        isNull(projects.discourseSyncedAt),
        lt(projects.discourseSyncedAt, ttlCutoff),
      );

  const allProjects = await db
    .select({
      id: projects.id,
      owner: projects.owner,
      name: projects.name,
      discourseTopicId: projects.discourseTopicId,
    })
    .from(projects)
    .where(ttlFilter);

  // Count total for logging
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)`.mapWith(Number) })
    .from(projects);

  const skipped = total - allProjects.length;
  if (skipped > 0) {
    console.log(
      `Discourse sync: skipping ${skipped} of ${total} projects (within ${options.ttlHours}h TTL), syncing ${allProjects.length} stale`
    );
  } else if (options.forceSync) {
    console.log(`Discourse sync: FORCE_SYNC enabled, syncing all ${total} projects`);
  }
```

**Step 3: Write `discourseSyncedAt` after each project update**

In the existing loop body, add `discourseSyncedAt: new Date()` to both update calls.

For projects with known topic ID (the `if (project.discourseTopicId)` branch), change the `.set()` to:
```typescript
        await db.update(projects).set({
          discourseLikes: stats.likes,
          discourseViews: stats.views,
          discourseReplies: stats.replies,
          discourseSyncedAt: new Date(),
        }).where(eq(projects.id, project.id));
```

For discovered topics (the `else` branch), change the `.set()` to:
```typescript
        await db.update(projects).set({
          discourseTopicId: topic.topicId,
          discourseLikes: topic.likes,
          discourseViews: topic.views,
          discourseReplies: topic.replies,
          discourseSyncedAt: new Date(),
        }).where(eq(projects.id, project.id));
```

Also write `discourseSyncedAt` for projects that had no discourse topic found (so they don't get re-checked every run). After the `else` block's inner `if (topic)` block, add an else:
```typescript
      } else {
        // No topic found — still mark as synced so we don't re-search every run
        await db.update(projects).set({
          discourseSyncedAt: new Date(),
        }).where(eq(projects.id, project.id));
      }
```

**Step 4: Record job completion**

Add before the final `console.log(...)`:

```typescript
  await db
    .insert(syncJobs)
    .values({ jobName: "discourse_sync", lastCompletedAt: new Date(), durationMs: null })
    .onConflictDoUpdate({
      target: syncJobs.jobName,
      set: { lastCompletedAt: new Date() },
    });
```

**Step 5: Run existing tests**

Run: `cd /home/balsa/Documents/Projects/copr-index && bun --filter @coprhub/sync test`
Expected: PASS — existing discourse-sync tests still pass (they test individual fetch functions)

**Step 6: Commit**

```bash
git add packages/sync/src/discourse-sync.ts
git commit -m "feat(sync): add per-project TTL filtering to discourse sync"
```

---

### Task 8: Update config files — podman-compose.yml and .env.example

**Files:**
- Modify: `podman-compose.yml:59` (sync-worker environment)
- Modify: `.env.example`

**Step 1: Add new env vars to podman-compose.yml**

In `podman-compose.yml`, add after the `DISCOURSE_SYNC_INTERVAL_HOURS` line in the sync-worker environment:

```yaml
      DUMP_SYNC_TTL_HOURS: ${DUMP_SYNC_TTL_HOURS:-24}
      STARS_SYNC_TTL_HOURS: ${STARS_SYNC_TTL_HOURS:-12}
      DISCOURSE_SYNC_TTL_HOURS: ${DISCOURSE_SYNC_TTL_HOURS:-24}
      FORCE_SYNC: ${FORCE_SYNC:-false}
```

**Step 2: Add new env vars to .env.example**

Add after the existing sync interval lines:

```
DUMP_SYNC_TTL_HOURS=24
STARS_SYNC_TTL_HOURS=12
DISCOURSE_SYNC_TTL_HOURS=24
FORCE_SYNC=false
```

**Step 3: Commit**

```bash
git add podman-compose.yml .env.example
git commit -m "chore: add TTL and force-sync env vars to compose and .env.example"
```

---

### Task 9: Run full test suite and verify

**Step 1: Run all tests**

Run: `cd /home/balsa/Documents/Projects/copr-index && bun run test`
Expected: All tests pass including new TTL tests

**Step 2: Type check**

Run: `cd /home/balsa/Documents/Projects/copr-index && bun run build`
Expected: Build succeeds with no TypeScript errors

**Step 3: Verify the SyncOptions type is consistent**

The `SyncOptions` interface is defined in `dump-sync.ts` and imported by `stars-sync.ts` and `discourse-sync.ts`. Verify this compiles cleanly.

**Step 4: Commit if any fixes were needed**

---

### Task 10: Update CLAUDE.md with new env vars

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add TTL env vars to the Environment Variables section**

In the Environment Variables section, add:

```
- `DUMP_SYNC_TTL_HOURS` - Hours before dump sync can re-run (default: matches interval)
- `STARS_SYNC_TTL_HOURS` - Hours before per-project star sync repeats (default: matches interval)
- `DISCOURSE_SYNC_TTL_HOURS` - Hours before per-project discourse sync repeats (default: matches interval)
- `FORCE_SYNC` - Set to `true` to bypass all TTL checks
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add TTL env vars to CLAUDE.md"
```
