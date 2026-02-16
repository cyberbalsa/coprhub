# Health Endpoint Sync Data Design

**Date:** 2026-02-16
**Approach:** Sync jobs + basic data freshness

## Goal

Enhance `GET /api/health` to report sync job status and overall data freshness, while keeping `status` as a simple "ok".

## Response Shape

```json
{
  "status": "ok",
  "timestamp": "2026-02-16T06:20:00.000Z",
  "sync": {
    "dump_sync": { "lastCompletedAt": "...", "durationMs": 45000 },
    "stars_sync": { "lastCompletedAt": "...", "durationMs": 120000 },
    "discourse_sync": { "lastCompletedAt": "...", "durationMs": 30000 }
  },
  "data": {
    "totalProjects": 35985,
    "oldestUpdatedAt": "2026-02-10T12:00:00.000Z",
    "newestUpdatedAt": "2026-02-16T05:21:00.000Z"
  }
}
```

- `sync`: Dynamic keys from `sync_jobs` table rows. Empty object `{}` if no sync has run.
- `data`: Always present. `oldestUpdatedAt`/`newestUpdatedAt` are nullable (empty DB).
- `status`: Always `"ok"` — no degraded state logic.

## Files to Modify

- `packages/api/src/routes/health.ts` — add DB access, query sync_jobs + projects aggregate
- `packages/api/src/routes/health.test.ts` — update test for new response shape
- `packages/api/src/openapi.ts` — update health response schema
- `packages/api/src/index.ts` — pass `db` to health router (currently plain router)
