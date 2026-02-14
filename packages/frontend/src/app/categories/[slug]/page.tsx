import { getProjects, getCategories } from "@/lib/api-client";
import { ProjectCard } from "@/components/ProjectCard";

export const dynamic = "force-dynamic";

interface CategoryPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}

export default async function CategoryPage({
  params,
  searchParams,
}: CategoryPageProps) {
  const { slug } = await params;
  const { page: pageStr } = await searchParams;
  const page = parseInt(pageStr || "1", 10);

  const [results, categoriesRes] = await Promise.all([
    getProjects({ category: slug, page, sort: "stars", limit: 24 }),
    getCategories(),
  ]);

  const category = categoriesRes.data.find((c) => c.slug === slug);
  const categoryName = category?.name || slug;

  return (
    <div>
      <h1>{categoryName}</h1>
      <p>{results.meta.total} projects</p>
      <div className="card-grid">
        {results.data.map((p) => (
          <ProjectCard key={p.id} project={p} />
        ))}
      </div>
    </div>
  );
}
