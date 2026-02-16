import { describe, it, expect } from "vitest";
import { extractCopySections } from "./dump-stream.js";

describe("extractCopySections", () => {
  it("extracts COPY sections from dump text", () => {
    const dumpContent = [
      "-- some header",
      "COPY public.copr_score (id, copr_id, user_id, score) FROM stdin;",
      "1\t100\t25\t1",
      "2\t200\t30\t-1",
      "\\.",
      "-- other stuff",
      "COPY public.counter_stat (name, counter_type, counter) FROM stdin;",
      "repo_dl_stat::a@b:f40\trepo_dl\t5",
      "\\.",
      "COPY public.build (id) FROM stdin;",
      "999",
      "\\.",
    ].join("\n");

    const result = extractCopySections(dumpContent, [
      "public.copr_score",
      "public.counter_stat",
    ]);

    expect(result["public.copr_score"]).toEqual([
      "1\t100\t25\t1",
      "2\t200\t30\t-1",
    ]);
    expect(result["public.counter_stat"]).toEqual([
      "repo_dl_stat::a@b:f40\trepo_dl\t5",
    ]);
  });

  it("returns empty arrays for tables not found in dump", () => {
    const result = extractCopySections("-- empty dump", ["public.copr_score"]);
    expect(result["public.copr_score"]).toEqual([]);
  });
});
