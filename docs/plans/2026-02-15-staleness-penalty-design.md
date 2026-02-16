# Staleness Penalty for Popularity Score

## Problem

COPR projects that haven't been built in months still rank highly by popularity score. A project with 1000 GitHub stars but no build in a year shouldn't rank above an actively maintained project with 100 stars.

## Solution

Apply an exponential decay multiplier to the popularity score based on how long since the project's last build. The penalty starts after a 7-day grace period and reaches 95% (the cap) at 90 days.

## Decay Formula

```
d = max(0, days_since_last_build - 7)
multiplier = max(0.05, exp(-3.0 * d / 83))
effective_score = floor(base_score * multiplier)
```

### Penalty Table

| Age of Last Build | Penalty | Score Retained |
|-------------------|---------|----------------|
| 0-7 days          | 0%      | 100%           |
| 14 days           | 22%     | 78%            |
| 30 days           | 58%     | 42%            |
| 60 days           | 87%     | 13%            |
| 90 days           | 95%     | 5% (floor)     |
| 1 year+           | 95%     | 5% (floor)     |

### Edge Cases

- `last_build_at IS NULL`: No penalty applied (build date unknown; first dump sync will populate it)
- `base_score = 0`: Multiplier irrelevant, score stays 0

## Changes Required

### 1. Schema (`packages/shared/src/schema.ts`)

Add column to `projects` table:

```typescript
lastBuildAt: timestamp("last_build_at"),
```

No index needed — only read during bulk score recomputation.

### 2. Dump Sync (`packages/sync/src/dump-sync.ts`)

Add aggregation query to extract last build date per project from the COPR dump:

```sql
CREATE TABLE agg_last_build AS
SELECT copr_id, MAX(ended_on) as last_build
FROM build
WHERE ended_on IS NOT NULL
GROUP BY copr_id;
CREATE INDEX agg_last_build_idx ON agg_last_build(copr_id);
```

Include `last_build` in the dblink SELECT and write it to `last_build_at` on the upsert into `projects`.

Update the inline popularity score SQL (step 7 in dump-sync) to apply the decay multiplier.

### 3. Popularity Module (`packages/sync/src/popularity.ts`)

**`computePopularityScore()`**: Add optional `lastBuildAt?: Date | null` parameter. After computing `baseScore`, apply the exponential decay multiplier if `lastBuildAt` is provided and older than 7 days.

**`recomputeAllPopularityScores()`**: Update the SQL to include the decay calculation using `last_build_at` column, matching the TypeScript formula.

### 4. SQL Decay Expression

For use in both `recomputeAllPopularityScores()` and `dump-sync.ts`:

```sql
CASE
  WHEN last_build_at IS NULL THEN 1.0
  WHEN EXTRACT(EPOCH FROM (NOW() - last_build_at)) / 86400.0 <= 7 THEN 1.0
  ELSE GREATEST(0.05,
    EXP(-3.0 * (EXTRACT(EPOCH FROM (NOW() - last_build_at)) / 86400.0 - 7) / 83.0)
  )
END
```

The final score becomes: `floor(base_score * decay_multiplier)`

### 5. Tests (`packages/sync/src/popularity.test.ts`)

Add test cases:
- Project built yesterday → no penalty (multiplier = 1.0)
- Project built 30 days ago → ~58% penalty (multiplier ≈ 0.42)
- Project built 90+ days ago → 95% penalty (multiplier = 0.05, floor)
- `lastBuildAt = null` → no penalty (multiplier = 1.0)
- `base_score = 0` → stays 0 regardless of staleness

### 6. Shared Types (`packages/shared/src/types.ts`)

Add `lastBuildAt` to `ProjectDetail` type if it should be exposed in the API response (optional — useful for frontend display of "last built X days ago").

## Constants

All configurable in `popularity.ts`:

```typescript
export const STALENESS = {
  gracePeriodDays: 7,
  decayRate: 3.0,
  decayWindowDays: 83,  // 90 - 7 (grace period)
  minMultiplier: 0.05,
} as const;
```
