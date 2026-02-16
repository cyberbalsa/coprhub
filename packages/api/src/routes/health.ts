import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { projects, syncJobs } from "@coprhub/shared";
import type { Db } from "@coprhub/shared";

export function createHealthRouter(db: Db) {
  const router = new Hono();

  router.get("/", async (c) => {
    try {
      const [jobs, freshness] = await Promise.all([
        db.select().from(syncJobs),
        db
          .select({
            totalProjects: sql<number>`count(*)::int`,
            oldestUpdatedAt: sql<string | null>`min(${projects.updatedAt})::text`,
            newestUpdatedAt: sql<string | null>`max(${projects.updatedAt})::text`,
          })
          .from(projects),
      ]);

      const sync: Record<string, { lastCompletedAt: string; durationMs: number | null }> = {};
      for (const job of jobs) {
        sync[job.jobName] = {
          lastCompletedAt: job.lastCompletedAt.toISOString(),
          durationMs: job.durationMs,
        };
      }

      return c.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        sync,
        data: {
          totalProjects: freshness[0]?.totalProjects ?? 0,
          oldestUpdatedAt: freshness[0]?.oldestUpdatedAt ?? null,
          newestUpdatedAt: freshness[0]?.newestUpdatedAt ?? null,
        },
      });
    } catch {
      return c.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        sync: {},
        data: { totalProjects: 0, oldestUpdatedAt: null, newestUpdatedAt: null },
      });
    }
  });

  return router;
}
