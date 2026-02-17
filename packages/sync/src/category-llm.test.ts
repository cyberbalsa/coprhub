import { describe, expect, it } from "vitest";

import { buildClassificationPrompt, VALID_SLUGS } from "./category-llm.js";

describe("buildClassificationPrompt", () => {
  it("builds a prompt with all fields", () => {
    const prompt = buildClassificationPrompt({
      name: "dev/my-tool",
      description: "A tool for doing things",
      upstreamLanguage: "Rust",
      upstreamTopics: ["cli", "fast"],
      homepage: "https://example.com",
    });
    expect(prompt).toContain("dev/my-tool");
    expect(prompt).toContain("A tool for doing things");
    expect(prompt).toContain("Rust");
    expect(prompt).toContain("cli, fast");
    expect(prompt).toContain("https://example.com");
  });

  it("handles null fields gracefully", () => {
    const prompt = buildClassificationPrompt({
      name: "owner/pkg",
      description: null,
      upstreamLanguage: null,
      upstreamTopics: null,
      homepage: null,
    });
    expect(prompt).toContain("owner/pkg");
    expect(prompt).not.toContain("undefined");
  });
});

describe("VALID_SLUGS", () => {
  it("contains all 13 category slugs", () => {
    expect(VALID_SLUGS).toHaveLength(13);
    expect(VALID_SLUGS).toContain("games");
    expect(VALID_SLUGS).toContain("developer-tools");
    expect(VALID_SLUGS).toContain("command-line");
  });
});
