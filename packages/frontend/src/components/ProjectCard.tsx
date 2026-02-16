import type { ProjectSummary } from "@coprhub/shared";

export function ProjectCard({ project }: { project: ProjectSummary }) {
  return (
    <a href={`/projects/${project.owner}/${project.name}`} className="card">
      <div className="card-header">
        <h3>{project.name}</h3>
        <span className="owner">{project.owner}</span>
      </div>
      <p className="description">
        {project.description?.slice(0, 120) || "No description"}
        {(project.description?.length ?? 0) > 120 ? "..." : ""}
      </p>
      <div className="card-footer">
        {project.upstreamStars > 0 && (
          <span className="stars">
            {project.upstreamProvider === "github" ? "GitHub" : "GitLab"}{" "}
            &#9733; {project.upstreamStars.toLocaleString()}
          </span>
        )}
        {project.popularityScore > 0 && (
          <span className="popularity">
            &#x1f525; {project.popularityScore.toLocaleString()}
          </span>
        )}
        {project.coprVotes > 0 && (
          <span className="votes">&#128077; {project.coprVotes}</span>
        )}
        {project.upstreamLanguage && (
          <span className="language">{project.upstreamLanguage}</span>
        )}
      </div>
    </a>
  );
}
