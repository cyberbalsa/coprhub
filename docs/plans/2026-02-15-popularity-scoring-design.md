# Popularity Scoring, Discourse Comments, and README Display

## Problem

COPRHub currently only has GitHub/GitLab stars as a popularity signal. Users can't easily find the best COPR projects. The comment system (Giscus) is disconnected from the Fedora community's existing Discourse-based discussions.

## Data Sources

### 1. COPR Database Dump (new)

Daily PostgreSQL dumps at `https://copr.fedorainfracloud.org/db_dumps/` (~1.3GB gzipped).

Extracted tables:
- **`copr_score`** (2,142 rows): Per-user votes with `copr_id` and `score` (+1/-1). Aggregate by `copr_id` for net vote count.
- **`counter_stat`** (2.4M rows): Download and repo-enable stats.
  - `project_rpms_dl` (115K rows): RPM downloads per project. Name format: `project_rpms_dl_stat:hset::{owner}@{name}`
  - `repo_dl` (678K rows): Repo enables per project+chroot. Name format: `repo_dl_stat::{owner}@{name}:{chroot}`

### 2. GitHub/GitLab API (existing + README)

Already syncing: stars, forks, language, description, topics.
New: Fetch raw markdown README (truncated to 5KB), store in DB, include in search vector.

### 3. Discourse API (new)

Fedora's Discourse at `discussion.fedoraproject.org`. Each COPR project may have a discussion thread.

- Topic JSON endpoint: `GET /t/{slug}/{id}.json`
- Returns: `like_count`, `views`, `posts_count`, `reply_count`
- Embed URL is deterministic: `https://discussion.fedoraproject.org/embed/comments?embed_url=https://copr.fedorainfracloud.org/coprs/{owner}/{name}/`

Discovery: Query Discourse search API or embed info to find topic IDs for COPR projects.

### 4. COPR API (existing, unchanged)

Project metadata, packages, chroots via `/api_3/project/list`.

## Schema Changes

New columns on `projects` table:

```
coprVotes          integer  default 0    -- net vote sum from copr_score table
coprDownloads      integer  default 0    -- total RPM downloads (project_rpms_dl)
coprRepoEnables    integer  default 0    -- total repo enables (repo_dl, aggregated across chroots)
discourseTopicId   integer  nullable     -- Discourse topic ID for stats fetching
discourseLikes     integer  default 0    -- likes on the Discourse thread
discourseViews     integer  default 0    -- views on the Discourse thread
discourseReplies   integer  default 0    -- reply count on the Discourse thread
upstreamReadme     text     nullable     -- raw markdown README, max 5KB
readmeSyncedAt     timestamp nullable    -- when README was last fetched
votesSyncedAt      timestamp nullable    -- when votes/downloads were last synced
popularityScore    integer  default 0    -- computed weighted score
```

New index: `projects_popularity_score_idx` on `popularityScore`.

### Search Vector Update

Add README content to the trigger at weight D:
```sql
setweight(to_tsvector('english', coalesce(NEW.upstream_readme, '')), 'D')
```

## Sync Architecture

Extend the existing sync worker with two new sync jobs:

### DB Dump Sync (every 24h)

New file: `packages/sync/src/votes-sync.ts`

1. Download latest `copr_db-*.gz` from `https://copr.fedorainfracloud.org/db_dumps/`
2. Stream-parse the gzipped file (no need to load into a database)
3. Extract `COPY public.copr_score` section → aggregate `SUM(score)` by `copr_id`
4. Extract `COPY public.counter_stat` section → aggregate download counts by `owner@name`
5. Match to our projects via `coprId` (votes) and `owner/name` (downloads)
6. Batch upsert to our DB
7. Configurable via `VOTES_SYNC_INTERVAL_HOURS` env var (default 24)

### Discourse Sync (during DB dump sync)

After processing the dump, fetch Discourse stats for projects:

1. For each project, construct the COPR URL: `https://copr.fedorainfracloud.org/coprs/{owner}/{name}/`
2. Query Discourse to discover topic IDs (search API or embed info endpoint)
3. Fetch topic JSON for discovered topics to get likes, views, replies
4. Rate limit: 200ms between requests (Discourse rate limit is 60/min)
5. Store `discourseTopicId`, `discourseLikes`, `discourseViews`, `discourseReplies`
6. On subsequent syncs, only fetch stats for projects with known topic IDs (skip discovery)

### Stars Sync Extension (README)

Modified file: `packages/sync/src/stars-sync.ts`

During existing stars sync, also fetch README:
- GitHub: `GET /repos/{owner}/{repo}/readme` with `Accept: application/vnd.github.raw+json`
- GitLab: `GET /api/v4/projects/{id}/repository/files/README.md/raw?ref=main`
- Truncate at 5KB
- Store in `upstreamReadme`, update `readmeSyncedAt`

### Popularity Score Recomputation

After any sync completes, run:
```sql
UPDATE projects SET popularity_score =
  (upstream_stars * 10) +
  (copr_votes * 5) +
  (LEAST(copr_downloads * 0.01, 1000))::integer +
  (LEAST(copr_repo_enables * 0.1, 500))::integer +
  (discourse_likes * 3) +
  (discourse_replies * 1) +
  (ln(greatest(discourse_views, 1)) * 2)::integer
```

Weights are configurable constants in the sync code. Downloads and repo enables are capped to prevent outlier projects from dominating.

## API Changes

### `GET /api/projects`

New sort options: `popularity`, `votes`, `downloads`, `likes`, `views`, `replies` (added to existing `stars`, `name`, `updated`).

New fields in `ProjectSummary` response: `popularityScore`, `coprVotes`, `coprDownloads`.

### `GET /api/projects/:owner/:name`

New fields in `ProjectDetail` response: `coprVotes`, `coprDownloads`, `coprRepoEnables`, `discourseLikes`, `discourseViews`, `discourseReplies`, `upstreamReadme`, `popularityScore`.

## Frontend Changes

### Replace Giscus with Discourse Embed

Remove `<GiscusComments />` component. Add Discourse iframe:
```html
<iframe
  src="https://discussion.fedoraproject.org/embed/comments?embed_url=https://copr.fedorainfracloud.org/coprs/{owner}/{name}/"
  width="100%" frameborder="0" scrolling="no" />
```
Use `postMessage` listener for auto-resize.

### COPR Vote Button

Display vote count with thumbs-up icon. Clicking opens the COPR project page in a new tab: `https://copr.fedorainfracloud.org/coprs/{owner}/{name}/`

### README Section

Render `upstreamReadme` markdown client-side using `react-markdown` with `remark-gfm`. Displayed between project info and comments. Collapsible if content is long.

### Popularity Score Display

Show computed score as a badge on project detail and listing cards.

### Sort Options

Dropdown with all numeric sort fields: popularity (default), stars, votes, downloads, likes, views, replies, name, updated.

## Env Vars

New:
- `VOTES_SYNC_INTERVAL_HOURS` (default 24) — DB dump sync interval
- No auth needed for COPR DB dumps or Discourse public API
