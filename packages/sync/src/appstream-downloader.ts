import { existsSync, mkdirSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { USER_AGENT } from "./user-agent.js";
import { parseAppStreamXml, parseAppStreamYaml, type AppStreamEntry } from "./appstream-parser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, "../../../../data/appstream");
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface AppStreamSource {
  name: string;
  url: string;
  format: "xml" | "yaml";
  /** If true, URL is a repomd.xml that must be parsed to find the actual data URL */
  repomd?: boolean;
}

const SOURCES: AppStreamSource[] = [
  {
    name: "flathub",
    url: "https://dl.flathub.org/repo/appstream/x86_64/appstream.xml.gz",
    format: "xml",
  },
  {
    name: "opensuse",
    url: "https://download.opensuse.org/tumbleweed/repo/oss/repodata/repomd.xml",
    format: "xml",
    repomd: true,
  },
  {
    name: "debian",
    url: "https://deb.debian.org/debian/dists/sid/main/dep11/Components-amd64.yml.gz",
    format: "yaml",
  },
  {
    name: "ubuntu",
    url: "https://archive.ubuntu.com/ubuntu/dists/noble/universe/dep11/Components-amd64.yml.gz",
    format: "yaml",
  },
];

// Note: Fedora AppStream is in an RPM on Koji.
// For simplicity in v1, we skip Fedora and rely on the other 4 sources.
// Fedora can be added later by downloading the appstream-data RPM and extracting it.

function isCacheValid(filepath: string): boolean {
  if (!existsSync(filepath)) return false;
  const age = Date.now() - statSync(filepath).mtimeMs;
  return age < MAX_AGE_MS;
}

async function fetchGzipped(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const compressed = Buffer.from(await res.arrayBuffer());
  return Buffer.from(gunzipSync(compressed));
}

async function resolveRepomdUrl(repomdUrl: string): Promise<string> {
  const res = await fetch(repomdUrl, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Failed to fetch repomd: ${res.status}`);
  const xml = await res.text();
  // Find the appdata entry: <data type="appdata"><location href="repodata/xxx-appdata.xml.gz"/>
  const match = xml.match(/<data type="appdata">[\s\S]*?<location href="([^"]+)"/);
  if (!match) throw new Error("No appdata entry found in repomd.xml");
  const base = repomdUrl.replace(/repodata\/repomd\.xml$/, "");
  return base + match[1];
}

export async function downloadAllAppStreamIndices(): Promise<Map<string, string[]>> {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });

  const packageMap = new Map<string, string[]>(); // packageName → categories[]

  for (const source of SOURCES) {
    const cacheFile = join(CACHE_DIR, `${source.name}.json`);
    let entries: AppStreamEntry[];

    if (isCacheValid(cacheFile)) {
      console.log(`  ${source.name}: using cached data`);
      entries = JSON.parse(await readFile(cacheFile, "utf-8"));
    } else {
      console.log(`  ${source.name}: downloading...`);
      try {
        let url = source.url;
        if (source.repomd) {
          url = await resolveRepomdUrl(source.url);
        }

        const data = await fetchGzipped(url);
        const content = data.toString("utf-8");

        if (source.format === "xml") {
          entries = await parseAppStreamXml(content);
        } else {
          entries = parseAppStreamYaml(content);
        }

        // Cache parsed entries as JSON
        await writeFile(cacheFile, JSON.stringify(entries));
        console.log(`  ${source.name}: ${entries.length} entries cached`);
      } catch (err) {
        console.warn(`  ${source.name}: FAILED - ${err}`);
        // Try to use stale cache
        if (existsSync(cacheFile)) {
          entries = JSON.parse(await readFile(cacheFile, "utf-8"));
          console.log(`  ${source.name}: using stale cache (${entries.length} entries)`);
        } else {
          continue;
        }
      }
    }

    // Merge into package map (first source wins)
    for (const entry of entries) {
      if (!packageMap.has(entry.packageName)) {
        packageMap.set(entry.packageName, entry.categories);
      }
    }
  }

  console.log(`  Total unique packages in AppStream index: ${packageMap.size}`);
  return packageMap;
}
