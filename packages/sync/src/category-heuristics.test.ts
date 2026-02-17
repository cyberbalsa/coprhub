import { describe, it, expect } from "vitest";
import { classifyByHeuristics, type ProjectMetadata } from "./category-heuristics.js";

describe("classifyByHeuristics", () => {
  it("classifies game projects by topics", () => {
    const meta: ProjectMetadata = {
      name: "cool-game", owner: "dev", description: "A fun game",
      upstreamTopics: ["game", "godot"], upstreamLanguage: "GDScript", homepage: null,
    };
    expect(classifyByHeuristics(meta)).toBe("games");
  });

  it("classifies CLI tools by topics", () => {
    const meta: ProjectMetadata = {
      name: "my-tool", owner: "dev", description: "A CLI tool",
      upstreamTopics: ["cli", "terminal"], upstreamLanguage: "Go", homepage: null,
    };
    expect(classifyByHeuristics(meta)).toBe("command-line");
  });

  it("classifies libraries by topics", () => {
    const meta: ProjectMetadata = {
      name: "libfoo", owner: "dev", description: "A shared library",
      upstreamTopics: ["library"], upstreamLanguage: "C", homepage: null,
    };
    expect(classifyByHeuristics(meta)).toBe("libraries");
  });

  it("classifies font packages by name", () => {
    const meta: ProjectMetadata = {
      name: "awesome-font", owner: "dev", description: "A nice font",
      upstreamTopics: [], upstreamLanguage: null, homepage: null,
    };
    expect(classifyByHeuristics(meta)).toBe("fonts-themes");
  });

  it("classifies by description keywords when topics don't match", () => {
    const meta: ProjectMetadata = {
      name: "browser-x", owner: "dev", description: "A web browser for Linux",
      upstreamTopics: [], upstreamLanguage: "Rust", homepage: null,
    };
    expect(classifyByHeuristics(meta)).toBe("networking");
  });

  it("returns null when no heuristic matches", () => {
    const meta: ProjectMetadata = {
      name: "something", owner: "dev", description: "Does stuff",
      upstreamTopics: [], upstreamLanguage: "Python", homepage: null,
    };
    expect(classifyByHeuristics(meta)).toBeNull();
  });

  it("classifies icon/theme packages", () => {
    const meta: ProjectMetadata = {
      name: "papirus-icon-theme", owner: "dev", description: "Icon theme for Linux",
      upstreamTopics: ["icon-theme", "linux"], upstreamLanguage: null, homepage: null,
    };
    expect(classifyByHeuristics(meta)).toBe("fonts-themes");
  });
});
