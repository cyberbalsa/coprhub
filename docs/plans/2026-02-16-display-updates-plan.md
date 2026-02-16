# Display Updates Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Update frontend to show owner/name format, short numbers (59K), and a CSS tooltip explaining popularity score math.

**Architecture:** Pure frontend changes. New `format.ts` utility with `formatShortNumber` and `buildPopularityTooltip`. CSS-only tooltip using `::after` pseudo-element with `data-tooltip` attribute. No API changes needed.

**Tech Stack:** Next.js 15 (React 19), Vitest, plain CSS

**Design doc:** `docs/plans/2026-02-16-display-updates-design.md`

---

### Task 1: formatShortNumber — tests

**Files:**
- Create: `packages/frontend/src/lib/format.test.ts`

**Step 1: Write the tests**

```ts
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
```

**Step 2: Run test to verify it fails**

Run: `cd /home/balsa/Documents/Projects/copr-index && bun --filter @coprhub/frontend test`

Expected: FAIL — `format.js` does not exist yet.

---

### Task 2: formatShortNumber — implementation

**Files:**
- Create: `packages/frontend/src/lib/format.ts`

**Step 1: Write minimal implementation**

```ts
export function formatShortNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    return k % 1 === 0 ? `${k}K` : `${k.toFixed(1).replace(/\.0$/, "")}K`;
  }
  const m = n / 1_000_000;
  return m % 1 === 0 ? `${m}M` : `${m.toFixed(1).replace(/\.0$/, "")}M`;
}
```

**Step 2: Run test to verify it passes**

Run: `cd /home/balsa/Documents/Projects/copr-index && bun --filter @coprhub/frontend test`

Expected: All `formatShortNumber` tests PASS.

**Step 3: Commit**

```bash
git add packages/frontend/src/lib/format.ts packages/frontend/src/lib/format.test.ts
git commit -m "feat(frontend): add formatShortNumber utility with tests"
```

---

### Task 3: buildPopularityTooltip — tests

**Files:**
- Modify: `packages/frontend/src/lib/format.test.ts`

**Step 1: Add tests to the existing test file**

Append to `format.test.ts`:

```ts
import { buildPopularityTooltip } from "./format.js";
import type { ProjectDetail } from "@coprhub/shared";

describe("buildPopularityTooltip", () => {
  const baseProject: ProjectDetail = {
    id: 1,
    fullName: "testowner/testproject",
    owner: "testowner",
    name: "testproject",
    description: null,
    upstreamUrl: null,
    upstreamProvider: null,
    upstreamStars: 450,
    upstreamLanguage: null,
    popularityScore: 5161,
    coprVotes: 12,
    coprDownloads: 50000,
    instructions: null,
    homepage: null,
    chroots: null,
    repoUrl: null,
    upstreamForks: 0,
    upstreamDescription: null,
    upstreamTopics: null,
    coprRepoEnables: 800,
    discourseLikes: 3,
    discourseViews: 245,
    discourseReplies: 1,
    upstreamReadme: null,
    lastSyncedAt: null,
    lastBuildAt: null,
    createdAt: null,
  };

  it("includes header and dividers", () => {
    const tooltip = buildPopularityTooltip(baseProject);
    expect(tooltip).toContain("Popularity Breakdown");
    expect(tooltip).toContain("───");
  });

  it("shows stars line with weight", () => {
    const tooltip = buildPopularityTooltip(baseProject);
    expect(tooltip).toContain("Stars: 450 × 10");
  });

  it("shows votes line with weight", () => {
    const tooltip = buildPopularityTooltip(baseProject);
    expect(tooltip).toContain("Votes: 12 × 5");
  });

  it("shows downloads with cap note when under cap", () => {
    const tooltip = buildPopularityTooltip(baseProject);
    expect(tooltip).toMatch(/Downloads:.*50,000 × 0\.01 = 500/);
  });

  it("shows capped value when downloads exceed cap", () => {
    const project = { ...baseProject, coprDownloads: 200000 };
    const tooltip = buildPopularityTooltip(project);
    expect(tooltip).toMatch(/Downloads:.*= 1,000 \(capped\)/);
  });

  it("shows staleness ×1.00 when lastBuildAt is null", () => {
    const tooltip = buildPopularityTooltip(baseProject);
    expect(tooltip).toContain("Staleness: ×1.00");
  });

  it("shows base score and final score", () => {
    const tooltip = buildPopularityTooltip(baseProject);
    expect(tooltip).toContain("Base score:");
    expect(tooltip).toContain("Final:");
  });

  it("skips lines with zero values", () => {
    const project = {
      ...baseProject,
      upstreamStars: 0,
      coprVotes: 0,
      coprDownloads: 0,
      coprRepoEnables: 0,
      discourseLikes: 0,
      discourseViews: 0,
      discourseReplies: 0,
      popularityScore: 0,
    };
    const tooltip = buildPopularityTooltip(project);
    expect(tooltip).not.toContain("Stars:");
    expect(tooltip).not.toContain("Votes:");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /home/balsa/Documents/Projects/copr-index && bun --filter @coprhub/frontend test`

Expected: FAIL — `buildPopularityTooltip` not exported from `format.js`.

---

### Task 4: buildPopularityTooltip — implementation

**Files:**
- Modify: `packages/frontend/src/lib/format.ts`

**Step 1: Add constants and implementation to format.ts**

Append to `format.ts`:

```ts
import type { ProjectDetail } from "@coprhub/shared";

const WEIGHTS = {
  stars: 10,
  votes: 5,
  downloads: 0.01,
  downloadsCap: 1000,
  repoEnables: 0.1,
  repoEnablesCap: 500,
  discourseLikes: 3,
  discourseReplies: 1,
  discourseViews: 2,
} as const;

const STALENESS = {
  gracePeriodDays: 7,
  decayRate: 3.0,
  decayWindowDays: 83,
  minMultiplier: 0.05,
} as const;

function computeStalenessMultiplier(lastBuildAt: Date | null, now: Date = new Date()): number {
  if (!lastBuildAt) return 1.0;
  const daysSinceBuild = (now.getTime() - lastBuildAt.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceBuild <= STALENESS.gracePeriodDays) return 1.0;
  const d = daysSinceBuild - STALENESS.gracePeriodDays;
  return Math.max(STALENESS.minMultiplier, Math.exp(-STALENESS.decayRate * d / STALENESS.decayWindowDays));
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

export function buildPopularityTooltip(project: ProjectDetail): string {
  const lines: string[] = ["Popularity Breakdown", "───────────────────"];

  const starsVal = project.upstreamStars * WEIGHTS.stars;
  if (project.upstreamStars > 0)
    lines.push(`Stars: ${fmt(project.upstreamStars)} × ${WEIGHTS.stars} = ${fmt(starsVal)}`);

  const votesVal = project.coprVotes * WEIGHTS.votes;
  if (project.coprVotes > 0)
    lines.push(`Votes: ${fmt(project.coprVotes)} × ${WEIGHTS.votes} = ${fmt(votesVal)}`);

  const dlRaw = project.coprDownloads * WEIGHTS.downloads;
  const dlVal = Math.min(dlRaw, WEIGHTS.downloadsCap);
  if (project.coprDownloads > 0) {
    const capped = dlRaw > WEIGHTS.downloadsCap;
    lines.push(`Downloads: ${fmt(project.coprDownloads)} × ${WEIGHTS.downloads} = ${fmt(Math.round(dlVal))}${capped ? " (capped)" : ""}`);
  }

  const reRaw = project.coprRepoEnables * WEIGHTS.repoEnables;
  const reVal = Math.min(reRaw, WEIGHTS.repoEnablesCap);
  if (project.coprRepoEnables > 0) {
    const capped = reRaw > WEIGHTS.repoEnablesCap;
    lines.push(`Repo enables: ${fmt(project.coprRepoEnables)} × ${WEIGHTS.repoEnables} = ${fmt(Math.round(reVal))}${capped ? " (capped)" : ""}`);
  }

  if (project.discourseLikes > 0)
    lines.push(`Discourse likes: ${fmt(project.discourseLikes)} × ${WEIGHTS.discourseLikes} = ${fmt(project.discourseLikes * WEIGHTS.discourseLikes)}`);

  if (project.discourseReplies > 0)
    lines.push(`Discourse replies: ${fmt(project.discourseReplies)} × ${WEIGHTS.discourseReplies} = ${fmt(project.discourseReplies * WEIGHTS.discourseReplies)}`);

  const dvVal = project.discourseViews > 0 ? Math.round(Math.log(project.discourseViews) * WEIGHTS.discourseViews) : 0;
  if (project.discourseViews > 0)
    lines.push(`Discourse views: ln(${fmt(project.discourseViews)}) × ${WEIGHTS.discourseViews} = ${fmt(dvVal)}`);

  const baseScore = starsVal + votesVal + Math.round(dlVal) + Math.round(reVal)
    + (project.discourseLikes * WEIGHTS.discourseLikes)
    + (project.discourseReplies * WEIGHTS.discourseReplies)
    + dvVal;

  const lastBuild = project.lastBuildAt ? new Date(project.lastBuildAt) : null;
  const multiplier = computeStalenessMultiplier(lastBuild);

  lines.push("───────────────────");
  lines.push(`Base score: ${fmt(baseScore)}`);

  if (!lastBuild) {
    lines.push("Staleness: ×1.00 (no build date)");
  } else {
    const daysAgo = Math.round((Date.now() - lastBuild.getTime()) / (1000 * 60 * 60 * 24));
    lines.push(`Staleness (${daysAgo}d ago): ×${multiplier.toFixed(2)}`);
  }

  lines.push(`Final: ${fmt(Math.floor(baseScore * multiplier))}`);

  return lines.join("\n");
}
```

Note: The `import type { ProjectDetail }` goes at the top of the file.

**Step 2: Run test to verify it passes**

Run: `cd /home/balsa/Documents/Projects/copr-index && bun --filter @coprhub/frontend test`

Expected: All tests PASS.

**Step 3: Commit**

```bash
git add packages/frontend/src/lib/format.ts packages/frontend/src/lib/format.test.ts
git commit -m "feat(frontend): add buildPopularityTooltip with tests"
```

---

### Task 5: CSS tooltip styles

**Files:**
- Modify: `packages/frontend/src/app/globals.css`

**Step 1: Add tooltip CSS and clean up old styles**

Remove the `.card-header .owner` rule (lines 121-124):
```css
/* DELETE THIS BLOCK */
.card-header .owner {
  font-size: 0.85rem;
  color: var(--muted);
}
```

Remove the `.project-header .owner` rule (lines 248-250):
```css
/* DELETE THIS BLOCK */
.project-header .owner {
  color: var(--muted);
}
```

Add tooltip styles (after the `.popularity-badge` or at end of file before `@media`):
```css
/* Tooltip */
.tooltip {
  position: relative;
  cursor: help;
}

.tooltip::after {
  content: attr(data-tooltip);
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.5rem 0.75rem;
  font-size: 0.75rem;
  white-space: pre;
  color: var(--fg);
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s;
  z-index: 10;
  line-height: 1.5;
}

.tooltip:hover::after {
  opacity: 1;
}
```

**Step 2: Commit**

```bash
git add packages/frontend/src/app/globals.css
git commit -m "feat(frontend): add CSS tooltip styles, remove old owner styles"
```

---

### Task 6: Update ProjectCard component

**Files:**
- Modify: `packages/frontend/src/components/ProjectCard.tsx`

**Step 1: Rewrite ProjectCard**

Replace the entire contents of `ProjectCard.tsx` with:

```tsx
import type { ProjectSummary } from "@coprhub/shared";
import { formatShortNumber } from "@/lib/format";

export function ProjectCard({ project }: { project: ProjectSummary }) {
  return (
    <a href={`/projects/${project.owner}/${project.name}`} className="card">
      <div className="card-header">
        <h3>{project.owner}/{project.name}</h3>
      </div>
      <p className="description">
        {project.description?.slice(0, 120) || "No description"}
        {(project.description?.length ?? 0) > 120 ? "..." : ""}
      </p>
      <div className="card-footer">
        {project.upstreamStars > 0 && (
          <span className="stars">
            {project.upstreamProvider === "github" ? "GitHub" : "GitLab"}{" "}
            &#9733; {formatShortNumber(project.upstreamStars)}
          </span>
        )}
        {project.popularityScore > 0 && (
          <span
            className="popularity tooltip"
            data-tooltip={"Popularity score based on\nstars, votes, downloads,\nand community activity"}
          >
            &#x1f525; {formatShortNumber(project.popularityScore)}
          </span>
        )}
        {project.coprVotes > 0 && (
          <span className="votes">&#128077; {formatShortNumber(project.coprVotes)}</span>
        )}
        {project.upstreamLanguage && (
          <span className="language">{project.upstreamLanguage}</span>
        )}
      </div>
    </a>
  );
}
```

**Step 2: Verify build compiles**

Run: `cd /home/balsa/Documents/Projects/copr-index && bun --filter @coprhub/frontend run build`

Expected: Build succeeds.

**Step 3: Commit**

```bash
git add packages/frontend/src/components/ProjectCard.tsx
git commit -m "feat(frontend): update ProjectCard with owner/name, short numbers, tooltip"
```

---

### Task 7: Update project detail page

**Files:**
- Modify: `packages/frontend/src/app/projects/[owner]/[name]/page.tsx`

**Step 1: Update the detail page**

Add import at top (after the existing imports):
```ts
import { formatShortNumber, buildPopularityTooltip } from "@/lib/format";
```

Replace the `project-header` div (lines 46-70) with:
```tsx
      <div className="project-header">
        <h1>{project.owner}/{project.name}</h1>
        {project.upstreamStars > 0 && (
          <span className="stars-badge">
            &#9733; {formatShortNumber(project.upstreamStars)}
          </span>
        )}
        {project.coprVotes > 0 && (
          <a
            href={`https://copr.fedorainfracloud.org/coprs/${owner}/${name}/`}
            target="_blank"
            rel="noopener"
            className="votes-badge"
            title="Vote on COPR"
          >
            &#128077; {formatShortNumber(project.coprVotes)}
          </a>
        )}
        {project.popularityScore > 0 && (
          <span
            className="popularity-badge tooltip"
            data-tooltip={buildPopularityTooltip(project)}
          >
            &#x1f525; {formatShortNumber(project.popularityScore)}
          </span>
        )}
      </div>
```

**Step 2: Verify build compiles**

Run: `cd /home/balsa/Documents/Projects/copr-index && bun --filter @coprhub/frontend run build`

Expected: Build succeeds.

**Step 3: Commit**

```bash
git add packages/frontend/src/app/projects/[owner]/[name]/page.tsx
git commit -m "feat(frontend): update detail page with owner/name, short numbers, tooltip"
```

---

### Task 8: Run full test suite

**Step 1: Run all tests**

Run: `cd /home/balsa/Documents/Projects/copr-index && bun run test`

Expected: All tests pass across all packages.

**Step 2: Final commit (if any fixups needed)**

If any test fixes were needed, commit them. Otherwise, no action.
