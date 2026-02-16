import { eq } from "drizzle-orm";
import { projects, packages as packagesTable } from "@coprhub/shared";
import { extractUpstreamFromTexts } from "@coprhub/shared";
import type { Db } from "@coprhub/shared";
import { USER_AGENT } from "./user-agent.js";

const COPR_API_BASE = "https://copr.fedorainfracloud.org/api_3";

export interface CoprApiProject {
  id: number;
  name: string;
  ownername: string;
  full_name: string;
  description: string | null;
  instructions: string | null;
  homepage: string | null;
  chroot_repos: Record<string, string>;
  repo_url: string | null;
}

interface CoprApiPackage {
  id: number;
  name: string;
  source_type: string | null;
  source_dict: {
    clone_url?: string;
    [key: string]: unknown;
  } | null;
}

interface CoprListResponse {
  items: CoprApiProject[];
  meta: { limit: number; offset: number; order: string; order_type: string };
}

export function parseCoprProject(apiProject: CoprApiProject) {
  const chroots = Object.keys(apiProject.chroot_repos || {});
  return {
    coprId: apiProject.id,
    owner: apiProject.ownername,
    name: apiProject.name,
    fullName: apiProject.full_name,
    description: apiProject.description,
    instructions: apiProject.instructions,
    homepage: apiProject.homepage,
    chroots,
    repoUrl:
      apiProject.repo_url ??
      `https://copr.fedorainfracloud.org/coprs/${apiProject.full_name}/`,
  };
}

export async function syncCoprProjects(db: Db): Promise<number> {
  let offset = 0;
  const limit = 100;
  let totalSynced = 0;

  console.log("Starting COPR project sync...");

  while (true) {
    const url = `${COPR_API_BASE}/project/list?limit=${limit}&offset=${offset}`;
    console.log(`Fetching: ${url}`);

    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!response.ok) {
      console.error(`COPR API error: ${response.status}`);
      break;
    }

    const data: CoprListResponse = await response.json();
    if (data.items.length === 0) break;

    for (const apiProject of data.items) {
      const parsed = parseCoprProject(apiProject);
      const upstream = extractUpstreamFromTexts({
        homepage: apiProject.homepage,
        description: apiProject.description,
        instructions: apiProject.instructions,
      });

      const projectData = {
        ...parsed,
        upstreamUrl: upstream?.url ?? null,
        upstreamProvider: upstream?.provider ?? null,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      };

      await db
        .insert(projects)
        .values(projectData)
        .onConflictDoUpdate({
          target: projects.coprId,
          set: projectData,
        });

      await syncProjectPackages(db, apiProject.ownername, apiProject.name);
      totalSynced++;
    }

    console.log(`Synced ${totalSynced} projects so far (offset: ${offset})...`);
    offset += limit;
    if (data.items.length < limit) break;
    await sleep(500);
  }

  console.log(`COPR sync complete. Synced ${totalSynced} projects.`);
  return totalSynced;
}

async function syncProjectPackages(db: Db, owner: string, projectName: string) {
  const url = `${COPR_API_BASE}/package/list?ownername=${owner}&projectname=${projectName}&limit=100`;
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!response.ok) return;

  const data: { items: CoprApiPackage[] } = await response.json();
  const project = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.fullName, `${owner}/${projectName}`))
    .limit(1);

  if (project.length === 0) return;

  for (const pkg of data.items) {
    const cloneUrl = pkg.source_dict?.clone_url ?? null;

    if (cloneUrl) {
      const upstream = extractUpstreamFromTexts({ cloneUrl });
      if (upstream) {
        await db
          .update(projects)
          .set({ upstreamUrl: upstream.url, upstreamProvider: upstream.provider })
          .where(eq(projects.id, project[0].id));
      }
    }

    await db
      .insert(packagesTable)
      .values({
        projectId: project[0].id,
        name: pkg.name,
        sourceType: pkg.source_type,
        sourceUrl: cloneUrl,
      })
      .onConflictDoNothing();
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
