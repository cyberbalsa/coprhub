import type { ProjectDetail } from "@coprhub/shared";

export function formatShortNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    return k % 1 === 0 ? `${k}K` : `${k.toFixed(1).replace(/\.0$/, "")}K`;
  }
  const m = n / 1_000_000;
  return m % 1 === 0 ? `${m}M` : `${m.toFixed(1).replace(/\.0$/, "")}M`;
}

const WEIGHTS = {
  stars: 10,
  votes: 5,
  downloads: 0.01,
  downloadsCap: 1000,
  repoEnables: 0.1,
  repoEnablesCap: 500,
  discourseLikes: 3,
  discourseReplies: 1,
  discourseViews: 2,
} as const;

const STALENESS = {
  gracePeriodDays: 7,
  decayRate: 3.0,
  decayWindowDays: 83,
  minMultiplier: 0.05,
} as const;

function computeStalenessMultiplier(lastBuildAt: Date | null, now: Date = new Date()): number {
  if (!lastBuildAt) return 1.0;
  const daysSinceBuild = (now.getTime() - lastBuildAt.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceBuild <= STALENESS.gracePeriodDays) return 1.0;
  const d = daysSinceBuild - STALENESS.gracePeriodDays;
  return Math.max(STALENESS.minMultiplier, Math.exp(-STALENESS.decayRate * d / STALENESS.decayWindowDays));
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

export function buildPopularityTooltip(project: ProjectDetail): string {
  const lines: string[] = ["Popularity Breakdown", "───────────────────"];

  const starsVal = project.upstreamStars * WEIGHTS.stars;
  if (project.upstreamStars > 0)
    lines.push(`Stars: ${fmt(project.upstreamStars)} × ${WEIGHTS.stars} = ${fmt(starsVal)}`);

  const votesVal = project.coprVotes * WEIGHTS.votes;
  if (project.coprVotes > 0)
    lines.push(`Votes: ${fmt(project.coprVotes)} × ${WEIGHTS.votes} = ${fmt(votesVal)}`);

  const dlRaw = project.coprDownloads * WEIGHTS.downloads;
  const dlVal = Math.min(dlRaw, WEIGHTS.downloadsCap);
  if (project.coprDownloads > 0) {
    const capped = dlRaw > WEIGHTS.downloadsCap;
    lines.push(`Downloads: ${fmt(project.coprDownloads)} × ${WEIGHTS.downloads} = ${fmt(Math.round(dlVal))}${capped ? " (capped)" : ""}`);
  }

  const reRaw = project.coprRepoEnables * WEIGHTS.repoEnables;
  const reVal = Math.min(reRaw, WEIGHTS.repoEnablesCap);
  if (project.coprRepoEnables > 0) {
    const capped = reRaw > WEIGHTS.repoEnablesCap;
    lines.push(`Repo enables: ${fmt(project.coprRepoEnables)} × ${WEIGHTS.repoEnables} = ${fmt(Math.round(reVal))}${capped ? " (capped)" : ""}`);
  }

  if (project.discourseLikes > 0)
    lines.push(`Discourse likes: ${fmt(project.discourseLikes)} × ${WEIGHTS.discourseLikes} = ${fmt(project.discourseLikes * WEIGHTS.discourseLikes)}`);

  if (project.discourseReplies > 0)
    lines.push(`Discourse replies: ${fmt(project.discourseReplies)} × ${WEIGHTS.discourseReplies} = ${fmt(project.discourseReplies * WEIGHTS.discourseReplies)}`);

  const dvVal = project.discourseViews > 0 ? Math.round(Math.log(project.discourseViews) * WEIGHTS.discourseViews) : 0;
  if (project.discourseViews > 0)
    lines.push(`Discourse views: ln(${fmt(project.discourseViews)}) × ${WEIGHTS.discourseViews} = ${fmt(dvVal)}`);

  const baseScore = starsVal + votesVal + Math.round(dlVal) + Math.round(reVal)
    + (project.discourseLikes * WEIGHTS.discourseLikes)
    + (project.discourseReplies * WEIGHTS.discourseReplies)
    + dvVal;

  const lastBuild = project.lastBuildAt ? new Date(project.lastBuildAt) : null;
  const multiplier = computeStalenessMultiplier(lastBuild);

  lines.push("───────────────────");
  lines.push(`Base score: ${fmt(baseScore)}`);

  if (!lastBuild) {
    lines.push("Staleness: ×1.00 (no build date)");
  } else {
    const daysAgo = Math.round((Date.now() - lastBuild.getTime()) / (1000 * 60 * 60 * 24));
    lines.push(`Staleness (${daysAgo}d ago): ×${multiplier.toFixed(2)}`);
  }

  lines.push(`Final: ${fmt(Math.floor(baseScore * multiplier))}`);

  return lines.join("\n");
}
