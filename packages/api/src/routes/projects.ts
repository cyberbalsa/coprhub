import { Hono } from "hono";
import { eq, desc, asc, sql, and } from "drizzle-orm";
import {
  projects,
  packages as packagesTable,
  categories,
  projectCategories,
} from "@coprhub/shared";
import type { Db } from "@coprhub/shared";
import type { ProjectsQuery, PaginatedResponse, ProjectSummary, ProjectDetail, PackageInfo } from "@coprhub/shared";

export function createProjectsRouter(db: Db) {
  const router = new Hono();

  router.get("/", async (c) => {
    const query: ProjectsQuery = {
      q: c.req.query("q"),
      sort: (c.req.query("sort") as ProjectsQuery["sort"]) || "popularity",
      order: (c.req.query("order") as ProjectsQuery["order"]) || "desc",
      category: c.req.query("category"),
      owner: c.req.query("owner"),
      language: c.req.query("language"),
      page: parseInt(c.req.query("page") || "1", 10),
      limit: Math.min(parseInt(c.req.query("limit") || "24", 10), 100),
    };

    const conditions: any[] = [];
    if (query.owner) conditions.push(eq(projects.owner, query.owner));
    if (query.language) conditions.push(eq(projects.upstreamLanguage, query.language));
    if (query.q) {
      conditions.push(
        sql`${projects.searchVector}::tsvector @@ plainto_tsquery('english', ${query.q})`
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const orderMap: Record<string, any> = {
      popularity: projects.popularityScore,
      stars: projects.upstreamStars,
      votes: projects.coprVotes,
      downloads: projects.coprDownloads,
      likes: projects.discourseLikes,
      views: projects.discourseViews,
      replies: projects.discourseReplies,
      name: projects.fullName,
      updated: projects.updatedAt,
    };
    const orderCol = orderMap[query.sort || "popularity"] ?? projects.popularityScore;
    const orderDir = query.order === "asc" ? asc(orderCol) : desc(orderCol);
    const offset = ((query.page || 1) - 1) * (query.limit || 24);

    const [data, countResult] = await Promise.all([
      db
        .select({
          id: projects.id,
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
        })
        .from(projects)
        .where(where)
        .orderBy(orderDir)
        .limit(query.limit || 24)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(projects)
        .where(where),
    ]);

    const total = countResult[0]?.count || 0;

    return c.json({
      data,
      meta: {
        page: query.page || 1,
        limit: query.limit || 24,
        total,
        pages: Math.ceil(total / (query.limit || 24)),
      },
    } satisfies PaginatedResponse<ProjectSummary>);
  });

  router.get("/:owner/:name", async (c) => {
    const { owner, name } = c.req.param();
    const result = await db
      .select()
      .from(projects)
      .where(and(eq(projects.owner, owner), eq(projects.name, name)))
      .limit(1);

    if (result.length === 0) {
      return c.json({ error: "Project not found" }, 404);
    }

    const project = result[0];
    return c.json({
      id: project.id,
      fullName: project.fullName,
      owner: project.owner,
      name: project.name,
      description: project.description,
      instructions: project.instructions,
      homepage: project.homepage,
      chroots: project.chroots,
      repoUrl: project.repoUrl,
      upstreamUrl: project.upstreamUrl,
      upstreamProvider: project.upstreamProvider,
      upstreamStars: project.upstreamStars ?? 0,
      upstreamForks: project.upstreamForks ?? 0,
      upstreamDescription: project.upstreamDescription,
      upstreamLanguage: project.upstreamLanguage,
      upstreamTopics: project.upstreamTopics,
      coprVotes: project.coprVotes ?? 0,
      coprDownloads: project.coprDownloads ?? 0,
      coprRepoEnables: project.coprRepoEnables ?? 0,
      discourseLikes: project.discourseLikes ?? 0,
      discourseViews: project.discourseViews ?? 0,
      discourseReplies: project.discourseReplies ?? 0,
      upstreamReadme: project.upstreamReadme ?? null,
      popularityScore: project.popularityScore ?? 0,
      lastSyncedAt: project.lastSyncedAt?.toISOString() ?? null,
      createdAt: project.createdAt?.toISOString() ?? null,
    } satisfies ProjectDetail);
  });

  router.get("/:owner/:name/packages", async (c) => {
    const { owner, name } = c.req.param();
    const project = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.owner, owner), eq(projects.name, name)))
      .limit(1);

    if (project.length === 0) {
      return c.json({ error: "Project not found" }, 404);
    }

    const pkgs = await db
      .select({
        id: packagesTable.id,
        name: packagesTable.name,
        sourceType: packagesTable.sourceType,
        sourceUrl: packagesTable.sourceUrl,
      })
      .from(packagesTable)
      .where(eq(packagesTable.projectId, project[0].id));

    return c.json({ data: pkgs satisfies PackageInfo[] });
  });

  return router;
}
