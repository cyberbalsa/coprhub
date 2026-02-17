import { Hono } from "hono";
import { eq, desc, asc, sql, and } from "drizzle-orm";
import {
  projects,
  packages as packagesTable,
  categories,
  projectCategories,
  discourseCache,
} from "@coprhub/shared";
import type { Db } from "@coprhub/shared";
import type { ProjectsQuery, PaginatedResponse, ProjectSummary, ProjectDetail, PackageInfo } from "@coprhub/shared";
import { buildTextFilter } from "../filters.js";

export function createProjectsRouter(db: Db) {
  const router = new Hono();

  router.get("/", async (c) => {
    const query: ProjectsQuery = {
      q: c.req.query("q"),
      sort: (c.req.query("sort") as ProjectsQuery["sort"]) || "popularity",
      order: (c.req.query("order") as ProjectsQuery["order"]) || "desc",
      category: c.req.query("category"),
      owner: c.req.query("owner"),
      name: c.req.query("name"),
      fullName: c.req.query("fullName"),
      language: c.req.query("language"),
      provider: c.req.query("provider"),
      description: c.req.query("description"),
      instructions: c.req.query("instructions"),
      homepage: c.req.query("homepage"),
      upstreamUrl: c.req.query("upstreamUrl"),
      upstreamDescription: c.req.query("upstreamDescription"),
      upstreamReadme: c.req.query("upstreamReadme"),
      page: parseInt(c.req.query("page") || "1", 10),
      limit: Math.min(parseInt(c.req.query("limit") || "24", 10), 100),
    };

    const conditions: any[] = [];

    // ILIKE text filters (supports * wildcards)
    const textFilters: [typeof projects.owner, string | undefined][] = [
      [projects.owner, query.owner],
      [projects.name, query.name],
      [projects.fullName, query.fullName],
      [projects.upstreamLanguage, query.language],
      [projects.upstreamProvider, query.provider],
      [projects.description, query.description],
      [projects.instructions, query.instructions],
      [projects.homepage, query.homepage],
      [projects.upstreamUrl, query.upstreamUrl],
      [projects.upstreamDescription, query.upstreamDescription],
      [projects.upstreamReadme, query.upstreamReadme],
    ];
    for (const [col, val] of textFilters) {
      const f = buildTextFilter(col, val);
      if (f) conditions.push(f);
    }

    // Full-text search
    if (query.q) {
      conditions.push(
        sql`${projects.searchVector}::tsvector @@ plainto_tsquery('english', ${query.q})`
      );
    }

    // Category filter (join-based)
    if (query.category) {
      conditions.push(
        sql`${projects.id} IN (
          SELECT ${projectCategories.projectId} FROM ${projectCategories}
          JOIN ${categories} ON ${projectCategories.categoryId} = ${categories.id}
          WHERE ${categories.slug} = ${query.category}
        )`
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const orderMap: Record<string, any> = {
      id: projects.id,
      coprId: projects.coprId,
      popularity: projects.popularityScore,
      stars: projects.upstreamStars,
      forks: projects.upstreamForks,
      votes: projects.coprVotes,
      downloads: projects.coprDownloads,
      enables: projects.coprRepoEnables,
      likes: projects.discourseLikes,
      views: projects.discourseViews,
      replies: projects.discourseReplies,
      discourseTopicId: projects.discourseTopicId,
      name: projects.fullName,
      owner: projects.owner,
      language: projects.upstreamLanguage,
      provider: projects.upstreamProvider,
      updated: projects.updatedAt,
      created: projects.createdAt,
      lastBuild: projects.lastBuildAt,
      lastSynced: projects.lastSyncedAt,
      starsSynced: projects.starsSyncedAt,
      readmeSynced: projects.readmeSyncedAt,
      votesSynced: projects.votesSyncedAt,
      discourseSynced: projects.discourseSyncedAt,
    };
    const orderCol = orderMap[query.sort || "popularity"] ?? projects.popularityScore;
    const orderDir = query.order === "asc" ? asc(orderCol) : desc(orderCol);
    const offset = ((query.page || 1) - 1) * (query.limit || 24);

    const [data, countResult] = await Promise.all([
      db
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

    const mapped: ProjectSummary[] = data.map((row) => ({
      ...row,
      upstreamStars: row.upstreamStars ?? 0,
      popularityScore: row.popularityScore ?? 0,
      coprVotes: row.coprVotes ?? 0,
      coprDownloads: row.coprDownloads ?? 0,
      coprRepoEnables: row.coprRepoEnables ?? 0,
      discourseLikes: row.discourseLikes ?? 0,
      discourseViews: row.discourseViews ?? 0,
      discourseReplies: row.discourseReplies ?? 0,
      lastBuildAt: row.lastBuildAt?.toISOString() ?? null,
      updatedAt: row.updatedAt?.toISOString() ?? null,
    }));

    return c.json({
      data: mapped,
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
      coprId: project.coprId,
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
      upstreamReadme: project.upstreamReadme ?? null,
      coprVotes: project.coprVotes ?? 0,
      coprDownloads: project.coprDownloads ?? 0,
      coprRepoEnables: project.coprRepoEnables ?? 0,
      discourseLikes: project.discourseLikes ?? 0,
      discourseViews: project.discourseViews ?? 0,
      discourseReplies: project.discourseReplies ?? 0,
      discourseTopicId: project.discourseTopicId,
      popularityScore: project.popularityScore ?? 0,
      lastBuildAt: project.lastBuildAt?.toISOString() ?? null,
      lastSyncedAt: project.lastSyncedAt?.toISOString() ?? null,
      createdAt: project.createdAt?.toISOString() ?? null,
      readmeSyncedAt: project.readmeSyncedAt?.toISOString() ?? null,
      votesSyncedAt: project.votesSyncedAt?.toISOString() ?? null,
      starsSyncedAt: project.starsSyncedAt?.toISOString() ?? null,
      discourseSyncedAt: project.discourseSyncedAt?.toISOString() ?? null,
      updatedAt: project.updatedAt?.toISOString() ?? null,
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

  // Comments proxy - fetches from Discourse API, cached in PostgreSQL for 12 hours
  const CACHE_TTL_HOURS = 12;

  router.get("/:owner/:name/comments", async (c) => {
    const { owner, name } = c.req.param();

    const project = await db
      .select({
        id: projects.id,
        discourseTopicId: projects.discourseTopicId,
      })
      .from(projects)
      .where(and(eq(projects.owner, owner), eq(projects.name, name)))
      .limit(1);

    if (project.length === 0) {
      return c.json({ error: "Project not found" }, 404);
    }

    const { id: projectId, discourseTopicId: topicId } = project[0];

    // Check DB cache
    const cached = await db
      .select()
      .from(discourseCache)
      .where(eq(discourseCache.projectId, projectId))
      .limit(1);

    if (cached.length > 0) {
      const age = Date.now() - cached[0].fetchedAt.getTime();
      if (age < CACHE_TTL_HOURS * 60 * 60 * 1000) {
        return c.json(cached[0].data);
      }
    }

    if (!topicId) {
      const result = { data: [], topicUrl: null };
      await db
        .insert(discourseCache)
        .values({ projectId, data: result, fetchedAt: new Date() })
        .onConflictDoUpdate({
          target: discourseCache.projectId,
          set: { data: result, fetchedAt: new Date() },
        });
      return c.json(result);
    }

    try {
      const res = await fetch(
        `https://discussion.fedoraproject.org/t/${topicId}.json`,
        { headers: { "User-Agent": "COPRHub/1.0 (https://coprhub.org)" } }
      );
      if (!res.ok) {
        // On fetch failure, return stale cache if available
        if (cached.length > 0) return c.json(cached[0].data);
        const result = { data: [], topicUrl: `https://discussion.fedoraproject.org/t/${topicId}` };
        return c.json(result);
      }

      const topic = await res.json();
      const posts = (topic.post_stream?.posts ?? []).map((p: any) => ({
        id: p.id,
        username: p.username,
        avatarUrl: p.avatar_template
          ? `https://discussion.fedoraproject.org${p.avatar_template.replace("{size}", "48")}`
          : null,
        content: p.cooked,
        createdAt: p.created_at,
        likeCount: p.like_count ?? 0,
        replyCount: p.reply_count ?? 0,
        postNumber: p.post_number,
      }));

      const result = {
        data: posts,
        topicUrl: `https://discussion.fedoraproject.org/t/${topic.slug}/${topicId}`,
        title: topic.title,
      };

      await db
        .insert(discourseCache)
        .values({ projectId, data: result, fetchedAt: new Date() })
        .onConflictDoUpdate({
          target: discourseCache.projectId,
          set: { data: result, fetchedAt: new Date() },
        });

      return c.json(result);
    } catch {
      if (cached.length > 0) return c.json(cached[0].data);
      return c.json({ data: [], topicUrl: `https://discussion.fedoraproject.org/t/${topicId}` });
    }
  });

  return router;
}
