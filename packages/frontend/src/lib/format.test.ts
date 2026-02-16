import { describe, it, expect } from "vitest";
import { formatShortNumber } from "./format.js";

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
