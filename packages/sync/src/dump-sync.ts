import { sql, eq } from "drizzle-orm";
import type { Db } from "@coprhub/shared";
import { syncJobs } from "@coprhub/shared";
import { USER_AGENT } from "./user-agent.js";
import { shouldSkipSync, type SyncOptions } from "./ttl.js";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const DUMP_INDEX_URL = "https://copr.fedorainfracloud.org/db_dumps/";
const TEMP_DB = "copr_dump";

async function findLatestDumpUrl(): Promise<string> {
  const res = await fetch(DUMP_INDEX_URL, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) throw new Error(`Failed to fetch dump index: ${res.status}`);

  const html = await res.text();
  const matches = [...html.matchAll(/href="(copr_db-[^"]+\.gz)"/g)];
  if (matches.length === 0) throw new Error("No dump files found");

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

function psql(dbUrl: string, command: string): void {
  execFileSync("psql", [dbUrl, "-c", command], {
    stdio: "pipe",
    timeout: 300_000,
  });
}

function getBaseDbUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  return url.replace(/\/[^/]+$/, "");
}

function importDump(dbUrl: string, gzPath: string): void {
  // Use zcat piped to psql - requires shell for piping
  execFileSync("sh", ["-c", `zcat "${gzPath}" | psql "${dbUrl}"`], {
    stdio: "pipe",
    timeout: 600_000,
  });
}

const AGG_SQL = `
  CREATE TABLE agg_votes AS
  SELECT copr_id, SUM(score)::int as net_votes
  FROM copr_score GROUP BY copr_id;
  CREATE INDEX agg_votes_idx ON agg_votes(copr_id);

  CREATE TABLE agg_downloads AS
  SELECT
    regexp_replace(
      regexp_replace(name, '^project_rpms_dl_stat:hset::', ''),
      '@([^@]*)$', E'/\\\\1'
    ) as full_name,
    SUM(counter)::bigint as downloads
  FROM counter_stat
  WHERE counter_type = 'project_rpms_dl' AND name LIKE 'project_rpms_dl_stat:hset::%'
  GROUP BY 1;
  CREATE INDEX agg_downloads_idx ON agg_downloads(full_name);

  CREATE TABLE agg_repo_enables AS
  SELECT
    regexp_replace(
      regexp_replace(
        regexp_replace(name, '^repo_dl_stat::', ''),
        ':[^:]*$', ''
      ),
      '@([^@]*)$', E'/\\\\1'
    ) as full_name,
    SUM(counter)::bigint as repo_enables
  FROM counter_stat
  WHERE counter_type = 'repo_dl' AND name LIKE 'repo_dl_stat::%'
  GROUP BY 1;
  CREATE INDEX agg_repo_idx ON agg_repo_enables(full_name);

  CREATE TABLE agg_chroots AS
  SELECT
    cc.copr_id,
    json_agg(mc.os_release || '-' || mc.os_version || '-' || mc.arch)::text as chroots
  FROM copr_chroot cc
  JOIN mock_chroot mc ON mc.id = cc.mock_chroot_id
  WHERE cc.deleted = false
  GROUP BY cc.copr_id;
  CREATE INDEX agg_chroots_idx ON agg_chroots(copr_id);

  CREATE TABLE agg_last_build AS
  SELECT copr_id, to_timestamp(MAX(submitted_on)) as last_build
  FROM build
  WHERE submitted_on IS NOT NULL
  GROUP BY copr_id;
  CREATE INDEX agg_last_build_idx ON agg_last_build(copr_id);
`;

export async function syncFromDump(db: Db, options: SyncOptions): Promise<void> {
  console.log("Starting dump-based sync...");

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

  const startTime = Date.now();

  const dumpUrl = await findLatestDumpUrl();
  const dumpPath = await downloadDump(dumpUrl);
  const baseUrl = getBaseDbUrl();
  const tempDbUrl = `${baseUrl}/${TEMP_DB}`;

  try {
    // 1. Create temp database
    console.log("Creating temp database...");
    try {
      psql(`${baseUrl}/postgres`, `DROP DATABASE IF EXISTS ${TEMP_DB};`);
    } catch {
      // Ignore
    }
    psql(`${baseUrl}/postgres`, `CREATE DATABASE ${TEMP_DB};`);

    // 2. Import dump
    console.log("Importing dump into temp database...");
    importDump(tempDbUrl, dumpPath);
    console.log("Dump imported.");

    // 3. Create aggregation tables
    console.log("Pre-aggregating data...");
    psql(tempDbUrl, AGG_SQL);
    console.log("Aggregation complete.");

    // 4. Sync projects via dblink
    console.log("Syncing projects...");
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS dblink`);

    await db.execute(sql`
      INSERT INTO projects (copr_id, owner, name, full_name, description, instructions, homepage, repo_url, chroots, copr_votes, copr_downloads, copr_repo_enables, last_build_at, votes_synced_at, last_synced_at, updated_at)
      SELECT
        copr_id, owner, name, full_name, description, instructions, homepage,
        'https://copr.fedorainfracloud.org/coprs/' || full_name || '/' as repo_url,
        chroots::jsonb,
        COALESCE(votes, 0)::int,
        COALESCE(downloads, 0)::int,
        COALESCE(repo_enables, 0)::int,
        last_build_at,
        NOW(), NOW(), NOW()
      FROM dblink(
        ${`dbname=${TEMP_DB} user=copr`},
        $dbq$
        SELECT
          c.id as copr_id,
          d.ownername as owner,
          c.name,
          d.ownername || '/' || c.name as full_name,
          c.description,
          c.instructions,
          c.homepage,
          COALESCE(ch.chroots, '[]') as chroots,
          v.net_votes as votes,
          dl.downloads,
          re.repo_enables,
          lb.last_build as last_build_at
        FROM copr c
        JOIN copr_dir d ON d.copr_id = c.id AND d.main = true
        LEFT JOIN agg_chroots ch ON ch.copr_id = c.id
        LEFT JOIN agg_votes v ON v.copr_id = c.id
        LEFT JOIN agg_downloads dl ON dl.full_name = d.ownername || '/' || c.name
        LEFT JOIN agg_repo_enables re ON re.full_name = d.ownername || '/' || c.name
        LEFT JOIN agg_last_build lb ON lb.copr_id = c.id
        WHERE c.deleted = false
        $dbq$
      ) AS t(
        copr_id int, owner text, name text, full_name text,
        description text, instructions text, homepage text,
        chroots text, votes int, downloads bigint, repo_enables bigint,
        last_build_at timestamp
      )
      ON CONFLICT (copr_id) DO UPDATE SET
        owner = EXCLUDED.owner,
        name = EXCLUDED.name,
        full_name = EXCLUDED.full_name,
        description = EXCLUDED.description,
        instructions = EXCLUDED.instructions,
        homepage = EXCLUDED.homepage,
        repo_url = EXCLUDED.repo_url,
        chroots = EXCLUDED.chroots,
        copr_votes = EXCLUDED.copr_votes,
        copr_downloads = EXCLUDED.copr_downloads,
        copr_repo_enables = EXCLUDED.copr_repo_enables,
        last_build_at = EXCLUDED.last_build_at,
        votes_synced_at = EXCLUDED.votes_synced_at,
        last_synced_at = EXCLUDED.last_synced_at,
        updated_at = EXCLUDED.updated_at
    `);
    console.log("Projects synced.");

    // 5. Sync packages
    console.log("Syncing packages...");
    await db.execute(sql`
      INSERT INTO packages (project_id, name, source_type, source_url)
      SELECT
        p.id as project_id,
        t.pkg_name,
        t.source_type,
        t.clone_url
      FROM dblink(
        ${`dbname=${TEMP_DB} user=copr`},
        $dbq$
        SELECT
          pkg.copr_id,
          pkg.name as pkg_name,
          CASE pkg.source_type
            WHEN 8 THEN 'scm'
            WHEN 2 THEN 'upload'
            WHEN 9 THEN 'custom'
            ELSE pkg.source_type::text
          END as source_type,
          pkg.source_json::json->>'clone_url' as clone_url
        FROM package pkg
        JOIN copr c ON c.id = pkg.copr_id
        WHERE c.deleted = false
        $dbq$
      ) AS t(copr_id int, pkg_name text, source_type text, clone_url text)
      JOIN projects p ON p.copr_id = t.copr_id
      ON CONFLICT DO NOTHING
    `);
    console.log("Packages synced.");

    // 6. Detect upstream URLs
    console.log("Detecting upstream URLs...");
    await db.execute(sql`
      UPDATE projects SET
        upstream_url = 'https://github.com/' ||
          (regexp_match(homepage, 'https?://github\.com/([a-zA-Z0-9._-]+/[a-zA-Z0-9._-]+)'))[1],
        upstream_provider = 'github'
      WHERE upstream_url IS NULL
      AND homepage IS NOT NULL
      AND homepage ~ 'github\.com/[a-zA-Z0-9._-]+/[a-zA-Z0-9._-]+'
    `);

    await db.execute(sql`
      WITH pkg_upstream AS (
        SELECT DISTINCT ON (p.id) p.id,
          (regexp_match(pkg.source_url, 'https?://github\.com/([a-zA-Z0-9._-]+/[a-zA-Z0-9._-]+)'))[1] as gh_path
        FROM projects p
        JOIN packages pkg ON pkg.project_id = p.id
        WHERE p.upstream_url IS NULL
        AND pkg.source_url ~ 'github\.com/[a-zA-Z0-9._-]+/[a-zA-Z0-9._-]+'
      )
      UPDATE projects SET
        upstream_url = 'https://github.com/' || regexp_replace(u.gh_path, '\.git$', ''),
        upstream_provider = 'github'
      FROM pkg_upstream u WHERE projects.id = u.id
    `);

    await db.execute(sql`
      UPDATE projects SET
        upstream_url = 'https://github.com/' ||
          regexp_replace(
            (regexp_match(description, 'https?://github\.com/([a-zA-Z0-9._-]+/[a-zA-Z0-9._-]+)'))[1],
            '\.git$', ''
          ),
        upstream_provider = 'github'
      WHERE upstream_url IS NULL
      AND description IS NOT NULL
      AND description ~ 'github\.com/[a-zA-Z0-9._-]+/[a-zA-Z0-9._-]+'
    `);

    await db.execute(sql`
      UPDATE projects SET
        upstream_url = 'https://' ||
          (regexp_match(COALESCE(homepage,'') || ' ' || COALESCE(description,''),
            'https?://(gitlab\.[a-zA-Z0-9._-]+/[a-zA-Z0-9._-]+/[a-zA-Z0-9._-]+)'))[1],
        upstream_provider = 'gitlab'
      WHERE upstream_url IS NULL
      AND (COALESCE(homepage,'') || ' ' || COALESCE(description,''))
        ~ 'gitlab\.[a-zA-Z0-9._-]+/[a-zA-Z0-9._-]+/[a-zA-Z0-9._-]+'
    `);
    console.log("Upstream URL detection complete.");

    // 7. Recompute popularity scores
    console.log("Recomputing popularity scores...");
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
    console.log("Popularity scores recomputed.");

  } finally {
    // Clean up dump file only — keep temp DB for inspection,
    // it gets dropped at the start of the next sync run
    await unlink(dumpPath).catch(() => {});
    console.log("Cleanup complete (temp DB preserved until next sync).");
  }

  const durationMs = Date.now() - startTime;
  await db
    .insert(syncJobs)
    .values({ jobName: "dump_sync", lastCompletedAt: new Date(), durationMs })
    .onConflictDoUpdate({
      target: syncJobs.jobName,
      set: { lastCompletedAt: new Date(), durationMs },
    });
  console.log(`Dump sync complete (${(durationMs / 60000).toFixed(1)}m).`);
}
