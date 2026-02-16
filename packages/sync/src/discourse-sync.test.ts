import { describe, it, expect, vi } from "vitest";
import { fetchDiscourseTopicByEmbedUrl, fetchDiscourseTopicStats } from "./discourse-sync.js";

describe("fetchDiscourseTopicByEmbedUrl", () => {
  it("returns topic data from search results", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        topics: [
          { id: 45706, slug: "solopasha-hyprland", like_count: 29, views: 7268, posts_count: 141, reply_count: 82 },
        ],
      }),
    });

    const result = await fetchDiscourseTopicByEmbedUrl("solopasha", "hyprland");
    expect(result).toEqual({
      topicId: 45706,
      slug: "solopasha-hyprland",
      likes: 29,
      views: 7268,
      replies: 82,
    });
  });

  it("returns null when no topics found", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ topics: [] }),
    });

    const result = await fetchDiscourseTopicByEmbedUrl("nobody", "nothing");
    expect(result).toBeNull();
  });
});

describe("fetchDiscourseTopicStats", () => {
  it("fetches stats for a known topic ID", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        id: 45706,
        like_count: 29,
        views: 7268,
        posts_count: 141,
        reply_count: 82,
      }),
    });

    const result = await fetchDiscourseTopicStats(45706);
    expect(result).toEqual({ likes: 29, views: 7268, replies: 82 });
  });

  it("returns null on 404", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    const result = await fetchDiscourseTopicStats(99999);
    expect(result).toBeNull();
  });
});
