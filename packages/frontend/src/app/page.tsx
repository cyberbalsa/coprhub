import { getProjects, getCategories } from "@/lib/api-client";
import { ProjectCard } from "@/components/ProjectCard";
import { SearchBar } from "@/components/SearchBar";

export default async function HomePage() {
  const [popular, recent, categoriesRes] = await Promise.all([
    getProjects({ sort: "stars", limit: 12 }),
    getProjects({ sort: "updated", limit: 12 }),
    getCategories(),
  ]);

  return (
    <div>
      <section className="hero">
        <h1>Discover Fedora COPR Packages</h1>
        <p>Browse, search, and explore community-built RPM packages</p>
        <SearchBar />
      </section>

      <section className="section">
        <h2>Popular</h2>
        <div className="card-grid">
          {popular.data.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      </section>

      <section className="section">
        <h2>Recently Updated</h2>
        <div className="card-grid">
          {recent.data.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      </section>

      {categoriesRes.data.length > 0 && (
        <section className="section">
          <h2>Categories</h2>
          <div className="category-grid">
            {categoriesRes.data.map((cat) => (
              <a
                key={cat.id}
                href={`/categories/${cat.slug}`}
                className="category-tile"
              >
                <span>{cat.name}</span>
                <span className="count">{cat.projectCount}</span>
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
