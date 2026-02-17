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
