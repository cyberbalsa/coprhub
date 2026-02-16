import { describe, it, expect } from "vitest";
import { shouldSkipSync } from "./ttl.js";

describe("shouldSkipSync", () => {
  it("returns false when lastSyncedAt is null", () => {
    expect(shouldSkipSync(null, 12)).toBe(false);
  });

  it("returns false when lastSyncedAt is older than TTL", () => {
    const thirteenHoursAgo = new Date(Date.now() - 13 * 60 * 60 * 1000);
    expect(shouldSkipSync(thirteenHoursAgo, 12)).toBe(false);
  });

  it("returns true when lastSyncedAt is within TTL", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    expect(shouldSkipSync(twoHoursAgo, 12)).toBe(true);
  });

  it("returns false when forceSync is true even if within TTL", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    expect(shouldSkipSync(twoHoursAgo, 12, true)).toBe(false);
  });

  it("returns true at exactly the TTL boundary", () => {
    const exactlyTwelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
    expect(shouldSkipSync(exactlyTwelveHoursAgo, 12)).toBe(true);
  });
});
