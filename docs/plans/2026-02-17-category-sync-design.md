# Category Auto-Classification Design

**Date:** 2026-02-17
**Status:** Approved

## Overview

Add automatic category assignment to all COPR projects using a 3-tier classification waterfall: distro AppStream cross-reference, keyword heuristics, and LLM classification. Categories enable meaningful browsing of the ~90k project index.

## Current State

The category system is architecturally complete but functionally empty:
- Schema exists: `categories` (slug, name) and `project_categories` (junction table)
- API routes exist: `GET /api/categories`, `GET /api/categories/:slug`
- Frontend displays categories on homepage and search sidebar
- **Nothing is populated** — no categories seeded, no assignment logic, no sync job
- The `?category=` filter in the projects API is parsed but the SQL join is not implemented

## Category Taxonomy

13 Flathub-style user-friendly categories, one per project:

| Category | Slug | FreeDesktop Source |
|---|---|---|
| Audio & Video | `audio-video` | AudioVideo, Audio, Video, Midi, Mixer, Player, Recorder |
| Developer Tools | `developer-tools` | Development, Building, Debugger, IDE, RevisionControl, WebDevelopment |
| Education | `education` | Education |
| Games | `games` | Game, ActionGame, ArcadeGame, BoardGame, BlocksGame, CardGame, KidsGame, LogicGame, RolePlaying, Shooter, Simulation, SportsGame, StrategyGame |
| Graphics & Photography | `graphics` | Graphics, 2DGraphics, 3DGraphics, VectorGraphics, RasterGraphics, Photography |
| Networking | `networking` | Network, Chat, Email, FileTransfer, InstantMessaging, IRCClient, WebBrowser, RemoteAccess |
| Office & Productivity | `office` | Office, Calendar, ContactManagement, Database, Dictionary, Finance, FlowChart, PDA, Presentation, ProjectManagement, Spreadsheet, WordProcessor |
| Science & Math | `science` | Science, Astronomy, Biology, Chemistry, ComputerScience, DataVisualization, Math, NumericalAnalysis, Physics |
| System | `system` | System, Settings, Accessibility, FileManager, Monitor, PackageManager, Security, TerminalEmulator |
| Utilities | `utilities` | Utility, Accessibility, Archiving, Calculator, Clock, Compression, FileTools, TextEditor |
| Libraries & Frameworks | `libraries` | (no FreeDesktop equivalent — heuristic/LLM only) |
| Command Line | `command-line` | (no FreeDesktop equivalent — heuristic/LLM only) |
| Fonts & Themes | `fonts-themes` | (no FreeDesktop equivalent — heuristic/LLM only) |

FreeDesktop-to-COPRHub mapping: when a package has multiple FreeDesktop categories, the **most specific** one wins (e.g., `ArcadeGame` maps to `games`, not to the `Game` main category which would also match).

## Classification Pipeline

### Tier 1: Distro AppStream Cross-Reference

Match COPR package names against AppStream metadata from 5 distributions:

| Source | URL | Size | Format |
|---|---|---|---|
| Flathub | `https://dl.flathub.org/repo/appstream/x86_64/appstream.xml.gz` | 8.7 MB | Gzip XML v0.8 |
| Fedora | `https://kojipkgs.fedoraproject.org/packages/appstream-data/{ver}/{rel}/noarch/appstream-data-{ver}-{rel}.noarch.rpm` | ~14.8 MB RPM | Extract `fedora.xml.gz` from RPM |
| openSUSE | Parse `https://download.opensuse.org/tumbleweed/repo/oss/repodata/repomd.xml` for `<data type="appdata">` | 7.3 MB | Gzip XML v0.8 |
| Debian | `https://deb.debian.org/debian/dists/sid/main/dep11/Components-amd64.yml.gz` | 7.8 MB | Gzip YAML DEP-11 |
| Ubuntu | `https://archive.ubuntu.com/ubuntu/dists/noble/universe/dep11/Components-amd64.yml.gz` | 5.7 MB | Gzip YAML DEP-11 |

**Total download:** ~37 MB compressed, cached locally and refreshed weekly.

**Matching:** For each COPR project, iterate through its `packages` entries and match each package name against:
- XML sources: `<pkgname>` element (Fedora, openSUSE, Flathub)
- YAML sources: `Package:` field (Debian, Ubuntu)

**Priority:** Flathub > Fedora > openSUSE > Debian > Ubuntu (first match wins).

**Category extraction:** All sources use FreeDesktop categories — map them to our 13-category taxonomy using the table above.

**Expected coverage:** ~10-20% of COPR projects.

### Tier 2: Keyword/Topic Heuristics

For unmatched projects, apply rule-based classification using existing project metadata:

```
upstream_topics includes ["game", "gaming", "godot", "unity3d"] → games
upstream_topics includes ["gtk", "qt", "gui", "desktop"] → utilities (or more specific if description helps)
upstream_language == "Font" or name contains "font" → fonts-themes
upstream_topics includes ["cli", "terminal", "shell"] → command-line
upstream_topics includes ["library", "sdk", "framework", "binding"] → libraries
description matches /text editor|code editor/i → developer-tools
description matches /web browser|http client/i → networking
```

Rules are defined as a static mapping table in the sync worker. No ML, no external calls.

**Expected coverage:** ~10-15% additional projects.

### Tier 3: LLM Classification

For remaining unmatched projects (~65-80%), use the Ollama-backed OpenAI-compatible endpoint.

**Endpoint:** `https://api.genai.gccis.rit.edu/v1/chat/completions`
**Model:** `qwen3:8b` (fast, good at structured output)
**Auth:** Bearer token `sk-ritgenai-gci-testingrounds-fffics-915880630d1c4bfe764f7c99b3f72601`

**Structured output:** Use OpenAI SDK `response_format` parameter to force valid JSON:

```typescript
interface CategoryClassification {
  category: string;   // One of our 13 category slugs
  confidence: "high" | "medium" | "low";
}
```

**System prompt:**
```
You are a Linux package classifier. Given a COPR package's metadata, classify it into exactly ONE category. Categories: audio-video, developer-tools, education, games, graphics, networking, office, science, system, utilities, libraries, command-line, fonts-themes
```

**User prompt:**
```
Name: {owner}/{name}
Description: {description}
Language: {upstream_language}
Topics: {upstream_topics}
Homepage: {homepage}
```

**Rate limiting:**
- Check `X-AI-RateLimit-Remaining` header before each request
- If remaining < 100, sleep until `X-AI-RateLimit-Reset` seconds
- Process in batches of 50 projects with 100ms delay between requests

**Expected coverage:** All remaining projects.

## Schema Changes

### Add column to `projects`

```sql
ALTER TABLE projects ADD COLUMN category_synced_at TIMESTAMP;
```

### Add column to `project_categories`

```sql
ALTER TABLE project_categories ADD COLUMN source TEXT NOT NULL DEFAULT 'llm';
-- Values: 'appstream', 'heuristic', 'llm'
```

## Sync Job Design

**Job name:** `category-sync`
**Schedule:** Weekly (every 7 days)
**Runs after:** dump-sync (needs fresh project data)

### Flow

1. **Download/refresh AppStream indices** (if older than 7 days)
   - Cache files in `data/appstream/` directory
   - Parse all sources into a unified in-memory map: `packageName → FreeDesktop categories[]`
2. **Seed categories** (idempotent upsert of 13 rows)
3. **Find projects needing classification:**
   - `WHERE category_synced_at IS NULL` (never classified)
   - `OR updated_at > category_synced_at` (re-synced since last classification)
4. **Classify in batches:**
   - Tier 1: AppStream lookup (instant, in-memory)
   - Tier 2: Heuristic rules (instant, pattern matching)
   - Tier 3: LLM API call (rate-limited)
5. **Write results:**
   - Delete existing `project_categories` row for this project (if any)
   - Insert new `project_categories` row with `source`
   - Update `category_synced_at` on the project
6. **Log stats:** Total classified, per-tier counts, LLM rate limit usage

### First Run

- Processes all ~90k projects
- Tier 1 + 2 handle ~20-35% (instant)
- Tier 3 handles remaining ~60-70k projects via LLM
- At ~10 req/sec with rate limiting: ~2 hours for first run

### Subsequent Runs

- Only new/changed projects since last run
- Typically hundreds, not thousands
- Completes in minutes

## Bug Fixes Required

### Implement `?category=` filter in projects API

`packages/api/src/routes/projects.ts` currently parses the `category` query param but does not apply a SQL join. Add:

```typescript
if (query.category) {
  conditions.push(
    sql`${projects.id} IN (
      SELECT pc.project_id FROM project_categories pc
      JOIN categories c ON pc.category_id = c.id
      WHERE c.slug = ${query.category}
    )`
  );
}
```

## New Files

```
packages/sync/src/category-sync.ts       — Main sync job
packages/sync/src/appstream-parser.ts     — Parse XML/YAML AppStream data
packages/sync/src/category-heuristics.ts  — Keyword/topic rules
packages/sync/src/category-llm.ts         — LLM classification client
packages/sync/src/category-mapping.ts     — FreeDesktop → COPRHub category map
data/appstream/                           — Cached AppStream index files (gitignored)
```

## Environment Variables

```
LLM_API_URL=https://api.genai.gccis.rit.edu/v1/chat/completions
LLM_API_KEY=sk-ritgenai-gci-testingrounds-fffics-915880630d1c4bfe764f7c99b3f72601
LLM_MODEL=qwen3:8b
CATEGORY_SYNC_TTL_HOURS=168        # 7 days
```

## Not In Scope

- Manual category overrides / admin UI
- Sub-categories or hierarchical categories
- Category icons on the frontend (could add later)
- Re-classifying projects that already have a category (unless re-synced)
