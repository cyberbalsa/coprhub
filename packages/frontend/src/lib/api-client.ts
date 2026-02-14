import type {
  PaginatedResponse,
  ProjectSummary,
  ProjectDetail,
  PackageInfo,
  CategoryInfo,
  StatsResponse,
  ProjectsQuery,
} from "@copr-index/shared";

const API_URL = process.env.API_URL || "http://localhost:4000";

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { next: { revalidate: 300 } });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function getProjects(
  params: ProjectsQuery = {}
): Promise<PaginatedResponse<ProjectSummary>> {
  const searchParams = new URLSearchParams();
  if (params.q) searchParams.set("q", params.q);
  if (params.sort) searchParams.set("sort", params.sort);
  if (params.order) searchParams.set("order", params.order);
  if (params.category) searchParams.set("category", params.category);
  if (params.owner) searchParams.set("owner", params.owner);
  if (params.language) searchParams.set("language", params.language);
  if (params.page) searchParams.set("page", params.page.toString());
  if (params.limit) searchParams.set("limit", params.limit.toString());

  const qs = searchParams.toString();
  return apiFetch(`/api/projects${qs ? `?${qs}` : ""}`);
}

export async function getProject(
  owner: string,
  name: string
): Promise<ProjectDetail> {
  return apiFetch(`/api/projects/${owner}/${name}`);
}

export async function getProjectPackages(
  owner: string,
  name: string
): Promise<{ data: PackageInfo[] }> {
  return apiFetch(`/api/projects/${owner}/${name}/packages`);
}

export async function getCategories(): Promise<{
  data: (CategoryInfo & { projectCount: number })[];
}> {
  return apiFetch("/api/categories");
}

export async function getStats(): Promise<StatsResponse> {
  return apiFetch("/api/stats");
}
