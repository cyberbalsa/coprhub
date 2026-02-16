# Staleness Penalty Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Apply an exponential decay multiplier to the popularity score based on how long since a project's last COPR build.

**Architecture:** Add `last_build_at` column to the projects table, sourced from the COPR database dump's `build` table. The existing popularity score formula gains a staleness multiplier: `effective_score = floor(base_score * max(0.05, exp(-3.0 * d / 83)))` where `d = max(0, days_since_build - 7)`. The multiplier is applied in both the TypeScript function and all SQL recomputation queries.

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL, Vitest

**Design doc:** `docs/plans/2026-02-15-staleness-penalty-design.md`

---

### Task 1: Add `lastBuildAt` column to schema

**Files:**
- Modify: `packages/shared/src/schema.ts:42` (add column after `popularityScore`)

**Step 1: Add the column**

In `packages/shared/src/schema.ts`, add this line after the `popularityScore` column (line 42):

```typescript
    lastBuildAt: timestamp("last_build_at"),
```

**Step 2: Verify the schema compiles**

Run: `cd /home/balsa/Documents/Projects/copr-index && ~/.bun/bin/bun run build`
Expected: Successful build, no type errors.

**Step 3: Commit**

```bash
git add packages/shared/src/schema.ts
git commit -m "feat(shared): add last_build_at column to projects schema"
```

---

### Task 2: Add `lastBuildAt` to `ProjectDetail` type and API response

**Files:**
- Modify: `packages/shared/src/types.ts:30` (add to `ProjectDetail`)
- Modify: `packages/api/src/routes/projects.ts:140` (add to detail response mapping)

**Step 1: Add to ProjectDetail type**

In `packages/shared/src/types.ts`, add `lastBuildAt` to `ProjectDetail` after `lastSyncedAt`:

```typescript
  lastBuildAt: string | null;
```

**Step 2: Add to API project detail response**

In `packages/api/src/routes/projects.ts`, in the `/:owner/:name` route handler, add to the response object (after `lastSyncedAt` around line 140):

```typescript
      lastBuildAt: project.lastBuildAt?.toISOString() ?? null,
```

**Step 3: Verify it compiles**

Run: `cd /home/balsa/Documents/Projects/copr-index && ~/.bun/bin/bun run build`
Expected: Successful build, no type errors.

**Step 4: Commit**

```bash
git add packages/shared/src/types.ts packages/api/src/routes/projects.ts
git commit -m "feat(api): expose lastBuildAt in project detail response"
```

---

### Task 3: Add staleness constants and `computeStalenessMultiplier()` with tests

**Files:**
- Modify: `packages/sync/src/popularity.ts:1-15` (add constants and new function)
- Modify: `packages/sync/src/popularity.test.ts` (add staleness tests)

**Step 1: Write the failing tests**

Add to `packages/sync/src/popularity.test.ts`. Import `computeStalenessMultiplier` and `STALENESS` alongside existing imports:

```typescript
import { computePopularityScore, computeStalenessMultiplier, WEIGHTS, STALENESS } from "./popularity.js";
```

Then add a new describe block after the existing one:

```typescript
describe("computeStalenessMultiplier", () => {
  const now = new Date("2026-02-15T00:00:00Z");

  it("returns 1.0 for null lastBuildAt", () => {
    expect(computeStalenessMultiplier(null, now)).toBe(1.0);
  });

  it("returns 1.0 within grace period (built yesterday)", () => {
    const yesterday = new Date("2026-02-14T00:00:00Z");
    expect(computeStalenessMultiplier(yesterday, now)).toBe(1.0);
  });

  it("returns 1.0 at exactly 7 days", () => {
    const sevenDaysAgo = new Date("2026-02-08T00:00:00Z");
    expect(computeStalenessMultiplier(sevenDaysAgo, now)).toBe(1.0);
  });

  it("applies decay after grace period (30 days)", () => {
    const thirtyDaysAgo = new Date("2026-01-16T00:00:00Z");
    const multiplier = computeStalenessMultiplier(thirtyDaysAgo, now);
    // ~0.42 retained (58% penalty)
    expect(multiplier).toBeGreaterThan(0.35);
    expect(multiplier).toBeLessThan(0.50);
  });

  it("applies heavy decay at 60 days", () => {
    const sixtyDaysAgo = new Date("2025-12-17T00:00:00Z");
    const multiplier = computeStalenessMultiplier(sixtyDaysAgo, now);
    // ~0.13 retained (87% penalty)
    expect(multiplier).toBeGreaterThan(0.08);
    expect(multiplier).toBeLessThan(0.20);
  });

  it("floors at minMultiplier for 90+ days", () => {
    const ninetyDaysAgo = new Date("2025-11-17T00:00:00Z");
    expect(computeStalenessMultiplier(ninetyDaysAgo, now)).toBe(STALENESS.minMultiplier);
  });

  it("floors at minMultiplier for very old builds (1 year)", () => {
    const oneYearAgo = new Date("2025-02-15T00:00:00Z");
    expect(computeStalenessMultiplier(oneYearAgo, now)).toBe(STALENESS.minMultiplier);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /home/balsa/Documents/Projects/copr-index && ~/.bun/bin/bun --filter @coprhub/sync test`
Expected: FAIL — `computeStalenessMultiplier` is not exported from `./popularity.js`

**Step 3: Add STALENESS constants and `computeStalenessMultiplier()` to popularity.ts**

In `packages/sync/src/popularity.ts`, add after the `WEIGHTS` constant (after line 15):

```typescript
export const STALENESS = {
  gracePeriodDays: 7,
  decayRate: 3.0,
  decayWindowDays: 83,  // 90 - 7 (grace period)
  minMultiplier: 0.05,
} as const;

export function computeStalenessMultiplier(lastBuildAt: Date | null, now: Date = new Date()): number {
  if (!lastBuildAt) return 1.0;
  const daysSinceBuild = (now.getTime() - lastBuildAt.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceBuild <= STALENESS.gracePeriodDays) return 1.0;
  const d = daysSinceBuild - STALENESS.gracePeriodDays;
  return Math.max(STALENESS.minMultiplier, Math.exp(-STALENESS.decayRate * d / STALENESS.decayWindowDays));
}
```

**Step 4: Run tests to verify they pass**

Run: `cd /home/balsa/Documents/Projects/copr-index && ~/.bun/bin/bun --filter @coprhub/sync test`
Expected: All tests PASS.

**Step 5: Commit**

```bash
git add packages/sync/src/popularity.ts packages/sync/src/popularity.test.ts
git commit -m "feat(sync): add staleness multiplier with exponential decay"
```

---

### Task 4: Integrate staleness into `computePopularityScore()`

**Files:**
- Modify: `packages/sync/src/popularity.ts:27` (`computePopularityScore` function)
- Modify: `packages/sync/src/popularity.test.ts` (update existing tests)

**Step 1: Write the failing test**

Add to `packages/sync/src/popularity.test.ts`, inside the existing `computePopularityScore` describe block:

```typescript
  it("applies staleness penalty for old builds", () => {
    const now = new Date("2026-02-15T00:00:00Z");
    const thirtyDaysAgo = new Date("2026-01-16T00:00:00Z");
    const input = {
      stars: 100, votes: 10, downloads: 50000, repoEnables: 2000,
      discourseLikes: 20, discourseReplies: 50, discourseViews: 5000,
    };
    const baseScore = computePopularityScore(input);
    const stalePenalized = computePopularityScore(input, thirtyDaysAgo, now);
    expect(stalePenalized).toBeLessThan(baseScore);
    expect(stalePenalized).toBeGreaterThan(0);
  });

  it("applies no penalty when lastBuildAt is null", () => {
    const input = {
      stars: 100, votes: 0, downloads: 0, repoEnables: 0,
      discourseLikes: 0, discourseReplies: 0, discourseViews: 0,
    };
    const withNull = computePopularityScore(input, null);
    const withoutArg = computePopularityScore(input);
    expect(withNull).toBe(withoutArg);
  });

  it("returns 0 when base score is 0 regardless of staleness", () => {
    const old = new Date("2020-01-01T00:00:00Z");
    const score = computePopularityScore({
      stars: 0, votes: 0, downloads: 0, repoEnables: 0,
      discourseLikes: 0, discourseReplies: 0, discourseViews: 0,
    }, old);
    expect(score).toBe(0);
  });
```

**Step 2: Run tests to verify they fail**

Run: `cd /home/balsa/Documents/Projects/copr-index && ~/.bun/bin/bun --filter @coprhub/sync test`
Expected: FAIL — `computePopularityScore` doesn't accept extra arguments yet.

**Step 3: Update `computePopularityScore()` signature and body**

In `packages/sync/src/popularity.ts`, change the function to:

```typescript
export function computePopularityScore(
  input: PopularityInput,
  lastBuildAt?: Date | null,
  now?: Date,
): number {
  const baseScore =
    input.stars * WEIGHTS.stars +
    input.votes * WEIGHTS.votes +
    Math.min(input.downloads * WEIGHTS.downloads, WEIGHTS.downloadsCap) +
    Math.min(input.repoEnables * WEIGHTS.repoEnables, WEIGHTS.repoEnablesCap) +
    input.discourseLikes * WEIGHTS.discourseLikes +
    input.discourseReplies * WEIGHTS.discourseReplies +
    (input.discourseViews > 0 ? Math.log(input.discourseViews) * WEIGHTS.discourseViews : 0);

  const multiplier = computeStalenessMultiplier(lastBuildAt ?? null, now);
  return Math.floor(baseScore * multiplier);
}
```

**Step 4: Run tests to verify they pass**

Run: `cd /home/balsa/Documents/Projects/copr-index && ~/.bun/bin/bun --filter @coprhub/sync test`
Expected: All tests PASS (existing tests still pass because `lastBuildAt` defaults to undefined → multiplier = 1.0).

**Step 5: Commit**

```bash
git add packages/sync/src/popularity.ts packages/sync/src/popularity.test.ts
git commit -m "feat(sync): integrate staleness multiplier into computePopularityScore"
```

---

### Task 5: Update `recomputeAllPopularityScores()` SQL with decay

**Files:**
- Modify: `packages/sync/src/popularity.ts:39-57` (the `recomputeAllPopularityScores` function)

**Step 1: Update the SQL**

Replace the entire SQL expression in `recomputeAllPopularityScores()` with a version that multiplies the base score by the decay multiplier. The new SQL:

```typescript
export async function recomputeAllPopularityScores(db: Db): Promise<void> {
  console.log("Recomputing all popularity scores...");

  await db
    .update(projects)
    .set({
      popularityScore: sql`
        (
          (COALESCE(upstream_stars, 0) * 10) +
          (COALESCE(copr_votes, 0) * 5) +
          LEAST(COALESCE(copr_downloads, 0) * 0.01, 1000)::integer +
          LEAST(COALESCE(copr_repo_enables, 0) * 0.1, 500)::integer +
          (COALESCE(discourse_likes, 0) * 3) +
          (COALESCE(discourse_replies, 0) * 1) +
          (ln(greatest(COALESCE(discourse_views, 0), 1)) * 2)::integer
        ) * (
          CASE
            WHEN last_build_at IS NULL THEN 1.0
            WHEN EXTRACT(EPOCH FROM (NOW() - last_build_at)) / 86400.0 <= 7 THEN 1.0
            ELSE GREATEST(0.05,
              EXP(-3.0 * (EXTRACT(EPOCH FROM (NOW() - last_build_at)) / 86400.0 - 7) / 83.0)
            )
          END
        )
      `,
    });

  console.log("Popularity score recomputation complete.");
}
```

**Step 2: Verify it compiles**

Run: `cd /home/balsa/Documents/Projects/copr-index && ~/.bun/bin/bun run build`
Expected: Successful build.

**Step 3: Commit**

```bash
git add packages/sync/src/popularity.ts
git commit -m "feat(sync): apply staleness decay in recomputeAllPopularityScores SQL"
```

---

### Task 6: Update dump-sync to extract `last_build_at` and apply decay

**Files:**
- Modify: `packages/sync/src/dump-sync.ts:63-105` (AGG_SQL constant — add `agg_last_build`)
- Modify: `packages/sync/src/dump-sync.ts:153-206` (dblink query — add `last_build` column)
- Modify: `packages/sync/src/dump-sync.ts:293-304` (popularity recomputation SQL — add decay)

**Step 1: Add `agg_last_build` to AGG_SQL**

In `packages/sync/src/dump-sync.ts`, append to the `AGG_SQL` constant (before the closing backtick):

```sql

  CREATE TABLE agg_last_build AS
  SELECT copr_id, MAX(ended_on) as last_build
  FROM build
  WHERE ended_on IS NOT NULL
  GROUP BY copr_id;
  CREATE INDEX agg_last_build_idx ON agg_last_build(copr_id);
```

**Step 2: Update the dblink INSERT to include `last_build_at`**

In the project sync SQL (step 4, around line 153), make these changes:

a) Add `last_build_at` to the INSERT column list:
```sql
INSERT INTO projects (copr_id, owner, name, full_name, description, instructions, homepage, repo_url, chroots, copr_votes, copr_downloads, copr_repo_enables, last_build_at, votes_synced_at, last_synced_at, updated_at)
```

b) Add `lb.last_build as last_build_at` to the SELECT inside the dblink query, and add the JOIN:
```sql
LEFT JOIN agg_last_build lb ON lb.copr_id = c.id
```

c) Add `last_build_at` to the dblink AS type mapping:
```sql
) AS t(
  copr_id int, owner text, name text, full_name text,
  description text, instructions text, homepage text,
  chroots text, votes int, downloads bigint, repo_enables bigint,
  last_build_at timestamp
)
```

d) Add `last_build_at` to the SELECT list between `re.repo_enables` and the closing of the dblink query:
Add to the outer SELECT: include `last_build_at` (it comes through from the dblink AS mapping).

e) Add `last_build_at = EXCLUDED.last_build_at` to the ON CONFLICT DO UPDATE SET clause.

**Step 3: Update inline popularity SQL with decay multiplier**

Replace the popularity recomputation SQL (step 7, around line 295-304) with:

```typescript
    await db.execute(sql`
      UPDATE projects SET popularity_score = (
        (COALESCE(upstream_stars, 0) * 10) +
        (COALESCE(copr_votes, 0) * 5) +
        LEAST(COALESCE(copr_downloads, 0) * 0.01, 1000)::integer +
        LEAST(COALESCE(copr_repo_enables, 0) * 0.1, 500)::integer +
        (COALESCE(discourse_likes, 0) * 3) +
        (COALESCE(discourse_replies, 0) * 1) +
        (ln(greatest(COALESCE(discourse_views, 0), 1)) * 2)::integer
      ) * (
        CASE
          WHEN last_build_at IS NULL THEN 1.0
          WHEN EXTRACT(EPOCH FROM (NOW() - last_build_at)) / 86400.0 <= 7 THEN 1.0
          ELSE GREATEST(0.05,
            EXP(-3.0 * (EXTRACT(EPOCH FROM (NOW() - last_build_at)) / 86400.0 - 7) / 83.0)
          )
        END
      )
    `);
```

**Step 4: Verify it compiles**

Run: `cd /home/balsa/Documents/Projects/copr-index && ~/.bun/bin/bun run build`
Expected: Successful build.

**Step 5: Run all tests**

Run: `cd /home/balsa/Documents/Projects/copr-index && ~/.bun/bin/bun run test`
Expected: All tests PASS.

**Step 6: Commit**

```bash
git add packages/sync/src/dump-sync.ts
git commit -m "feat(sync): extract last_build_at from COPR dump and apply staleness decay"
```

---

### Task 7: Push schema to database

**Step 1: Push Drizzle schema**

Run inside the API container to add the `last_build_at` column:

```bash
podman exec -w /app/packages/shared copr-index_api_1 \
  bunx drizzle-kit push --config drizzle.config.ts
```

Expected: Schema push succeeds, `last_build_at` column added to `projects` table.

**Step 2: Verify column exists**

```bash
podman exec -i copr-index_postgres_1 \
  psql -U copr -d coprhub -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'projects' AND column_name = 'last_build_at';"
```

Expected: Shows `last_build_at | timestamp without time zone`.
