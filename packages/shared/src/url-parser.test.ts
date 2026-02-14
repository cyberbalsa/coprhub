import { describe, it, expect } from "vitest";
import { parseUpstreamUrl, extractUpstreamFromTexts } from "./url-parser.js";

describe("parseUpstreamUrl", () => {
  it("parses a GitHub repo URL", () => {
    const result = parseUpstreamUrl("https://github.com/neovim/neovim");
    expect(result).toEqual({
      provider: "github",
      owner: "neovim",
      repo: "neovim",
      url: "https://github.com/neovim/neovim",
    });
  });

  it("parses a GitHub URL with .git suffix", () => {
    const result = parseUpstreamUrl("https://github.com/user/repo.git");
    expect(result).toEqual({
      provider: "github",
      owner: "user",
      repo: "repo",
      url: "https://github.com/user/repo",
    });
  });

  it("parses a GitHub URL with trailing path segments", () => {
    const result = parseUpstreamUrl("https://github.com/user/repo/tree/main/subdir");
    expect(result).toEqual({
      provider: "github",
      owner: "user",
      repo: "repo",
      url: "https://github.com/user/repo",
    });
  });

  it("parses a gitlab.com URL", () => {
    const result = parseUpstreamUrl("https://gitlab.com/fdroid/fdroidclient");
    expect(result).toEqual({
      provider: "gitlab",
      owner: "fdroid",
      repo: "fdroidclient",
      url: "https://gitlab.com/fdroid/fdroidclient",
    });
  });

  it("parses a self-hosted GitLab URL", () => {
    const result = parseUpstreamUrl("https://gitlab.gnome.org/GNOME/gnome-shell");
    expect(result).toEqual({
      provider: "gitlab",
      owner: "GNOME",
      repo: "gnome-shell",
      url: "https://gitlab.gnome.org/GNOME/gnome-shell",
    });
  });

  it("returns null for non-forge URLs", () => {
    expect(parseUpstreamUrl("https://example.com/project")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(parseUpstreamUrl("")).toBeNull();
  });
});

describe("extractUpstreamFromTexts", () => {
  it("finds GitHub URL in homepage field", () => {
    const result = extractUpstreamFromTexts({
      homepage: "https://github.com/user/repo",
    });
    expect(result?.provider).toBe("github");
  });

  it("finds URL in description text", () => {
    const result = extractUpstreamFromTexts({
      description: "A cool tool. See https://github.com/user/repo for more info.",
    });
    expect(result?.provider).toBe("github");
    expect(result?.owner).toBe("user");
  });

  it("prefers homepage over description", () => {
    const result = extractUpstreamFromTexts({
      homepage: "https://github.com/correct/repo",
      description: "See https://github.com/wrong/repo",
    });
    expect(result?.owner).toBe("correct");
  });

  it("finds URL in clone_url field", () => {
    const result = extractUpstreamFromTexts({
      cloneUrl: "https://github.com/user/repo.git",
    });
    expect(result?.repo).toBe("repo");
  });
});
