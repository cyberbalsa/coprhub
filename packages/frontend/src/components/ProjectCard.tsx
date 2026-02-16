import type { ProjectSummary } from "@coprhub/shared";
import { formatShortNumber } from "@/lib/format";

export function ProjectCard({ project }: { project: ProjectSummary }) {
  return (
    <a href={`/projects/${project.owner}/${project.name}`} className="card">
      <div className="card-header">
        <h3>{project.owner}/{project.name}</h3>
      </div>
      <p className="description">
        {project.description?.slice(0, 120) || "No description"}
        {(project.description?.length ?? 0) > 120 ? "..." : ""}
      </p>
      <div className="card-footer">
        {project.upstreamStars > 0 && (
          <span className="stars">
            {project.upstreamProvider === "github" ? "GitHub" : "GitLab"}{" "}
            &#9733; {formatShortNumber(project.upstreamStars)}
          </span>
        )}
        {project.popularityScore > 0 && (
          <span
            className="popularity tooltip"
            data-tooltip={"Popularity score based on\nstars, votes, downloads,\nand community activity"}
          >
            &#x1f525; {formatShortNumber(project.popularityScore)}
          </span>
        )}
        {project.coprVotes > 0 && (
          <span className="votes">&#128077; {formatShortNumber(project.coprVotes)}</span>
        )}
        {project.upstreamLanguage && (
          <span className="language">{project.upstreamLanguage}</span>
        )}
      </div>
    </a>
  );
}
