import { describe, it, expect } from "vitest";
import { buildTextFilter } from "./filters.js";
import { projects } from "@coprhub/shared";

describe("buildTextFilter", () => {
  it("returns eq condition for exact match (no wildcard)", () => {
    const result = buildTextFilter(projects.owner, "atim");
    expect(result).toBeDefined();
  });

  it("returns ilike condition when value contains *", () => {
    const result = buildTextFilter(projects.owner, "@group*");
    expect(result).toBeDefined();
  });

  it("converts * to % for ILIKE", () => {
    const result = buildTextFilter(projects.owner, "*neovim*");
    expect(result).toBeDefined();
  });

  it("returns undefined for empty/undefined value", () => {
    expect(buildTextFilter(projects.owner, undefined)).toBeUndefined();
    expect(buildTextFilter(projects.owner, "")).toBeUndefined();
  });
});
