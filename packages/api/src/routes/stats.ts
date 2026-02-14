import { Hono } from "hono";
import { sql, isNotNull } from "drizzle-orm";
import { projects } from "@copr-index/shared";
import type { Db } from "@copr-index/shared";

export function createStatsRouter(db: Db) {
  const router = new Hono();

  router.get("/", async (c) => {
    const [totals, languages] = await Promise.all([
      db
        .select({
          totalProjects: sql<number>`count(*)::int`,
          totalWithUpstream: sql<number>`count(${projects.upstreamUrl})::int`,
        })
        .from(projects),
      db
        .select({
          language: projects.upstreamLanguage,
          count: sql<number>`count(*)::int`,
        })
        .from(projects)
        .where(isNotNull(projects.upstreamLanguage))
        .groupBy(projects.upstreamLanguage)
        .orderBy(sql`count(*) desc`)
        .limit(20),
    ]);

    return c.json({
      totalProjects: totals[0]?.totalProjects || 0,
      totalWithUpstream: totals[0]?.totalWithUpstream || 0,
      topLanguages: languages.map((l) => ({
        language: l.language!,
        count: l.count,
      })),
    });
  });

  return router;
}
