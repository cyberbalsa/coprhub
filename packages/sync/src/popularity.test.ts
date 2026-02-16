import { describe, it, expect } from "vitest";
import { computePopularityScore, WEIGHTS } from "./popularity.js";

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
