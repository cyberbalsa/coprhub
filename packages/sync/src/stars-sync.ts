import { eq, isNotNull } from "drizzle-orm";
import { projects } from "@coprhub/shared";
import { parseUpstreamUrl } from "@coprhub/shared";
import type { Db } from "@coprhub/shared";
import { USER_AGENT } from "./user-agent.js";

const MAX_README_SIZE = 5 * 1024; // 5KB

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
    "User-Agent": USER_AGENT,
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
  const res = await fetch(`https://${host}/api/v4/projects/${encodedPath}`, {
    headers: { "User-Agent": USER_AGENT },
  });
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

export async function fetchGitHubReadme(owner: string, repo: string): Promise<string | null> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.raw+json",
    "User-Agent": USER_AGENT,
  };
  if (GITHUB_TOKEN) {
    headers["Authorization"] = `Bearer ${GITHUB_TOKEN}`;
  }

  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/readme`, { headers });
  if (!res.ok) return null;

  const text = await res.text();
  return text.length > MAX_README_SIZE ? text.slice(0, MAX_README_SIZE) : text;
}

export async function fetchGitLabReadme(host: string, projectPath: string): Promise<string | null> {
  const encodedPath = encodeURIComponent(projectPath);
  for (const filename of ["README.md", "readme.md"]) {
    const encodedFile = encodeURIComponent(filename);
    const res = await fetch(
      `https://${host}/api/v4/projects/${encodedPath}/repository/files/${encodedFile}/raw?ref=HEAD`,
      { headers: { "User-Agent": USER_AGENT } }
    );
    if (res.ok) {
      const text = await res.text();
      return text.length > MAX_README_SIZE ? text.slice(0, MAX_README_SIZE) : text;
    }
  }
  return null;
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

    // Fetch README
    let readme: string | null = null;
    if (parsed.provider === "github") {
      readme = await fetchGitHubReadme(parsed.owner, parsed.repo);
    } else if (parsed.provider === "gitlab") {
      const host = new URL(project.upstreamUrl!).host;
      readme = await fetchGitLabReadme(host, `${parsed.owner}/${parsed.repo}`);
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
          upstreamReadme: readme,
          readmeSyncedAt: new Date(),
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
