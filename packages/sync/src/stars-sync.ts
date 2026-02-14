import { eq, isNotNull } from "drizzle-orm";
import { projects } from "@copr-index/shared";
import { parseUpstreamUrl } from "@copr-index/shared";
import type { Db } from "@copr-index/shared";

export interface UpstreamMeta {
  stars: number;
  forks: number;
  language: string | null;
  description: string | null;
  topics: string[];
}

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

export async function fetchGitHubStars(owner: string, repo: string): Promise<UpstreamMeta | null> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "copr-index",
  };
  if (GITHUB_TOKEN) {
    headers["Authorization"] = `Bearer ${GITHUB_TOKEN}`;
  }

  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
  if (!res.ok) return null;

  const remaining = res.headers.get("x-ratelimit-remaining");
  if (remaining && parseInt(remaining, 10) < 10) {
    const resetAt = res.headers.get("x-ratelimit-reset");
    const waitMs = resetAt ? parseInt(resetAt, 10) * 1000 - Date.now() + 1000 : 60000;
    console.log(`GitHub rate limit low, sleeping ${waitMs}ms`);
    await sleep(Math.max(waitMs, 1000));
  }

  const data = await res.json();
  return {
    stars: data.stargazers_count,
    forks: data.forks_count,
    language: data.language ?? null,
    description: data.description ?? null,
    topics: data.topics ?? [],
  };
}

export async function fetchGitLabStars(host: string, projectPath: string): Promise<UpstreamMeta | null> {
  const encodedPath = encodeURIComponent(projectPath);
  const res = await fetch(`https://${host}/api/v4/projects/${encodedPath}`);
  if (!res.ok) return null;

  const data = await res.json();
  return {
    stars: data.star_count,
    forks: data.forks_count,
    language: null,
    description: data.description ?? null,
    topics: data.topics ?? [],
  };
}

export async function syncAllStars(db: Db): Promise<number> {
  console.log("Starting star sync...");

  const projectsWithUpstream = await db
    .select({
      id: projects.id,
      upstreamUrl: projects.upstreamUrl,
      upstreamProvider: projects.upstreamProvider,
    })
    .from(projects)
    .where(isNotNull(projects.upstreamUrl));

  let synced = 0;

  for (const project of projectsWithUpstream) {
    const parsed = parseUpstreamUrl(project.upstreamUrl!);
    if (!parsed) continue;

    let meta: UpstreamMeta | null = null;

    if (parsed.provider === "github") {
      meta = await fetchGitHubStars(parsed.owner, parsed.repo);
    } else if (parsed.provider === "gitlab") {
      const host = new URL(project.upstreamUrl!).host;
      meta = await fetchGitLabStars(host, `${parsed.owner}/${parsed.repo}`);
    }

    if (meta) {
      await db
        .update(projects)
        .set({
          upstreamStars: meta.stars,
          upstreamForks: meta.forks,
          upstreamLanguage: meta.language,
          upstreamDescription: meta.description,
          upstreamTopics: meta.topics,
          starsSyncedAt: new Date(),
        })
        .where(eq(projects.id, project.id));
      synced++;
    }

    await sleep(100);
  }

  console.log(`Star sync complete. Updated ${synced} projects.`);
  return synced;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
