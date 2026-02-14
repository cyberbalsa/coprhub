import { getProjects } from "@/lib/api-client";
import { ProjectCard } from "@/components/ProjectCard";

interface OwnerPageProps {
  params: Promise<{ owner: string }>;
  searchParams: Promise<{ page?: string }>;
}

export default async function OwnerPage({
  params,
  searchParams,
}: OwnerPageProps) {
  const { owner } = await params;
  const { page: pageStr } = await searchParams;
  const page = parseInt(pageStr || "1", 10);

  const results = await getProjects({ owner, page, sort: "stars", limit: 24 });

  return (
    <div>
      <h1>Projects by {owner}</h1>
      <p>{results.meta.total} projects</p>
      <div className="card-grid">
        {results.data.map((p) => (
          <ProjectCard key={p.id} project={p} />
        ))}
      </div>
    </div>
  );
}
