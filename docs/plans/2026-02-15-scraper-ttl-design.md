# Scraper TTL Design

## Problem

All three sync workers (dump, stars, discourse) run immediately on container startup and re-fetch everything regardless of when they last ran. A container restart 5 minutes after a sync completes triggers a full re-sync — downloading the entire COPR dump, hitting GitHub/GitLab APIs for every project, and querying Discourse for every project.

## Solution

Add TTL-based deduplication so each sync skips work that was completed recently.

- **Dump sync**: Job-level TTL — skip the entire dump download if the last successful run is within the TTL window
- **Stars sync**: Per-project TTL — only fetch stars for projects whose `stars_synced_at` has expired
- **Discourse sync**: Per-project TTL — only fetch stats for projects whose `discourse_synced_at` has expired
- **Force flag**: `FORCE_SYNC=true` env var bypasses all TTL checks

## Schema Changes

### New table: `sync_jobs`

```sql
CREATE TABLE sync_jobs (
  job_name TEXT PRIMARY KEY,
  last_completed_at TIMESTAMP NOT NULL,
  duration_ms INTEGER
);
```

Tracks job-level completion for dump sync TTL and observability for all sync types.

### New column on `projects`

```sql
ALTER TABLE projects ADD COLUMN discourse_synced_at TIMESTAMP;
```

Mirrors the existing `stars_synced_at` pattern. Written after each project's discourse stats are fetched.

### Existing columns (no changes)

- `stars_synced_at` — already written by stars sync, now also read for TTL filtering
- `readme_synced_at` — already written by stars sync

## Sync Logic

### Dump sync

1. Query `sync_jobs` for `job_name = 'dump_sync'`
2. If `last_completed_at` is within `DUMP_SYNC_TTL_HOURS` and `FORCE_SYNC !== 'true'`, skip
3. On success, upsert `sync_jobs` with timestamp and duration

### Stars sync

1. Change project query to filter by TTL:
   ```sql
   WHERE upstream_url IS NOT NULL
     AND (stars_synced_at IS NULL OR stars_synced_at < NOW() - interval '${ttl} hours')
   ```
2. New projects (NULL timestamp) always get fetched
3. On completion, upsert `sync_jobs` for observability

### Discourse sync

1. Same pattern as stars — filter by `discourse_synced_at`:
   ```sql
   WHERE discourse_synced_at IS NULL OR discourse_synced_at < NOW() - interval '${ttl} hours'
   ```
2. Write `discourse_synced_at` after each project is synced
3. On completion, upsert `sync_jobs` for observability

### Startup behavior

No change — still calls all three syncs on startup. Each sync self-skips stale work via TTL checks, making restarts cheap.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `DUMP_SYNC_TTL_HOURS` | `24` | Skip dump if last run within window |
| `STARS_SYNC_TTL_HOURS` | `12` | Skip project star sync if synced within window |
| `DISCOURSE_SYNC_TTL_HOURS` | `24` | Skip project discourse sync if synced within window |
| `FORCE_SYNC` | `false` | Bypass all TTL checks |

Defaults match existing sync intervals.

## Logging

- **Skip**: `"Stars sync: skipping 4,230 of 4,500 projects (within 12h TTL), syncing 270 stale"`
- **Force**: `"Stars sync: FORCE_SYNC enabled, syncing all 4,500 projects"`
- **Complete**: `"Stars sync completed in 45m, synced 270 projects"`
- **Dump skip**: `"Dump sync: skipped (last run 6h ago, TTL is 24h)"`

## Files Changed

- `packages/shared/src/schema.ts` — add `sync_jobs` table, `discourse_synced_at` column
- `packages/sync/src/dump-sync.ts` — add job-level TTL check and recording
- `packages/sync/src/stars-sync.ts` — add per-project TTL filtering in SQL query
- `packages/sync/src/discourse-sync.ts` — add per-project TTL filtering, write `discourse_synced_at`
- `packages/sync/src/index.ts` — read new TTL env vars, pass to sync functions
- `podman-compose.yml` — add new env vars
- `.env.example` — document new env vars
- SQL migration for `sync_jobs` table and `discourse_synced_at` column
