import { parseStringPromise } from "xml2js";
import yaml from "js-yaml";

export interface AppStreamEntry {
  packageName: string;
  categories: string[];
}

/**
 * Parse AppStream XML (used by Fedora, openSUSE, Flathub).
 * Extracts desktop/desktop-application components with pkgname and categories.
 * For Flathub (Flatpak), falls back to the last segment of the component ID
 * when pkgname is absent (e.g., "org.mozilla.firefox" → "firefox").
 */
export async function parseAppStreamXml(xmlContent: string): Promise<AppStreamEntry[]> {
  const parsed = await parseStringPromise(xmlContent, { explicitArray: true });
  const components = parsed?.components?.component ?? [];
  const entries: AppStreamEntry[] = [];

  for (const comp of components) {
    const type = comp.$?.type;
    if (type !== "desktop" && type !== "desktop-application") continue;

    const categories = comp.categories?.[0]?.category ?? [];
    if (categories.length === 0) continue;

    // Prefer pkgname (distro packages), fall back to last segment of component ID (Flatpak)
    let pkgname = comp.pkgname?.[0];
    if (!pkgname) {
      const id = comp.id?.[0];
      if (typeof id === "string") {
        // "org.mozilla.firefox.desktop" → "firefox"
        const cleaned = id.replace(/\.desktop$/, "");
        const parts = cleaned.split(".");
        pkgname = parts[parts.length - 1];
      }
    }
    if (!pkgname) continue;

    entries.push({ packageName: pkgname, categories });
  }

  return entries;
}

/**
 * Parse AppStream DEP-11 YAML (used by Debian, Ubuntu).
 * Multi-document YAML with --- separators.
 * Uses json mode to tolerate duplicate keys in translation sections.
 */
export function parseAppStreamYaml(yamlContent: string): AppStreamEntry[] {
  const entries: AppStreamEntry[] = [];
  const docs = yaml.loadAll(yamlContent, undefined, { json: true }) as any[];

  for (const doc of docs) {
    if (!doc || typeof doc !== "object") continue;
    if (doc.Type !== "desktop-application") continue;

    const packageName = doc.Package;
    const categories = doc.Categories;
    if (!packageName || !Array.isArray(categories) || categories.length === 0) continue;

    entries.push({ packageName, categories });
  }

  return entries;
}
