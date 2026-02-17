import { describe, it, expect } from "vitest";
import { mapFreeDesktopCategories, CATEGORIES } from "./category-mapping.js";

describe("CATEGORIES", () => {
  it("has 13 categories", () => {
    expect(CATEGORIES).toHaveLength(13);
  });

  it("all have slug and name", () => {
    for (const cat of CATEGORIES) {
      expect(cat.slug).toBeTruthy();
      expect(cat.name).toBeTruthy();
    }
  });
});

describe("mapFreeDesktopCategories", () => {
  it("maps Game to games", () => {
    expect(mapFreeDesktopCategories(["Game"])).toBe("games");
  });

  it("maps ArcadeGame to games (sub-category)", () => {
    expect(mapFreeDesktopCategories(["ArcadeGame"])).toBe("games");
  });

  it("maps Development to developer-tools", () => {
    expect(mapFreeDesktopCategories(["Development"])).toBe("developer-tools");
  });

  it("maps RevisionControl to developer-tools", () => {
    expect(mapFreeDesktopCategories(["RevisionControl"])).toBe("developer-tools");
  });

  it("maps AudioVideo to audio-video", () => {
    expect(mapFreeDesktopCategories(["AudioVideo"])).toBe("audio-video");
  });

  it("prefers more specific category when multiple match", () => {
    expect(mapFreeDesktopCategories(["Game", "ArcadeGame"])).toBe("games");
  });

  it("returns null for unknown categories", () => {
    expect(mapFreeDesktopCategories(["X-GNOME-Utilities"])).toBeNull();
  });

  it("returns null for empty array", () => {
    expect(mapFreeDesktopCategories([])).toBeNull();
  });

  it("maps Network;WebBrowser to networking", () => {
    expect(mapFreeDesktopCategories(["Network", "WebBrowser"])).toBe("networking");
  });

  it("maps Utility;TextEditor to utilities", () => {
    expect(mapFreeDesktopCategories(["Utility", "TextEditor"])).toBe("utilities");
  });
});
