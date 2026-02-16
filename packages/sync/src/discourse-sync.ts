import { eq, or, isNull, lt, sql } from "drizzle-orm";
import { projects, syncJobs } from "@coprhub/shared";
import type { Db } from "@coprhub/shared";
import { USER_AGENT } from "./user-agent.js";
import type { SyncOptions } from "./ttl.js";

const DISCOURSE_BASE = "https://discussion.fedoraproject.org";

export interface DiscourseTopicInfo {
  topicId: number;
  slug: string;
  likes: number;
  views: number;
  replies: number;
}

export interface DiscourseStats {
  likes: number;
  views: number;
  replies: number;
}

export async function fetchDiscourseTopicByEmbedUrl(
  owner: string,
  name: string,
): Promise<DiscourseTopicInfo | null> {
  const embedUrl = `copr.fedorainfracloud.org/coprs/${owner}/${name}`;
  const url = `${DISCOURSE_BASE}/search.json?q=${encodeURIComponent(embedUrl)}`;

  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!res.ok) return null;

  const data = await res.json();
  const topics = data.topics;

  if (!topics || topics.length === 0) return null;

  const topic = topics[0];
  return {
    topicId: topic.id,
    slug: topic.slug,
    likes: topic.like_count,
    views: topic.views,
    replies: topic.reply_count,
  };
}

export async function fetchDiscourseTopicStats(
  topicId: number,
): Promise<DiscourseStats | null> {
  const url = `${DISCOURSE_BASE}/t/${topicId}.json`;

  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!res.ok) return null;

  const data = await res.json();
  return {
    likes: data.like_count,
    views: data.views,
    replies: data.reply_count,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function syncAllDiscourseStats(db: Db, options: SyncOptions): Promise<void> {
  console.log("Syncing Discourse stats...");

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
          discourseSyncedAt: new Date(),
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
          discourseSyncedAt: new Date(),
        }).where(eq(projects.id, project.id));
        discovered++;
      } else {
        // No topic found — still mark as synced so we don't re-search every run
        await db.update(projects).set({
          discourseSyncedAt: new Date(),
        }).where(eq(projects.id, project.id));
      }
    }
    await sleep(200);
  }

  await db
    .insert(syncJobs)
    .values({ jobName: "discourse_sync", lastCompletedAt: new Date(), durationMs: null })
    .onConflictDoUpdate({
      target: syncJobs.jobName,
      set: { lastCompletedAt: new Date() },
    });

  console.log(`Discourse sync: ${discovered} discovered, ${updated} updated`);
}
