import { getProjects, getCategories } from "@/lib/api-client";
import { ProjectCard } from "@/components/ProjectCard";
import { SearchBar } from "@/components/SearchBar";

export const dynamic = "force-dynamic";

interface SearchPageProps {
  searchParams: Promise<{
    q?: string;
    sort?: string;
    category?: string;
    language?: string;
    page?: string;
  }>;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const page = parseInt(params.page || "1", 10);

  const [results, categoriesRes] = await Promise.all([
    getProjects({
      q: params.q,
      sort: (params.sort as "stars" | "name" | "updated") || "stars",
      category: params.category,
      language: params.language,
      page,
      limit: 24,
    }),
    getCategories(),
  ]);

  return (
    <div>
      <SearchBar initialQuery={params.q} />

      <div className="browse-layout">
        <aside className="filters">
          <h3>Sort</h3>
          <ul>
            {["stars", "name", "updated"].map((s) => (
              <li key={s}>
                <a
                  href={`/search?${new URLSearchParams({ ...params, sort: s, page: "1" }).toString()}`}
                  className={params.sort === s ? "active" : ""}
                >
                  {s === "stars" ? "Most Stars" : s === "name" ? "Name" : "Recently Updated"}
                </a>
              </li>
            ))}
          </ul>

          {categoriesRes.data.length > 0 && (
            <>
              <h3>Categories</h3>
              <ul>
                {categoriesRes.data.map((cat) => (
                  <li key={cat.id}>
                    <a
                      href={`/search?${new URLSearchParams({ ...params, category: cat.slug, page: "1" }).toString()}`}
                      className={params.category === cat.slug ? "active" : ""}
                    >
                      {cat.name} ({cat.projectCount})
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>

        <div className="results">
          <p className="result-count">
            {results.meta.total} packages found
          </p>
          <div className="card-grid">
            {results.data.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>

          {results.meta.pages > 1 && (
            <nav className="pagination">
              {page > 1 && (
                <a
                  href={`/search?${new URLSearchParams({ ...params, page: (page - 1).toString() }).toString()}`}
                >
                  Previous
                </a>
              )}
              <span>
                Page {page} of {results.meta.pages}
              </span>
              {page < results.meta.pages && (
                <a
                  href={`/search?${new URLSearchParams({ ...params, page: (page + 1).toString() }).toString()}`}
                >
                  Next
                </a>
              )}
            </nav>
          )}
        </div>
      </div>
    </div>
  );
}
