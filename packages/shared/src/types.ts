export interface ProjectSummary {
  id: number;
  coprId: number | null;
  fullName: string;
  owner: string;
  name: string;
  description: string | null;
  upstreamUrl: string | null;
  upstreamProvider: "github" | "gitlab" | null;
  upstreamStars: number;
  upstreamLanguage: string | null;
  popularityScore: number;
  coprVotes: number;
  coprDownloads: number;
  coprRepoEnables: number;
  discourseLikes: number;
  discourseViews: number;
  discourseReplies: number;
  lastBuildAt: string | null;
  updatedAt: string | null;
}

export interface ProjectDetail extends ProjectSummary {
  instructions: string | null;
  homepage: string | null;
  chroots: string[] | null;
  repoUrl: string | null;
  upstreamForks: number;
  upstreamDescription: string | null;
  upstreamTopics: string[] | null;
  upstreamReadme: string | null;
  discourseTopicId: number | null;
  lastSyncedAt: string | null;
  createdAt: string | null;
  readmeSyncedAt: string | null;
  votesSyncedAt: string | null;
  starsSyncedAt: string | null;
  discourseSyncedAt: string | null;
}

export interface PackageInfo {
  id: number;
  name: string;
  sourceType: string | null;
  sourceUrl: string | null;
}

export interface CategoryInfo {
  id: number;
  slug: string;
  name: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export interface StatsResponse {
  totalProjects: number;
  totalWithUpstream: number;
  topLanguages: { language: string; count: number }[];
}

export interface ProjectsQuery {
  q?: string;
  sort?: "id" | "coprId" | "popularity" | "stars" | "forks" | "votes" | "downloads" | "enables" | "likes" | "views" | "replies" | "discourseTopicId" | "name" | "owner" | "language" | "provider" | "updated" | "created" | "lastBuild" | "lastSynced" | "starsSynced" | "readmeSynced" | "votesSynced" | "discourseSynced";
  order?: "asc" | "desc";
  category?: string;
  owner?: string;
  name?: string;
  fullName?: string;
  language?: string;
  provider?: string;
  description?: string;
  instructions?: string;
  homepage?: string;
  upstreamUrl?: string;
  upstreamDescription?: string;
  upstreamReadme?: string;
  page?: number;
  limit?: number;
}
