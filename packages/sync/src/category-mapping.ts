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
