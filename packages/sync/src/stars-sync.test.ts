import { describe, it, expect, vi } from "vitest";
import { fetchGitHubStars, fetchGitLabStars } from "./stars-sync.js";

describe("fetchGitHubStars", () => {
  it("extracts stargazers_count from GitHub API response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "x-ratelimit-remaining": "4999" }),
      json: () =>
        Promise.resolve({
          stargazers_count: 42000,
          forks_count: 3000,
          language: "Go",
          description: "A terminal UI for git",
          topics: ["git", "terminal", "tui"],
        }),
    });

    const result = await fetchGitHubStars("jesseduffield", "lazygit");
    expect(result?.stars).toBe(42000);
    expect(result?.forks).toBe(3000);
    expect(result?.language).toBe("Go");
  });

  it("returns null for 404", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: new Headers(),
    });

    const result = await fetchGitHubStars("nonexistent", "repo");
    expect(result).toBeNull();
  });
});

describe("fetchGitLabStars", () => {
  it("extracts star_count from GitLab API response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () =>
        Promise.resolve({
          star_count: 2100,
          forks_count: 450,
          topics: ["android"],
          description: "F-Droid client",
        }),
    });

    const result = await fetchGitLabStars("gitlab.com", "fdroid/fdroidclient");
    expect(result?.stars).toBe(2100);
    expect(result?.forks).toBe(450);
  });
});
