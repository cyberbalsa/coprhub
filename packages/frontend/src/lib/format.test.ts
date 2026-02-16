import { describe, it, expect } from "vitest";
import { formatShortNumber, buildPopularityTooltip } from "./format.js";
import type { ProjectDetail } from "@coprhub/shared";

describe("formatShortNumber", () => {
  it("returns small numbers as-is", () => {
    expect(formatShortNumber(0)).toBe("0");
    expect(formatShortNumber(1)).toBe("1");
    expect(formatShortNumber(999)).toBe("999");
  });

  it("formats thousands with K suffix", () => {
    expect(formatShortNumber(1000)).toBe("1K");
    expect(formatShortNumber(1200)).toBe("1.2K");
    expect(formatShortNumber(59000)).toBe("59K");
    expect(formatShortNumber(59400)).toBe("59.4K");
    expect(formatShortNumber(999900)).toBe("999.9K");
  });

  it("drops .0 decimal for even thousands", () => {
    expect(formatShortNumber(5000)).toBe("5K");
    expect(formatShortNumber(100000)).toBe("100K");
  });

  it("formats millions with M suffix", () => {
    expect(formatShortNumber(1000000)).toBe("1M");
    expect(formatShortNumber(1200000)).toBe("1.2M");
    expect(formatShortNumber(25000000)).toBe("25M");
  });

  it("drops .0 decimal for even millions", () => {
    expect(formatShortNumber(2000000)).toBe("2M");
  });
});

describe("buildPopularityTooltip", () => {
  const baseProject: ProjectDetail = {
    id: 1,
    fullName: "testowner/testproject",
    owner: "testowner",
    name: "testproject",
    description: null,
    upstreamUrl: null,
    upstreamProvider: null,
    upstreamStars: 450,
    upstreamLanguage: null,
    popularityScore: 5161,
    coprVotes: 12,
    coprDownloads: 50000,
    instructions: null,
    homepage: null,
    chroots: null,
    repoUrl: null,
    upstreamForks: 0,
    upstreamDescription: null,
    upstreamTopics: null,
    coprRepoEnables: 800,
    discourseLikes: 3,
    discourseViews: 245,
    discourseReplies: 1,
    upstreamReadme: null,
    lastSyncedAt: null,
    lastBuildAt: null,
    createdAt: null,
  };

  it("includes header and dividers", () => {
    const tooltip = buildPopularityTooltip(baseProject);
    expect(tooltip).toContain("Popularity Breakdown");
    expect(tooltip).toContain("───");
  });

  it("shows stars line with weight", () => {
    const tooltip = buildPopularityTooltip(baseProject);
    expect(tooltip).toContain("Stars: 450 × 10");
  });

  it("shows votes line with weight", () => {
    const tooltip = buildPopularityTooltip(baseProject);
    expect(tooltip).toContain("Votes: 12 × 5");
  });

  it("shows downloads with cap note when under cap", () => {
    const tooltip = buildPopularityTooltip(baseProject);
    expect(tooltip).toMatch(/Downloads:.*50,000 × 0\.01 = 500/);
  });

  it("shows capped value when downloads exceed cap", () => {
    const project = { ...baseProject, coprDownloads: 200000 };
    const tooltip = buildPopularityTooltip(project);
    expect(tooltip).toMatch(/Downloads:.*= 1,000 \(capped\)/);
  });

  it("shows staleness ×1.00 when lastBuildAt is null", () => {
    const tooltip = buildPopularityTooltip(baseProject);
    expect(tooltip).toContain("Staleness: ×1.00");
  });

  it("shows base score and final score", () => {
    const tooltip = buildPopularityTooltip(baseProject);
    expect(tooltip).toContain("Base score:");
    expect(tooltip).toContain("Final:");
  });

  it("skips lines with zero values", () => {
    const project = {
      ...baseProject,
      upstreamStars: 0,
      coprVotes: 0,
      coprDownloads: 0,
      coprRepoEnables: 0,
      discourseLikes: 0,
      discourseViews: 0,
      discourseReplies: 0,
      popularityScore: 0,
    };
    const tooltip = buildPopularityTooltip(project);
    expect(tooltip).not.toContain("Stars:");
    expect(tooltip).not.toContain("Votes:");
  });
});
