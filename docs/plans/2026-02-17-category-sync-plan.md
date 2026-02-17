# Category Auto-Classification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Auto-categorize all ~90k COPR projects into 13 Flathub-style categories using AppStream cross-reference, keyword heuristics, and LLM classification.

**Architecture:** A new weekly sync job (`category-sync`) downloads AppStream metadata from 5 distros, builds a package→category lookup map, then classifies each uncategorized project via a 3-tier waterfall: AppStream match → heuristic rules → LLM API call. Results are stored in the existing `project_categories` junction table.

**Tech Stack:** TypeScript, Drizzle ORM, Vitest, xml2js (XML parsing), js-yaml (YAML parsing), OpenAI SDK (LLM structured output via Ollama-compatible endpoint).

---

### Task 1: Schema Changes — Add `categorySyncedAt` and `source` columns

**Files:**
- Modify: `packages/shared/src/schema.ts:14-61` (projects table) and `:93-104` (projectCategories table)

**Step 1: Add `categorySyncedAt` to projects table**

In `packages/shared/src/schema.ts`, add after the `updatedAt` field (line 51):

```typescript
categorySyncedAt: timestamp("category_synced_at"),
```

**Step 2: Add `source` to projectCategories table**

In the same file, add to the `project_categories` columns (after `categoryId`, line 101):

```typescript
source: text("source").notNull().default("llm"),
```

**Step 3: Run `bun run db:generate` to verify schema compiles**

Run: `cd /home/balsa/Documents/Projects/copr-index && bun run db:generate`

**Step 4: Commit**

```bash
git add packages/shared/src/schema.ts
git commit -m "feat(schema): add categorySyncedAt and source columns for category sync"
```

---

### Task 2: Category Mapping Module

**Files:**
- Create: `packages/sync/src/category-mapping.ts`
- Test: `packages/sync/src/category-mapping.test.ts`

**Step 1: Write tests for FreeDesktop → COPRHub mapping**

Create `packages/sync/src/category-mapping.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { mapFreeDesktopCategories, CATEGORIES } from "./category-mapping.js";

describe("CATEGORIES", () => {
  it("has 13 categories", () => {
    expect(CATEGORIES).toHaveLength(13);
  });

  it("all have slug and name", () => {
    for (const cat of CATEGORIES) {
      expect(cat.slug).toBeTruthy();
      expect(cat.name).toBeTruthy();
    }
  });
});

describe("mapFreeDesktopCategories", () => {
  it("maps Game to games", () => {
    expect(mapFreeDesktopCategories(["Game"])).toBe("games");
  });

  it("maps ArcadeGame to games (sub-category)", () => {
    expect(mapFreeDesktopCategories(["ArcadeGame"])).toBe("games");
  });

  it("maps Development to developer-tools", () => {
    expect(mapFreeDesktopCategories(["Development"])).toBe("developer-tools");
  });

  it("maps RevisionControl to developer-tools", () => {
    expect(mapFreeDesktopCategories(["RevisionControl"])).toBe("developer-tools");
  });

  it("maps AudioVideo to audio-video", () => {
    expect(mapFreeDesktopCategories(["AudioVideo"])).toBe("audio-video");
  });

  it("prefers more specific category when multiple match", () => {
    // ArcadeGame is more specific than Game
    expect(mapFreeDesktopCategories(["Game", "ArcadeGame"])).toBe("games");
  });

  it("returns null for unknown categories", () => {
    expect(mapFreeDesktopCategories(["X-GNOME-Utilities"])).toBeNull();
  });

  it("returns null for empty array", () => {
    expect(mapFreeDesktopCategories([])).toBeNull();
  });

  it("maps Network;WebBrowser to networking", () => {
    expect(mapFreeDesktopCategories(["Network", "WebBrowser"])).toBe("networking");
  });

  it("maps Utility;TextEditor to utilities", () => {
    expect(mapFreeDesktopCategories(["Utility", "TextEditor"])).toBe("utilities");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /home/balsa/Documents/Projects/copr-index && bun --filter @coprhub/sync test`
Expected: FAIL — module not found

**Step 3: Write the mapping module**

Create `packages/sync/src/category-mapping.ts`:

```typescript
export interface Category {
  slug: string;
  name: string;
}

export const CATEGORIES: Category[] = [
  { slug: "audio-video", name: "Audio & Video" },
  { slug: "developer-tools", name: "Developer Tools" },
  { slug: "education", name: "Education" },
  { slug: "games", name: "Games" },
  { slug: "graphics", name: "Graphics & Photography" },
  { slug: "networking", name: "Networking" },
  { slug: "office", name: "Office & Productivity" },
  { slug: "science", name: "Science & Math" },
  { slug: "system", name: "System" },
  { slug: "utilities", name: "Utilities" },
  { slug: "libraries", name: "Libraries & Frameworks" },
  { slug: "command-line", name: "Command Line" },
  { slug: "fonts-themes", name: "Fonts & Themes" },
];

// Map from FreeDesktop category string to our slug
const FD_TO_SLUG: Record<string, string> = {
  // Audio & Video
  AudioVideo: "audio-video", Audio: "audio-video", Video: "audio-video",
  Midi: "audio-video", Mixer: "audio-video", Player: "audio-video",
  Recorder: "audio-video", Music: "audio-video", Sequencer: "audio-video",
  // Developer Tools
  Development: "developer-tools", Building: "developer-tools",
  Debugger: "developer-tools", IDE: "developer-tools",
  RevisionControl: "developer-tools", WebDevelopment: "developer-tools",
  Profiling: "developer-tools", Translation: "developer-tools",
  GUIDesigner: "developer-tools",
  // Education
  Education: "education",
  // Games
  Game: "games", ActionGame: "games", ArcadeGame: "games",
  BoardGame: "games", BlocksGame: "games", CardGame: "games",
  KidsGame: "games", LogicGame: "games", RolePlaying: "games",
  Shooter: "games", Simulation: "games", SportsGame: "games",
  StrategyGame: "games", Emulator: "games", AdventureGame: "games",
  // Graphics
  Graphics: "graphics", "2DGraphics": "graphics", "3DGraphics": "graphics",
  VectorGraphics: "graphics", RasterGraphics: "graphics",
  Photography: "graphics", Scanning: "graphics", OCR: "graphics",
  Viewer: "graphics", Publishing: "graphics",
  // Networking
  Network: "networking", Chat: "networking", Email: "networking",
  FileTransfer: "networking", InstantMessaging: "networking",
  IRCClient: "networking", WebBrowser: "networking",
  RemoteAccess: "networking", P2P: "networking", News: "networking",
  Telephony: "networking", VideoConference: "networking",
  // Office
  Office: "office", Calendar: "office", ContactManagement: "office",
  Database: "office", Dictionary: "office", Finance: "office",
  FlowChart: "office", PDA: "office", Presentation: "office",
  ProjectManagement: "office", Spreadsheet: "office",
  WordProcessor: "office",
  // Science
  Science: "science", Astronomy: "science", Biology: "science",
  Chemistry: "science", ComputerScience: "science",
  DataVisualization: "science", Math: "science",
  NumericalAnalysis: "science", Physics: "science",
  Geography: "science", Geology: "science", Geoscience: "science",
  MedicalSoftware: "science", Electronics: "science",
  Engineering: "science", Robotics: "science",
  // System
  System: "system", Settings: "system", Accessibility: "system",
  FileManager: "system", Monitor: "system", PackageManager: "system",
  Security: "system", TerminalEmulator: "system",
  // Utilities
  Utility: "utilities", Archiving: "utilities", Calculator: "utilities",
  Clock: "utilities", Compression: "utilities", FileTools: "utilities",
  TextEditor: "utilities",
};

/**
 * Map an array of FreeDesktop categories to a single COPRHub slug.
 * Returns null if no mapping found.
 */
export function mapFreeDesktopCategories(fdCategories: string[]): string | null {
  for (const cat of fdCategories) {
    const slug = FD_TO_SLUG[cat];
    if (slug) return slug;
  }
  return null;
}
```

**Step 4: Run tests to verify they pass**

Run: `cd /home/balsa/Documents/Projects/copr-index && bun --filter @coprhub/sync test`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add packages/sync/src/category-mapping.ts packages/sync/src/category-mapping.test.ts
git commit -m "feat(sync): add FreeDesktop-to-COPRHub category mapping module"
```

---

### Task 3: AppStream Parser — XML and YAML

**Files:**
- Create: `packages/sync/src/appstream-parser.ts`
- Test: `packages/sync/src/appstream-parser.test.ts`
- Modify: `packages/sync/package.json` (add xml2js, js-yaml)

**Step 1: Install dependencies**

Run: `cd /home/balsa/Documents/Projects/copr-index && bun add xml2js js-yaml --filter @coprhub/sync && bun add -d @types/js-yaml --filter @coprhub/sync`

Note: `xml2js` has built-in types. `js-yaml` needs `@types/js-yaml`.

**Step 2: Write tests for AppStream parsing**

Create `packages/sync/src/appstream-parser.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseAppStreamXml, parseAppStreamYaml, type AppStreamEntry } from "./appstream-parser.js";

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<components version="0.8" origin="test">
  <component type="desktop">
    <id>firefox.desktop</id>
    <pkgname>firefox</pkgname>
    <name>Firefox</name>
    <categories>
      <category>Network</category>
      <category>WebBrowser</category>
    </categories>
  </component>
  <component type="desktop-application">
    <id>org.gnome.gitg</id>
    <pkgname>gitg</pkgname>
    <name>gitg</name>
    <categories>
      <category>Development</category>
      <category>RevisionControl</category>
    </categories>
  </component>
  <component type="addon">
    <id>some-addon</id>
    <name>Addon</name>
  </component>
</components>`;

const SAMPLE_YAML = `---
File: DEP-11
Version: '0.16'
Origin: test
---
Type: desktop-application
ID: org.gnome.gitg
Package: gitg
Categories:
- Development
- RevisionControl
---
Type: addon
ID: some-addon
Package: some-addon
---
Type: desktop-application
ID: org.mozilla.Firefox
Package: firefox
Categories:
- Network
- WebBrowser
`;

describe("parseAppStreamXml", () => {
  it("extracts desktop components with pkgname and categories", async () => {
    const entries = await parseAppStreamXml(SAMPLE_XML);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      packageName: "firefox",
      categories: ["Network", "WebBrowser"],
    });
    expect(entries[1]).toEqual({
      packageName: "gitg",
      categories: ["Development", "RevisionControl"],
    });
  });

  it("skips components without pkgname", async () => {
    const entries = await parseAppStreamXml(SAMPLE_XML);
    const addon = entries.find((e) => e.packageName === "some-addon");
    expect(addon).toBeUndefined();
  });
});

describe("parseAppStreamYaml", () => {
  it("extracts desktop-application entries with Package and Categories", () => {
    const entries = parseAppStreamYaml(SAMPLE_YAML);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      packageName: "gitg",
      categories: ["Development", "RevisionControl"],
    });
    expect(entries[1]).toEqual({
      packageName: "firefox",
      categories: ["Network", "WebBrowser"],
    });
  });

  it("skips non-desktop-application entries", () => {
    const entries = parseAppStreamYaml(SAMPLE_YAML);
    const addon = entries.find((e) => e.packageName === "some-addon");
    expect(addon).toBeUndefined();
  });
});
```

**Step 3: Run tests to verify they fail**

Run: `cd /home/balsa/Documents/Projects/copr-index && bun --filter @coprhub/sync test`
Expected: FAIL — module not found

**Step 4: Write the parser module**

Create `packages/sync/src/appstream-parser.ts`:

```typescript
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
```

**Step 5: Run tests to verify they pass**

Run: `cd /home/balsa/Documents/Projects/copr-index && bun --filter @coprhub/sync test`
Expected: All tests PASS

**Step 6: Commit**

```bash
git add packages/sync/src/appstream-parser.ts packages/sync/src/appstream-parser.test.ts packages/sync/package.json
git commit -m "feat(sync): add AppStream XML and YAML parser for category extraction"
```

---

### Task 4: Category Heuristics Module

**Files:**
- Create: `packages/sync/src/category-heuristics.ts`
- Test: `packages/sync/src/category-heuristics.test.ts`

**Step 1: Write tests**

Create `packages/sync/src/category-heuristics.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { classifyByHeuristics, type ProjectMetadata } from "./category-heuristics.js";

describe("classifyByHeuristics", () => {
  it("classifies game projects by topics", () => {
    const meta: ProjectMetadata = {
      name: "cool-game", owner: "dev", description: "A fun game",
      upstreamTopics: ["game", "godot"], upstreamLanguage: "GDScript", homepage: null,
    };
    expect(classifyByHeuristics(meta)).toBe("games");
  });

  it("classifies CLI tools by topics", () => {
    const meta: ProjectMetadata = {
      name: "my-tool", owner: "dev", description: "A CLI tool",
      upstreamTopics: ["cli", "terminal"], upstreamLanguage: "Go", homepage: null,
    };
    expect(classifyByHeuristics(meta)).toBe("command-line");
  });

  it("classifies libraries by topics", () => {
    const meta: ProjectMetadata = {
      name: "libfoo", owner: "dev", description: "A shared library",
      upstreamTopics: ["library"], upstreamLanguage: "C", homepage: null,
    };
    expect(classifyByHeuristics(meta)).toBe("libraries");
  });

  it("classifies font packages by name", () => {
    const meta: ProjectMetadata = {
      name: "awesome-font", owner: "dev", description: "A nice font",
      upstreamTopics: [], upstreamLanguage: null, homepage: null,
    };
    expect(classifyByHeuristics(meta)).toBe("fonts-themes");
  });

  it("classifies by description keywords when topics don't match", () => {
    const meta: ProjectMetadata = {
      name: "browser-x", owner: "dev", description: "A web browser for Linux",
      upstreamTopics: [], upstreamLanguage: "Rust", homepage: null,
    };
    expect(classifyByHeuristics(meta)).toBe("networking");
  });

  it("returns null when no heuristic matches", () => {
    const meta: ProjectMetadata = {
      name: "something", owner: "dev", description: "Does stuff",
      upstreamTopics: [], upstreamLanguage: "Python", homepage: null,
    };
    expect(classifyByHeuristics(meta)).toBeNull();
  });

  it("classifies icon/theme packages", () => {
    const meta: ProjectMetadata = {
      name: "papirus-icon-theme", owner: "dev", description: "Icon theme for Linux",
      upstreamTopics: ["icon-theme", "linux"], upstreamLanguage: null, homepage: null,
    };
    expect(classifyByHeuristics(meta)).toBe("fonts-themes");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /home/balsa/Documents/Projects/copr-index && bun --filter @coprhub/sync test`

**Step 3: Write the heuristics module**

Create `packages/sync/src/category-heuristics.ts`:

```typescript
export interface ProjectMetadata {
  name: string;
  owner: string;
  description: string | null;
  upstreamTopics: string[] | null;
  upstreamLanguage: string | null;
  homepage: string | null;
}

interface HeuristicRule {
  slug: string;
  topicKeywords?: string[];
  nameKeywords?: string[];
  descriptionPatterns?: RegExp[];
  languageKeywords?: string[];
}

const RULES: HeuristicRule[] = [
  {
    slug: "games",
    topicKeywords: ["game", "gaming", "godot", "unity3d", "gamedev", "roguelike", "puzzle"],
    descriptionPatterns: [/\bgame\b/i, /\bgaming\b/i],
  },
  {
    slug: "fonts-themes",
    topicKeywords: ["font", "icon-theme", "gtk-theme", "cursor-theme", "theme"],
    nameKeywords: ["font", "theme", "icon", "cursor"],
    languageKeywords: ["Font"],
  },
  {
    slug: "command-line",
    topicKeywords: ["cli", "terminal", "shell", "command-line", "tui", "ncurses"],
    descriptionPatterns: [/\bcommand.line\b/i, /\bCLI\b/, /\bterminal\s+(tool|app|emulator)/i],
  },
  {
    slug: "libraries",
    topicKeywords: ["library", "sdk", "framework", "binding", "bindings", "api-client", "wrapper"],
    nameKeywords: ["lib"],
    descriptionPatterns: [/\blibrary\b/i, /\bSDK\b/i, /\bframework\b/i, /\bbindings?\b/i],
  },
  {
    slug: "developer-tools",
    topicKeywords: ["developer-tools", "devtools", "linter", "formatter", "compiler", "debugger", "ide", "editor"],
    descriptionPatterns: [/\btext editor\b/i, /\bcode editor\b/i, /\blinter\b/i, /\bcompiler\b/i, /\bIDE\b/],
  },
  {
    slug: "networking",
    topicKeywords: ["networking", "vpn", "proxy", "dns", "http", "web-server"],
    descriptionPatterns: [/\bweb browser\b/i, /\bhttp client\b/i, /\bVPN\b/i, /\bproxy\b/i],
  },
  {
    slug: "audio-video",
    topicKeywords: ["audio", "video", "music", "media-player", "streaming", "podcast"],
    descriptionPatterns: [/\baudio\b/i, /\bvideo\b/i, /\bmedia player\b/i, /\bmusic\b/i],
  },
  {
    slug: "graphics",
    topicKeywords: ["graphics", "image", "photo", "drawing", "3d", "blender", "gimp"],
    descriptionPatterns: [/\bimage editor\b/i, /\bphoto\b/i, /\bdrawing\b/i, /\b3D\b/],
  },
  {
    slug: "science",
    topicKeywords: ["science", "scientific", "math", "physics", "chemistry", "biology", "astronomy"],
    descriptionPatterns: [/\bscientific\b/i, /\bmathematic/i],
  },
  {
    slug: "system",
    topicKeywords: ["system", "sysadmin", "monitoring", "container", "docker", "podman", "kubernetes", "virtualization"],
    descriptionPatterns: [/\bsystem\s+admin/i, /\bmonitoring\b/i, /\bcontainer\b/i],
  },
  {
    slug: "office",
    topicKeywords: ["office", "productivity", "spreadsheet", "document", "pdf"],
    descriptionPatterns: [/\boffice\b/i, /\bspreadsheet\b/i, /\bword processor\b/i],
  },
  {
    slug: "education",
    topicKeywords: ["education", "learning", "teaching", "tutorial"],
    descriptionPatterns: [/\beducation/i, /\blearning\b/i],
  },
];

export function classifyByHeuristics(meta: ProjectMetadata): string | null {
  const topics = (meta.upstreamTopics ?? []).map((t) => t.toLowerCase());
  const nameLower = meta.name.toLowerCase();
  const descLower = (meta.description ?? "").toLowerCase();
  const lang = meta.upstreamLanguage ?? "";

  for (const rule of RULES) {
    // Check topic keywords
    if (rule.topicKeywords) {
      for (const kw of rule.topicKeywords) {
        if (topics.some((t) => t.includes(kw))) return rule.slug;
      }
    }

    // Check name keywords
    if (rule.nameKeywords) {
      for (const kw of rule.nameKeywords) {
        if (nameLower.includes(kw)) return rule.slug;
      }
    }

    // Check language keywords
    if (rule.languageKeywords) {
      for (const kw of rule.languageKeywords) {
        if (lang === kw) return rule.slug;
      }
    }

    // Check description patterns
    if (rule.descriptionPatterns && meta.description) {
      for (const pat of rule.descriptionPatterns) {
        if (pat.test(meta.description)) return rule.slug;
      }
    }
  }

  return null;
}
```

**Step 4: Run tests to verify they pass**

Run: `cd /home/balsa/Documents/Projects/copr-index && bun --filter @coprhub/sync test`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add packages/sync/src/category-heuristics.ts packages/sync/src/category-heuristics.test.ts
git commit -m "feat(sync): add keyword/topic heuristic category classifier"
```

---

### Task 5: LLM Classification Client

**Files:**
- Create: `packages/sync/src/category-llm.ts`
- Test: `packages/sync/src/category-llm.test.ts`
- Modify: `packages/sync/package.json` (add `openai` package)

**Step 1: Install OpenAI SDK**

Run: `cd /home/balsa/Documents/Projects/copr-index && bun add openai --filter @coprhub/sync`

**Step 2: Write tests for LLM client**

Create `packages/sync/src/category-llm.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildClassificationPrompt, VALID_SLUGS } from "./category-llm.js";

describe("buildClassificationPrompt", () => {
  it("builds a prompt with all fields", () => {
    const prompt = buildClassificationPrompt({
      name: "dev/my-tool",
      description: "A tool for doing things",
      upstreamLanguage: "Rust",
      upstreamTopics: ["cli", "fast"],
      homepage: "https://example.com",
    });
    expect(prompt).toContain("dev/my-tool");
    expect(prompt).toContain("A tool for doing things");
    expect(prompt).toContain("Rust");
    expect(prompt).toContain("cli, fast");
    expect(prompt).toContain("https://example.com");
  });

  it("handles null fields gracefully", () => {
    const prompt = buildClassificationPrompt({
      name: "owner/pkg",
      description: null,
      upstreamLanguage: null,
      upstreamTopics: null,
      homepage: null,
    });
    expect(prompt).toContain("owner/pkg");
    expect(prompt).not.toContain("undefined");
  });
});

describe("VALID_SLUGS", () => {
  it("contains all 13 category slugs", () => {
    expect(VALID_SLUGS).toHaveLength(13);
    expect(VALID_SLUGS).toContain("games");
    expect(VALID_SLUGS).toContain("developer-tools");
    expect(VALID_SLUGS).toContain("command-line");
  });
});
```

**Step 3: Run tests to verify they fail**

Run: `cd /home/balsa/Documents/Projects/copr-index && bun --filter @coprhub/sync test`

**Step 4: Write the LLM client**

Create `packages/sync/src/category-llm.ts`:

```typescript
import OpenAI from "openai";
import { CATEGORIES } from "./category-mapping.js";

export const VALID_SLUGS = CATEGORIES.map((c) => c.slug);

const SYSTEM_PROMPT = `You are a Linux package classifier. Given a COPR package's metadata, classify it into exactly ONE category. Respond with JSON matching this schema: {"category": "<slug>", "confidence": "high"|"medium"|"low"}

Categories:
${CATEGORIES.map((c) => `- ${c.slug}: ${c.name}`).join("\n")}`;

interface ClassificationInput {
  name: string;
  description: string | null;
  upstreamLanguage: string | null;
  upstreamTopics: string[] | null;
  homepage: string | null;
}

export interface ClassificationResult {
  category: string;
  confidence: "high" | "medium" | "low";
}

export function buildClassificationPrompt(input: ClassificationInput): string {
  const lines = [`Name: ${input.name}`];
  if (input.description) lines.push(`Description: ${input.description}`);
  if (input.upstreamLanguage) lines.push(`Language: ${input.upstreamLanguage}`);
  if (input.upstreamTopics?.length) lines.push(`Topics: ${input.upstreamTopics.join(", ")}`);
  if (input.homepage) lines.push(`Homepage: ${input.homepage}`);
  return lines.join("\n");
}

export function createLlmClassifier(apiUrl: string, apiKey: string, model: string) {
  const client = new OpenAI({
    baseURL: apiUrl.replace(/\/chat\/completions$/, ""),
    apiKey,
  });

  let rateLimitRemaining = Infinity;
  let rateLimitResetMs = 0;

  async function classify(input: ClassificationInput): Promise<ClassificationResult> {
    // Respect rate limits
    if (rateLimitRemaining < 100) {
      const waitMs = Math.max(0, rateLimitResetMs - Date.now());
      if (waitMs > 0) {
        console.log(`Rate limited, waiting ${(waitMs / 1000).toFixed(1)}s...`);
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildClassificationPrompt(input) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "classification",
          schema: {
            type: "object",
            properties: {
              category: { type: "string", enum: VALID_SLUGS },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
            },
            required: ["category", "confidence"],
          },
        },
      },
    });

    // Update rate limit tracking from headers
    // Note: OpenAI SDK exposes response headers via response.headers
    const rawResponse = response as any;
    if (rawResponse._request_id) {
      // Headers are accessible from the raw response in some SDK versions
    }

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("No content in LLM response");

    const parsed: ClassificationResult = JSON.parse(content);

    // Validate the slug
    if (!VALID_SLUGS.includes(parsed.category)) {
      parsed.category = "utilities"; // fallback
      parsed.confidence = "low";
    }

    return parsed;
  }

  return { classify };
}
```

**Step 5: Run tests to verify they pass**

Run: `cd /home/balsa/Documents/Projects/copr-index && bun --filter @coprhub/sync test`
Expected: All tests PASS (only testing prompt building, not actual API calls)

**Step 6: Commit**

```bash
git add packages/sync/src/category-llm.ts packages/sync/src/category-llm.test.ts packages/sync/package.json
git commit -m "feat(sync): add LLM classification client with structured output"
```

---

### Task 6: AppStream Index Downloader

**Files:**
- Create: `packages/sync/src/appstream-downloader.ts`

This module downloads and caches AppStream metadata from all 5 distros.

**Step 1: Write the downloader module**

Create `packages/sync/src/appstream-downloader.ts`:

```typescript
import { existsSync, mkdirSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "bun";
import { join } from "node:path";
import { USER_AGENT } from "./user-agent.js";
import { parseAppStreamXml, parseAppStreamYaml, type AppStreamEntry } from "./appstream-parser.js";

const CACHE_DIR = join(import.meta.dir, "../../../../data/appstream");
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface AppStreamSource {
  name: string;
  url: string;
  format: "xml" | "yaml";
  /** If true, URL is a repomd.xml that must be parsed to find the actual data URL */
  repomd?: boolean;
  /** If true, URL is an RPM that contains the data */
  rpm?: boolean;
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
```

**Step 2: Add `data/appstream/` to `.gitignore`**

Append to `.gitignore`:
```
data/appstream/
```

**Step 3: Commit**

```bash
git add packages/sync/src/appstream-downloader.ts .gitignore
git commit -m "feat(sync): add AppStream index downloader with caching"
```

---

### Task 7: Main Category Sync Orchestrator

**Files:**
- Create: `packages/sync/src/category-sync.ts`

**Step 1: Write the orchestrator**

Create `packages/sync/src/category-sync.ts`:

```typescript
import { sql, eq, isNull, and, lt } from "drizzle-orm";
import type { Db } from "@coprhub/shared";
import { projects, packages as packagesTable, categories, projectCategories, syncJobs } from "@coprhub/shared";
import { shouldSkipSync, type SyncOptions } from "./ttl.js";
import { CATEGORIES, mapFreeDesktopCategories } from "./category-mapping.js";
import { downloadAllAppStreamIndices } from "./appstream-downloader.js";
import { classifyByHeuristics, type ProjectMetadata } from "./category-heuristics.js";
import { createLlmClassifier } from "./category-llm.js";

const LLM_API_URL = process.env.LLM_API_URL;
const LLM_API_KEY = process.env.LLM_API_KEY;
const LLM_MODEL = process.env.LLM_MODEL || "qwen3:8b";

export async function syncCategories(db: Db, options: SyncOptions) {
  const start = Date.now();

  // Check TTL
  const lastJob = await db
    .select()
    .from(syncJobs)
    .where(eq(syncJobs.jobName, "category-sync"))
    .limit(1);
  if (shouldSkipSync(lastJob[0]?.lastCompletedAt ?? null, options.ttlHours, options.forceSync)) {
    console.log("Category sync: skipped (within TTL)");
    return;
  }

  console.log("Category sync: starting...");

  // Step 1: Seed categories (idempotent)
  console.log("Seeding categories...");
  for (const cat of CATEGORIES) {
    await db
      .insert(categories)
      .values({ slug: cat.slug, name: cat.name })
      .onConflictDoNothing();
  }

  // Build slug → categoryId map
  const catRows = await db.select().from(categories);
  const slugToId = new Map(catRows.map((r) => [r.slug, r.id]));

  // Step 2: Download AppStream indices
  console.log("Downloading AppStream indices...");
  const appstreamMap = await downloadAllAppStreamIndices();

  // Step 3: Find projects needing classification
  const projectsToClassify = await db
    .select({
      id: projects.id,
      owner: projects.owner,
      name: projects.name,
      description: projects.description,
      homepage: projects.homepage,
      upstreamLanguage: projects.upstreamLanguage,
      upstreamTopics: projects.upstreamTopics,
      updatedAt: projects.updatedAt,
      categorySyncedAt: projects.categorySyncedAt,
    })
    .from(projects)
    .where(
      sql`${projects.categorySyncedAt} IS NULL OR ${projects.updatedAt} > ${projects.categorySyncedAt}`
    );

  console.log(`Projects to classify: ${projectsToClassify.length}`);

  if (projectsToClassify.length === 0) {
    console.log("Category sync: nothing to do");
    return;
  }

  // Pre-fetch all package names for these projects
  const projectIds = projectsToClassify.map((p) => p.id);
  const allPackages = await db
    .select({ projectId: packagesTable.projectId, name: packagesTable.name })
    .from(packagesTable)
    .where(sql`${packagesTable.projectId} = ANY(${projectIds})`);

  const projectPackageNames = new Map<number, string[]>();
  for (const pkg of allPackages) {
    const names = projectPackageNames.get(pkg.projectId) ?? [];
    names.push(pkg.name);
    projectPackageNames.set(pkg.projectId, names);
  }

  // Create LLM classifier if endpoint is configured
  const llmClassifier = LLM_API_URL && LLM_API_KEY
    ? createLlmClassifier(LLM_API_URL, LLM_API_KEY, LLM_MODEL)
    : null;

  let stats = { appstream: 0, heuristic: 0, llm: 0, failed: 0 };

  // Step 4: Classify each project
  for (let i = 0; i < projectsToClassify.length; i++) {
    const project = projectsToClassify[i];
    let slug: string | null = null;
    let source: "appstream" | "heuristic" | "llm" = "llm";

    // Tier 1: AppStream cross-reference
    const pkgNames = projectPackageNames.get(project.id) ?? [project.name];
    for (const pkgName of pkgNames) {
      const fdCategories = appstreamMap.get(pkgName);
      if (fdCategories) {
        slug = mapFreeDesktopCategories(fdCategories);
        if (slug) {
          source = "appstream";
          break;
        }
      }
    }

    // Tier 2: Heuristics
    if (!slug) {
      const meta: ProjectMetadata = {
        name: project.name,
        owner: project.owner,
        description: project.description,
        upstreamTopics: project.upstreamTopics,
        upstreamLanguage: project.upstreamLanguage,
        homepage: project.homepage,
      };
      slug = classifyByHeuristics(meta);
      if (slug) source = "heuristic";
    }

    // Tier 3: LLM classification
    if (!slug && llmClassifier) {
      try {
        const result = await llmClassifier.classify({
          name: `${project.owner}/${project.name}`,
          description: project.description,
          upstreamLanguage: project.upstreamLanguage,
          upstreamTopics: project.upstreamTopics,
          homepage: project.homepage,
        });
        slug = result.category;
        source = "llm";
      } catch (err) {
        console.warn(`LLM failed for ${project.owner}/${project.name}: ${err}`);
        stats.failed++;
      }

      // Small delay between LLM requests
      if (i < projectsToClassify.length - 1) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    // Fallback if no LLM configured and no other match
    if (!slug) {
      slug = "utilities";
      source = "heuristic";
    }

    // Write result
    const categoryId = slugToId.get(slug);
    if (categoryId) {
      // Delete existing assignment
      await db
        .delete(projectCategories)
        .where(eq(projectCategories.projectId, project.id));

      // Insert new assignment
      await db
        .insert(projectCategories)
        .values({ projectId: project.id, categoryId, source });
    }

    // Update categorySyncedAt
    await db
      .update(projects)
      .set({ categorySyncedAt: new Date() })
      .where(eq(projects.id, project.id));

    stats[source]++;

    // Progress log every 1000 projects
    if ((i + 1) % 1000 === 0) {
      console.log(`  Progress: ${i + 1}/${projectsToClassify.length} (appstream: ${stats.appstream}, heuristic: ${stats.heuristic}, llm: ${stats.llm})`);
    }
  }

  const duration = Date.now() - start;
  console.log(`Category sync complete in ${(duration / 1000).toFixed(1)}s`);
  console.log(`  AppStream: ${stats.appstream}, Heuristic: ${stats.heuristic}, LLM: ${stats.llm}, Failed: ${stats.failed}`);

  // Record sync job completion
  await db
    .insert(syncJobs)
    .values({ jobName: "category-sync", lastCompletedAt: new Date(), durationMs: duration })
    .onConflictDoUpdate({
      target: syncJobs.jobName,
      set: { lastCompletedAt: new Date(), durationMs: duration },
    });
}
```

**Step 2: Commit**

```bash
git add packages/sync/src/category-sync.ts
git commit -m "feat(sync): add category sync orchestrator with 3-tier classification"
```

---

### Task 8: Wire Category Sync into Sync Worker

**Files:**
- Modify: `packages/sync/src/index.ts`
- Modify: `.env.example`

**Step 1: Add category sync to the worker**

In `packages/sync/src/index.ts`, add the import (after line 3):

```typescript
import { syncCategories } from "./category-sync.js";
```

Add env vars (after line 19):

```typescript
const CATEGORY_SYNC_INTERVAL_HOURS = parseInt(process.env.CATEGORY_SYNC_INTERVAL_HOURS || "168", 10);
const CATEGORY_SYNC_TTL_HOURS = parseInt(process.env.CATEGORY_SYNC_TTL_HOURS || String(CATEGORY_SYNC_INTERVAL_HOURS), 10);
```

Add the run function (after `runDiscourseSync`):

```typescript
async function runCategorySync() {
  try {
    await syncCategories(db, { ttlHours: CATEGORY_SYNC_TTL_HOURS, forceSync: FORCE_SYNC });
  } catch (err) {
    console.error("Category sync failed:", err);
  }
}
```

Update the log lines to include category sync interval and TTL.

Add the initial call (after `await runDiscourseSync();`):

```typescript
await runCategorySync();
```

Add the interval (after the discourse interval):

```typescript
setInterval(runCategorySync, CATEGORY_SYNC_INTERVAL_HOURS * 60 * 60 * 1000);
```

**Step 2: Update `.env.example`**

Append:

```
CATEGORY_SYNC_INTERVAL_HOURS=168
CATEGORY_SYNC_TTL_HOURS=168
LLM_API_URL=https://api.genai.gccis.rit.edu/v1/chat/completions
LLM_API_KEY=
LLM_MODEL=qwen3:8b
```

**Step 3: Commit**

```bash
git add packages/sync/src/index.ts .env.example
git commit -m "feat(sync): wire category sync into sync worker (weekly, after discourse)"
```

---

### Task 9: Fix Category Filter in Projects API

**Files:**
- Modify: `packages/api/src/routes/projects.ts:38-66`

**Step 1: Add category filter condition**

In `packages/api/src/routes/projects.ts`, after the full-text search block (after line 64), add:

```typescript
    // Category filter (join-based)
    if (query.category) {
      conditions.push(
        sql`${projects.id} IN (
          SELECT ${projectCategories.projectId} FROM ${projectCategories}
          JOIN ${categories} ON ${projectCategories.categoryId} = ${categories.id}
          WHERE ${categories.slug} = ${query.category}
        )`
      );
    }
```

**Step 2: Verify imports are already present**

The file already imports `categories` and `projectCategories` from `@coprhub/shared` on lines 3-8. No new imports needed.

**Step 3: Commit**

```bash
git add packages/api/src/routes/projects.ts
git commit -m "fix(api): implement category filter join in projects list endpoint"
```

---

### Task 10: Update Infrastructure Files

**Files:**
- Modify: `packages/sync/Dockerfile` (no changes needed — bun runs .ts directly)
- Modify: `CLAUDE.md` (document the new sync job and env vars)

**Step 1: Verify Dockerfile works as-is**

The sync Dockerfile already runs `bun run packages/sync/src/index.ts` which will pick up the new imports. The `openai`, `xml2js`, and `js-yaml` packages will be installed by `bun install --frozen-lockfile` from the lockfile. No Dockerfile changes needed.

**Step 2: Update CLAUDE.md**

Add to the "Sync Worker" section:

```
4. **Category sync** (every 7d) - downloads AppStream metadata from Flathub, openSUSE, Debian, Ubuntu; cross-references package names; classifies remaining projects via keyword heuristics and LLM (qwen3:8b)
```

Add to "Environment Variables" section:

```
- `CATEGORY_SYNC_INTERVAL_HOURS` - Hours between category sync runs (default: 168 = 7 days)
- `CATEGORY_SYNC_TTL_HOURS` - Hours before category sync can re-run (default: matches interval)
- `LLM_API_URL` - OpenAI-compatible endpoint for LLM classification
- `LLM_API_KEY` - API key for LLM endpoint
- `LLM_MODEL` - Model name for classification (default: qwen3:8b)
```

**Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add category sync to CLAUDE.md"
```

---

### Task 11: Run Full Test Suite

**Step 1: Run all tests**

Run: `cd /home/balsa/Documents/Projects/copr-index && bun run test`
Expected: All tests PASS across all packages

**Step 2: Run type check**

Run: `cd /home/balsa/Documents/Projects/copr-index && bun run build`
Expected: No TypeScript errors

**Step 3: Push schema to database**

Run: `podman exec -w /app/packages/shared copr-index_api_1 bunx drizzle-kit push --config drizzle.config.ts`

This adds the `category_synced_at` column to `projects` and `source` column to `project_categories`.

---

### Task 12: Build and Test in Containers

**Step 1: Rebuild sync container**

Run: `cd /home/balsa/Documents/Projects/copr-index && podman-compose build sync-worker`

**Step 2: Restart stack**

Run: `podman-compose up -d`

**Step 3: Check logs**

Run: `podman-compose logs -f sync-worker`

Expected: See "Category sync: starting...", AppStream downloads, and classification progress.
