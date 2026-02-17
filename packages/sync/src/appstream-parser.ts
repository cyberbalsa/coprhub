import { parseStringPromise } from "xml2js";
import yaml from "js-yaml";

export interface AppStreamEntry {
  packageName: string;
  categories: string[];
}

/**
 * Parse AppStream XML (used by Fedora, openSUSE, Flathub).
 * Extracts desktop/desktop-application components with pkgname and categories.
 */
export async function parseAppStreamXml(xmlContent: string): Promise<AppStreamEntry[]> {
  const parsed = await parseStringPromise(xmlContent, { explicitArray: true });
  const components = parsed?.components?.component ?? [];
  const entries: AppStreamEntry[] = [];

  for (const comp of components) {
    const type = comp.$?.type;
    if (type !== "desktop" && type !== "desktop-application") continue;

    const pkgname = comp.pkgname?.[0];
    const categories = comp.categories?.[0]?.category ?? [];
    if (!pkgname || categories.length === 0) continue;

    entries.push({ packageName: pkgname, categories });
  }

  return entries;
}

/**
 * Parse AppStream DEP-11 YAML (used by Debian, Ubuntu).
 * Multi-document YAML with --- separators.
 */
export function parseAppStreamYaml(yamlContent: string): AppStreamEntry[] {
  const entries: AppStreamEntry[] = [];
  const docs = yaml.loadAll(yamlContent) as any[];

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
