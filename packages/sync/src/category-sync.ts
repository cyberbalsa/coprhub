import { sql, eq, inArray } from "drizzle-orm";
import type { Db } from "@coprhub/shared";
import { projects, packages as packagesTable, categories, projectCategories, syncJobs } from "@coprhub/shared";
import { shouldSkipSync, type SyncOptions } from "./ttl.js";
import { CATEGORIES, mapFreeDesktopCategories } from "./category-mapping.js";
import { downloadAllAppStreamIndices } from "./appstream-downloader.js";
import { classifyByHeuristics, type ProjectMetadata } from "./category-heuristics.js";
import { createLlmClassifier } from "./category-llm.js";

const LLM_API_URL = process.env.LLM_API_URL;
const LLM_API_KEY = process.env.LLM_API_KEY;
const LLM_MODEL = process.env.LLM_MODEL || "qwen3:8b";

export async function syncCategories(db: Db, options: SyncOptions) {
  const start = Date.now();

  // Check TTL
  const lastJob = await db
    .select()
    .from(syncJobs)
    .where(eq(syncJobs.jobName, "category-sync"))
    .limit(1);
  if (shouldSkipSync(lastJob[0]?.lastCompletedAt ?? null, options.ttlHours, options.forceSync)) {
    console.log("Category sync: skipped (within TTL)");
    return;
  }

  console.log("Category sync: starting...");

  // Step 1: Seed categories (idempotent)
  console.log("Seeding categories...");
  for (const cat of CATEGORIES) {
    await db
      .insert(categories)
      .values({ slug: cat.slug, name: cat.name })
      .onConflictDoNothing();
  }

  // Build slug → categoryId map
  const catRows = await db.select().from(categories);
  const slugToId = new Map(catRows.map((r) => [r.slug, r.id]));

  // Step 2: Download AppStream indices
  console.log("Downloading AppStream indices...");
  const appstreamMap = await downloadAllAppStreamIndices();

  // Step 3: Find projects needing classification
  const projectsToClassify = await db
    .select({
      id: projects.id,
      owner: projects.owner,
      name: projects.name,
      description: projects.description,
      homepage: projects.homepage,
      upstreamLanguage: projects.upstreamLanguage,
      upstreamTopics: projects.upstreamTopics,
      updatedAt: projects.updatedAt,
      categorySyncedAt: projects.categorySyncedAt,
    })
    .from(projects)
    .where(
      sql`${projects.categorySyncedAt} IS NULL OR ${projects.updatedAt} > ${projects.categorySyncedAt}`
    );

  console.log(`Projects to classify: ${projectsToClassify.length}`);

  if (projectsToClassify.length === 0) {
    console.log("Category sync: nothing to do");
    return;
  }

  // Pre-fetch all package names for these projects (batched to avoid PostgreSQL ROW limit)
  const projectIds = projectsToClassify.map((p) => p.id);
  const projectPackageNames = new Map<number, string[]>();
  const BATCH_SIZE = 1000;
  for (let i = 0; i < projectIds.length; i += BATCH_SIZE) {
    const batch = projectIds.slice(i, i + BATCH_SIZE);
    const pkgs = await db
      .select({ projectId: packagesTable.projectId, name: packagesTable.name })
      .from(packagesTable)
      .where(inArray(packagesTable.projectId, batch));
    for (const pkg of pkgs) {
      const names = projectPackageNames.get(pkg.projectId) ?? [];
      names.push(pkg.name);
      projectPackageNames.set(pkg.projectId, names);
    }
  }

  // Create LLM classifier if endpoint is configured
  const llmClassifier = LLM_API_URL && LLM_API_KEY
    ? createLlmClassifier(LLM_API_URL, LLM_API_KEY, LLM_MODEL)
    : null;

  const stats = { appstream: 0, heuristic: 0, llm: 0, failed: 0 };
  const LLM_CONCURRENCY = 5;

  // Helper to write a classification result to the DB
  async function writeResult(projectId: number, slug: string, source: "appstream" | "heuristic" | "llm") {
    const categoryId = slugToId.get(slug);
    if (categoryId) {
      await db.delete(projectCategories).where(eq(projectCategories.projectId, projectId));
      await db.insert(projectCategories).values({ projectId, categoryId, source });
    }
    await db.update(projects).set({ categorySyncedAt: new Date() }).where(eq(projects.id, projectId));
    stats[source]++;
  }

  // Step 4a: Fast tiers (AppStream + heuristics) — sequential
  const needsLlm: typeof projectsToClassify = [];

  for (let i = 0; i < projectsToClassify.length; i++) {
    const project = projectsToClassify[i];
    let slug: string | null = null;

    // Tier 1: AppStream cross-reference
    const pkgNames = projectPackageNames.get(project.id) ?? [project.name];
    for (const pkgName of pkgNames) {
      const fdCategories = appstreamMap.get(pkgName);
      if (fdCategories) {
        slug = mapFreeDesktopCategories(fdCategories);
        if (slug) break;
      }
    }

    if (slug) {
      await writeResult(project.id, slug, "appstream");
      continue;
    }

    // Tier 2: Heuristics
    const meta: ProjectMetadata = {
      name: project.name,
      owner: project.owner,
      description: project.description,
      upstreamTopics: project.upstreamTopics,
      upstreamLanguage: project.upstreamLanguage,
      homepage: project.homepage,
    };
    slug = classifyByHeuristics(meta);

    if (slug) {
      await writeResult(project.id, slug, "heuristic");
      continue;
    }

    // Needs LLM or fallback
    needsLlm.push(project);
  }

  console.log(`  Fast tiers done: AppStream ${stats.appstream}, Heuristic ${stats.heuristic}. LLM queue: ${needsLlm.length}`);

  // Step 4b: LLM tier — concurrent batches of LLM_CONCURRENCY
  if (llmClassifier && needsLlm.length > 0) {
    for (let i = 0; i < needsLlm.length; i += LLM_CONCURRENCY) {
      const batch = needsLlm.slice(i, i + LLM_CONCURRENCY);

      const results = await Promise.allSettled(
        batch.map(async (project) => {
          const result = await llmClassifier.classify({
            name: `${project.owner}/${project.name}`,
            description: project.description,
            upstreamLanguage: project.upstreamLanguage,
            upstreamTopics: project.upstreamTopics,
            homepage: project.homepage,
          });
          return { project, slug: result.category };
        }),
      );

      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        const project = batch[j];
        if (result.status === "fulfilled") {
          await writeResult(project.id, result.value.slug, "llm");
        } else {
          console.warn(`LLM failed for ${project.owner}/${project.name}: ${result.reason}`);
          stats.failed++;
          await writeResult(project.id, "utilities", "heuristic");
        }
      }

      // Progress log every 500 LLM calls
      const done = Math.min(i + LLM_CONCURRENCY, needsLlm.length);
      if (done % 500 === 0 || done === needsLlm.length) {
        console.log(`  LLM progress: ${done}/${needsLlm.length} (llm: ${stats.llm}, failed: ${stats.failed})`);
      }
    }
  } else if (needsLlm.length > 0) {
    // No LLM configured — fallback all to utilities
    for (const project of needsLlm) {
      await writeResult(project.id, "utilities", "heuristic");
    }
  }

  const duration = Date.now() - start;
  console.log(`Category sync complete in ${(duration / 1000).toFixed(1)}s`);
  console.log(`  AppStream: ${stats.appstream}, Heuristic: ${stats.heuristic}, LLM: ${stats.llm}, Failed: ${stats.failed}`);

  // Record sync job completion
  await db
    .insert(syncJobs)
    .values({ jobName: "category-sync", lastCompletedAt: new Date(), durationMs: duration })
    .onConflictDoUpdate({
      target: syncJobs.jobName,
      set: { lastCompletedAt: new Date(), durationMs: duration },
    });
}
