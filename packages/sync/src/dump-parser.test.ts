import { describe, it, expect } from "vitest";
import { parseCoprScoreLines, parseCounterStatLines } from "./dump-parser.js";

describe("parseCoprScoreLines", () => {
  it("aggregates scores by copr_id", () => {
    const lines = [
      "1\t5893\t25\t1",
      "2\t5893\t100\t1",
      "3\t5893\t200\t-1",
      "4\t1234\t25\t1",
    ];
    const result = parseCoprScoreLines(lines);
    expect(result.get(5893)).toBe(1);
    expect(result.get(1234)).toBe(1);
    expect(result.size).toBe(2);
  });

  it("returns empty map for no lines", () => {
    expect(parseCoprScoreLines([]).size).toBe(0);
  });
});

describe("parseCounterStatLines", () => {
  it("aggregates project_rpms_dl by owner/name", () => {
    const lines = [
      "project_rpms_dl_stat:hset::atim@lazygit\tproject_rpms_dl\t500",
      "project_rpms_dl_stat:hset::atim@lazygit\tproject_rpms_dl\t200",
      "repo_dl_stat::atim@lazygit:fedora-40\trepo_dl\t100",
      "repo_dl_stat::atim@lazygit:fedora-39\trepo_dl\t50",
      "chroot_rpms_dl\tchroot_rpms_dl\t999",
    ];
    const result = parseCounterStatLines(lines);
    expect(result.get("atim/lazygit")).toEqual({
      downloads: 700,
      repoEnables: 150,
    });
  });

  it("handles group projects with @ prefix", () => {
    const lines = [
      "project_rpms_dl_stat:hset::@fedora-llvm-team@llvm-snapshots\tproject_rpms_dl\t42",
    ];
    const result = parseCounterStatLines(lines);
    expect(result.get("@fedora-llvm-team/llvm-snapshots")).toEqual({
      downloads: 42,
      repoEnables: 0,
    });
  });
});
