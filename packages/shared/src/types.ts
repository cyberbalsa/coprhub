export interface ProjectSummary {
  id: number;
  fullName: string;
  owner: string;
  name: string;
  description: string | null;
  upstreamUrl: string | null;
  upstreamProvider: "github" | "gitlab" | null;
  upstreamStars: number;
  upstreamLanguage: string | null;
}

export interface ProjectDetail extends ProjectSummary {
  instructions: string | null;
  homepage: string | null;
  chroots: string[] | null;
  repoUrl: string | null;
  upstreamForks: number;
  upstreamDescription: string | null;
  upstreamTopics: string[] | null;
  lastSyncedAt: string | null;
  createdAt: string | null;
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
  sort?: "stars" | "name" | "updated";
  order?: "asc" | "desc";
  category?: string;
  owner?: string;
  language?: string;
  page?: number;
  limit?: number;
}
