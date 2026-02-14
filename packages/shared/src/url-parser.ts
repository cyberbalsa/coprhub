export interface UpstreamInfo {
  provider: "github" | "gitlab";
  owner: string;
  repo: string;
  url: string;
}

const GITHUB_REGEX =
  /https?:\/\/github\.com\/([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)/;

const GITLAB_REGEX =
  /https?:\/\/(gitlab\.[a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)/;

export function parseUpstreamUrl(url: string): UpstreamInfo | null {
  if (!url) return null;

  const ghMatch = url.match(GITHUB_REGEX);
  if (ghMatch) {
    return {
      provider: "github",
      owner: ghMatch[1],
      repo: ghMatch[2].replace(/\.git$/, ""),
      url: `https://github.com/${ghMatch[1]}/${ghMatch[2].replace(/\.git$/, "")}`,
    };
  }

  const glMatch = url.match(GITLAB_REGEX);
  if (glMatch) {
    const host = glMatch[1];
    const owner = glMatch[2];
    const repo = glMatch[3].replace(/\.git$/, "");
    return {
      provider: "gitlab",
      owner,
      repo,
      url: `https://${host}/${owner}/${repo}`,
    };
  }

  return null;
}

export function extractUpstreamFromTexts(fields: {
  homepage?: string | null;
  cloneUrl?: string | null;
  description?: string | null;
  instructions?: string | null;
}): UpstreamInfo | null {
  const sources = [
    fields.homepage,
    fields.cloneUrl,
    fields.description,
    fields.instructions,
  ];

  for (const source of sources) {
    if (!source) continue;
    const result = parseUpstreamUrl(source);
    if (result) return result;
  }

  return null;
}
