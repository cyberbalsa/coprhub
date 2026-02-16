import { describe, it, expect } from "vitest";
import { computePopularityScore, computeStalenessMultiplier, WEIGHTS, STALENESS } from "./popularity.js";

describe("computePopularityScore", () => {
  it("computes weighted score", () => {
    const score = computePopularityScore({
      stars: 100,
      votes: 10,
      downloads: 50000,
      repoEnables: 2000,
      discourseLikes: 20,
      discourseReplies: 50,
      discourseViews: 5000,
    });

    const expected = Math.floor(
      100 * WEIGHTS.stars +
      10 * WEIGHTS.votes +
      Math.min(50000 * WEIGHTS.downloads, WEIGHTS.downloadsCap) +
      Math.min(2000 * WEIGHTS.repoEnables, WEIGHTS.repoEnablesCap) +
      20 * WEIGHTS.discourseLikes +
      50 * WEIGHTS.discourseReplies +
      Math.log(5000) * WEIGHTS.discourseViews
    );

    expect(score).toBe(expected);
  });

  it("handles all zeros", () => {
    const score = computePopularityScore({
      stars: 0, votes: 0, downloads: 0, repoEnables: 0,
      discourseLikes: 0, discourseReplies: 0, discourseViews: 0,
    });
    expect(score).toBe(0);
  });

  it("caps downloads and repo enables", () => {
    const score1 = computePopularityScore({
      stars: 0, votes: 0, downloads: 999999, repoEnables: 999999,
      discourseLikes: 0, discourseReplies: 0, discourseViews: 0,
    });
    const score2 = computePopularityScore({
      stars: 0, votes: 0, downloads: 100000, repoEnables: 5000,
      discourseLikes: 0, discourseReplies: 0, discourseViews: 0,
    });
    expect(score1).toBe(score2);
  });
});

describe("computeStalenessMultiplier", () => {
  const now = new Date("2026-02-15T00:00:00Z");

  it("returns 1.0 for null lastBuildAt", () => {
    expect(computeStalenessMultiplier(null, now)).toBe(1.0);
  });

  it("returns 1.0 within grace period (built yesterday)", () => {
    const yesterday = new Date("2026-02-14T00:00:00Z");
    expect(computeStalenessMultiplier(yesterday, now)).toBe(1.0);
  });

  it("returns 1.0 at exactly 7 days", () => {
    const sevenDaysAgo = new Date("2026-02-08T00:00:00Z");
    expect(computeStalenessMultiplier(sevenDaysAgo, now)).toBe(1.0);
  });

  it("applies decay after grace period (30 days)", () => {
    const thirtyDaysAgo = new Date("2026-01-16T00:00:00Z");
    const multiplier = computeStalenessMultiplier(thirtyDaysAgo, now);
    // ~0.42 retained (58% penalty)
    expect(multiplier).toBeGreaterThan(0.35);
    expect(multiplier).toBeLessThan(0.50);
  });

  it("applies heavy decay at 60 days", () => {
    const sixtyDaysAgo = new Date("2025-12-17T00:00:00Z");
    const multiplier = computeStalenessMultiplier(sixtyDaysAgo, now);
    // ~0.13 retained (87% penalty)
    expect(multiplier).toBeGreaterThan(0.08);
    expect(multiplier).toBeLessThan(0.20);
  });

  it("floors at minMultiplier for 90+ days", () => {
    const ninetyDaysAgo = new Date("2025-11-17T00:00:00Z");
    expect(computeStalenessMultiplier(ninetyDaysAgo, now)).toBe(STALENESS.minMultiplier);
  });

  it("floors at minMultiplier for very old builds (1 year)", () => {
    const oneYearAgo = new Date("2025-02-15T00:00:00Z");
    expect(computeStalenessMultiplier(oneYearAgo, now)).toBe(STALENESS.minMultiplier);
  });
});
