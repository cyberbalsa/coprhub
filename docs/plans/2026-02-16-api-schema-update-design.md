# API Schema Update Design

**Date:** 2026-02-16
**Approach:** Flat expansion (additive, no breaking changes)

## Goal

Bring the API and OpenAPI 3.1.0 spec in line with every column in the database schema. Expose all fields (including internal IDs and sync timestamps), expand sort options to every sortable column, add ILIKE wildcard filtering on all text fields, and document the existing comments endpoint.

## 1. ProjectSummary — New Fields

Added to the list endpoint response and OpenAPI `ProjectSummary` schema:

| Field | Type |
|---|---|
| `coprId` | `integer \| null` |
| `coprRepoEnables` | `integer` |
| `discourseLikes` | `integer` |
| `discourseViews` | `integer` |
| `discourseReplies` | `integer` |
| `lastBuildAt` | `string(date-time) \| null` |
| `updatedAt` | `string(date-time) \| null` |

## 2. ProjectDetail — New Fields

Added to the detail endpoint response and OpenAPI `ProjectDetail` schema:

| Field | Type |
|---|---|
| `coprId` | `integer \| null` |
| `discourseTopicId` | `integer \| null` |
| `readmeSyncedAt` | `string(date-time) \| null` |
| `votesSyncedAt` | `string(date-time) \| null` |
| `starsSyncedAt` | `string(date-time) \| null` |
| `discourseSyncedAt` | `string(date-time) \| null` |
| `updatedAt` | `string(date-time) \| null` |

## 3. Sort Fields

Full enum (24 values), default `popularity` desc:

`id`, `coprId`, `popularity`, `stars`, `forks`, `votes`, `downloads`, `enables`, `likes`, `views`, `replies`, `discourseTopicId`, `name`, `owner`, `language`, `provider`, `updated`, `created`, `lastBuild`, `lastSynced`, `starsSynced`, `readmeSynced`, `votesSynced`, `discourseSynced`

## 4. ILIKE Wildcard Filters

All text columns on `projects` are filterable. Wildcard behavior:

- Value contains `*` → `ILIKE` with `*` converted to `%`
- No `*` → exact `=` match (backwards-compatible)
- All ILIKE matches are case-insensitive

| Filter param | Column |
|---|---|
| `owner` | `owner` |
| `name` | `name` |
| `fullName` | `full_name` |
| `language` | `upstream_language` |
| `provider` | `upstream_provider` |
| `description` | `description` |
| `instructions` | `instructions` |
| `homepage` | `homepage` |
| `upstreamUrl` | `upstream_url` |
| `upstreamDescription` | `upstream_description` |
| `upstreamReadme` | `upstream_readme` |

Existing `category` filter (join-based) and `q` full-text search are unchanged.

## 5. Comments Endpoint

Document the existing `GET /api/projects/{owner}/{name}/comments` endpoint in the OpenAPI spec.

Response:
```
{ data: CommentPost[], topicUrl: string | null, title?: string }
```

CommentPost:
```
{ id, username, avatarUrl, content, createdAt, likeCount, replyCount, postNumber }
```

## 6. Files to Modify

- `packages/shared/src/types.ts` — update `ProjectSummary`, `ProjectDetail`, `ProjectsQuery`
- `packages/api/src/routes/projects.ts` — expand select fields, add ILIKE filter logic, expand sort map
- `packages/api/src/openapi.ts` — update all schemas, params, add comments path
- `packages/api/src/routes/categories.ts` — expand select fields to match new ProjectSummary
