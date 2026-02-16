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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function syncVotesAndDownloads(db: Db): Promise<void> {
  console.log("Starting votes/downloads sync from COPR DB dump...");

  const dumpUrl = await findLatestDumpUrl();
  const dumpPath = await downloadDump(dumpUrl);

  try {
    console.log("Parsing dump file...");
    const sections = await streamExtractCopySections(dumpPath, [
      "public.copr_score",
      "public.counter_stat",
    ]);

    const votesByCoprId = parseCoprScoreLines(sections["public.copr_score"]);
    console.log(`Parsed ${votesByCoprId.size} projects with votes`);

    const downloadsByFullName = parseCounterStatLines(sections["public.counter_stat"]);
    console.log(`Parsed ${downloadsByFullName.size} projects with download stats`);

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

    let votesUpdated = 0;
    let downloadsUpdated = 0;

    for (const project of allProjects) {
      const updates: Record<string, unknown> = {};

      if (project.coprId && votesByCoprId.has(project.coprId)) {
        updates.coprVotes = votesByCoprId.get(project.coprId)!;
        votesUpdated++;
      }

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

    await syncDiscourseStats(db, allProjects);
    await recomputeAllPopularityScores(db);
  } finally {
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
    await sleep(200);
  }

  console.log(`Discourse sync: ${discovered} discovered, ${updated} updated`);
}
