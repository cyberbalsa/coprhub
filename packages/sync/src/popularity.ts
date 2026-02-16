import { sql } from "drizzle-orm";
import { projects } from "@coprhub/shared";
import type { Db } from "@coprhub/shared";

export const WEIGHTS = {
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

export const STALENESS = {
  gracePeriodDays: 7,
  decayRate: 3.0,
  decayWindowDays: 83,  // 90 - 7 (grace period)
  minMultiplier: 0.05,
} as const;

export function computeStalenessMultiplier(lastBuildAt: Date | null, now: Date = new Date()): number {
  if (!lastBuildAt) return 1.0;
  const daysSinceBuild = (now.getTime() - lastBuildAt.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceBuild <= STALENESS.gracePeriodDays) return 1.0;
  const d = daysSinceBuild - STALENESS.gracePeriodDays;
  return Math.max(STALENESS.minMultiplier, Math.exp(-STALENESS.decayRate * d / STALENESS.decayWindowDays));
}

export interface PopularityInput {
  stars: number;
  votes: number;
  downloads: number;
  repoEnables: number;
  discourseLikes: number;
  discourseReplies: number;
  discourseViews: number;
}

export function computePopularityScore(input: PopularityInput): number {
  return Math.floor(
    input.stars * WEIGHTS.stars +
    input.votes * WEIGHTS.votes +
    Math.min(input.downloads * WEIGHTS.downloads, WEIGHTS.downloadsCap) +
    Math.min(input.repoEnables * WEIGHTS.repoEnables, WEIGHTS.repoEnablesCap) +
    input.discourseLikes * WEIGHTS.discourseLikes +
    input.discourseReplies * WEIGHTS.discourseReplies +
    (input.discourseViews > 0 ? Math.log(input.discourseViews) * WEIGHTS.discourseViews : 0)
  );
}

export async function recomputeAllPopularityScores(db: Db): Promise<void> {
  console.log("Recomputing all popularity scores...");

  await db
    .update(projects)
    .set({
      popularityScore: sql`
        (COALESCE(upstream_stars, 0) * 10) +
        (COALESCE(copr_votes, 0) * 5) +
        LEAST(COALESCE(copr_downloads, 0) * 0.01, 1000)::integer +
        LEAST(COALESCE(copr_repo_enables, 0) * 0.1, 500)::integer +
        (COALESCE(discourse_likes, 0) * 3) +
        (COALESCE(discourse_replies, 0) * 1) +
        (ln(greatest(COALESCE(discourse_views, 0), 1)) * 2)::integer
      `,
    });

  console.log("Popularity score recomputation complete.");
}
