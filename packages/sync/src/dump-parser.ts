export interface DownloadStats {
  downloads: number;
  repoEnables: number;
}

/**
 * Parses tab-separated copr_score COPY lines.
 * Format per line: id\tcopr_id\tuser_id\tscore
 * Returns Map of copr_id -> net score (sum of all scores for that copr_id).
 */
export function parseCoprScoreLines(lines: string[]): Map<number, number> {
  const scores = new Map<number, number>();

  for (const line of lines) {
    const parts = line.split("\t");
    if (parts.length < 4) continue;

    const coprId = parseInt(parts[1], 10);
    const score = parseInt(parts[3], 10);
    if (isNaN(coprId) || isNaN(score)) continue;

    scores.set(coprId, (scores.get(coprId) ?? 0) + score);
  }

  return scores;
}

/**
 * Converts "owner@name" to "owner/name".
 * Handles group projects: "@group@name" -> "@group/name".
 */
function parseOwnerAtName(raw: string): string {
  // Group projects start with @, e.g. "@fedora-llvm-team@llvm-snapshots"
  if (raw.startsWith("@")) {
    const atIdx = raw.indexOf("@", 1);
    if (atIdx === -1) return raw;
    return raw.substring(0, atIdx) + "/" + raw.substring(atIdx + 1);
  }

  // Regular projects: "owner@name" -> "owner/name"
  const atIdx = raw.indexOf("@");
  if (atIdx === -1) return raw;
  return raw.substring(0, atIdx) + "/" + raw.substring(atIdx + 1);
}

/**
 * Parses tab-separated counter_stat COPY lines.
 * Extracts two stat types:
 *   - project_rpms_dl: name format "project_rpms_dl_stat:hset::{owner}@{name}", aggregates counter as downloads
 *   - repo_dl: name format "repo_dl_stat::{owner}@{name}:{chroot}", aggregates counter as repoEnables
 * Returns Map of "owner/name" -> { downloads, repoEnables }.
 */
export function parseCounterStatLines(
  lines: string[]
): Map<string, DownloadStats> {
  const stats = new Map<string, DownloadStats>();

  for (const line of lines) {
    const parts = line.split("\t");
    if (parts.length < 3) continue;

    const [name, type, counterStr] = parts;
    const counter = parseInt(counterStr, 10);
    if (isNaN(counter)) continue;

    if (type === "project_rpms_dl") {
      // name format: "project_rpms_dl_stat:hset::{owner}@{name}"
      const prefix = "project_rpms_dl_stat:hset::";
      if (!name.startsWith(prefix)) continue;

      const ownerAtName = name.substring(prefix.length);
      const key = parseOwnerAtName(ownerAtName);

      const existing = stats.get(key) ?? { downloads: 0, repoEnables: 0 };
      existing.downloads += counter;
      stats.set(key, existing);
    } else if (type === "repo_dl") {
      // name format: "repo_dl_stat::{owner}@{name}:{chroot}"
      const prefix = "repo_dl_stat::";
      if (!name.startsWith(prefix)) continue;

      const rest = name.substring(prefix.length);
      // Find the last colon to separate owner@name from chroot
      const lastColon = rest.lastIndexOf(":");
      const ownerAtName = lastColon === -1 ? rest : rest.substring(0, lastColon);
      const key = parseOwnerAtName(ownerAtName);

      const existing = stats.get(key) ?? { downloads: 0, repoEnables: 0 };
      existing.repoEnables += counter;
      stats.set(key, existing);
    }
    // Other types (e.g. "chroot_rpms_dl") are ignored
  }

  return stats;
}
