import { Hono } from "hono";
import { eq, sql, desc } from "drizzle-orm";
import { categories, projectCategories, projects } from "@coprhub/shared";
import type { Db } from "@coprhub/shared";

export function createCategoriesRouter(db: Db) {
  const router = new Hono();

  router.get("/", async (c) => {
    const result = await db
      .select({
        id: categories.id,
        slug: categories.slug,
        name: categories.name,
        projectCount: sql<number>`count(${projectCategories.projectId})::int`,
      })
      .from(categories)
      .leftJoin(projectCategories, eq(categories.id, projectCategories.categoryId))
      .groupBy(categories.id)
      .orderBy(categories.name);

    return c.json({ data: result });
  });

  router.get("/:slug", async (c) => {
    const { slug } = c.req.param();
    const page = parseInt(c.req.query("page") || "1", 10);
    const limit = Math.min(parseInt(c.req.query("limit") || "24", 10), 100);
    const offset = (page - 1) * limit;

    const data = await db
      .select({
        id: projects.id,
        coprId: projects.coprId,
        fullName: projects.fullName,
        owner: projects.owner,
        name: projects.name,
        description: projects.description,
        upstreamUrl: projects.upstreamUrl,
        upstreamProvider: projects.upstreamProvider,
        upstreamStars: projects.upstreamStars,
        upstreamLanguage: projects.upstreamLanguage,
        popularityScore: projects.popularityScore,
        coprVotes: projects.coprVotes,
        coprDownloads: projects.coprDownloads,
        coprRepoEnables: projects.coprRepoEnables,
        discourseLikes: projects.discourseLikes,
        discourseViews: projects.discourseViews,
        discourseReplies: projects.discourseReplies,
        lastBuildAt: projects.lastBuildAt,
        updatedAt: projects.updatedAt,
      })
      .from(projects)
      .innerJoin(projectCategories, eq(projects.id, projectCategories.projectId))
      .innerJoin(categories, eq(projectCategories.categoryId, categories.id))
      .where(eq(categories.slug, slug))
      .orderBy(desc(projects.upstreamStars))
      .limit(limit)
      .offset(offset);

    return c.json({ data });
  });

  return router;
}
