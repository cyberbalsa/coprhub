# Display Updates Design

## Summary

Three frontend display improvements:
1. Show `owner/name` format instead of separate name + owner
2. Use short numbers (e.g. `59K`) for large values
3. Add CSS tooltip on fire icon showing popularity score breakdown

## 1. Owner/Name Display Format

### Cards (`ProjectCard.tsx`)
- Replace two-line header (name + owner) with single `<h3>owner/name</h3>`
- Remove separate `<span className="owner">` element

### Detail page (`projects/[owner]/[name]/page.tsx`)
- Replace `<h1>{name}</h1> <span>by {owner}</span>` with `<h1>owner/name</h1>`
- Remove separate owner span

### CSS
- Remove `.card-header .owner` styles (no longer needed)
- Update `.project-header .owner` or remove it

## 2. Short Number Formatting

### Utility: `packages/frontend/src/lib/format.ts`

`formatShortNumber(n: number): string`:
- `< 1,000` — show as-is (`842`)
- `1,000–999,999` — `{n/1000}K` with 1 decimal, drop `.0` (`1.2K`, `59K`)
- `1,000,000+` — `{n/1000000}M` with 1 decimal, drop `.0` (`1.2M`)

### Apply to
- Stars (card + detail)
- Popularity score (card + detail)
- Votes (card + detail)
- Downloads (detail)

## 3. Popularity Score Tooltip

### Two tiers

**Card (simple):** Static text via `data-tooltip` attribute:
```
Popularity score based on
stars, votes, downloads,
and community activity
```

**Detail page (full breakdown):** Computed text showing actual values:
```
Popularity Breakdown
─────────────────────
Stars: 450 × 10 = 4,500
Votes: 12 × 5 = 60
Downloads: 50,000 × 0.01 = 500 (cap 1,000)
Repo enables: 800 × 0.1 = 80 (cap 500)
Discourse likes: 3 × 3 = 9
Discourse replies: 1 × 1 = 1
Discourse views: ln(245) × 2 = 11
─────────────────────
Base score: 5,161
Staleness (3d ago): ×1.00
Final: 5,161
```

### Implementation

**Data:** `ProjectDetail` already has all needed fields — no API changes.

**Constants:** Duplicate `WEIGHTS` and `STALENESS` constants from `packages/sync/src/popularity.ts` into `packages/frontend/src/lib/format.ts`. These are stable numbers that rarely change.

**Helper:** `buildPopularityTooltip(project: ProjectDetail): string` computes each line.

**CSS tooltip:**
- `.tooltip` class with `position: relative`
- `::after` pseudo-element: `content: attr(data-tooltip)`, positioned above
- `white-space: pre`, dark background (`var(--card-bg)`), border (`var(--border)`)
- Show on `:hover` with fade-in transition
- `pointer-events: none` on the pseudo-element

## Files to modify

1. `packages/frontend/src/lib/format.ts` — new file: `formatShortNumber`, popularity constants, `buildPopularityTooltip`
2. `packages/frontend/src/components/ProjectCard.tsx` — owner/name format, short numbers, simple tooltip
3. `packages/frontend/src/app/projects/[owner]/[name]/page.tsx` — owner/name format, short numbers, full breakdown tooltip
4. `packages/frontend/src/app/globals.css` — tooltip styles, remove old `.card-header .owner`
