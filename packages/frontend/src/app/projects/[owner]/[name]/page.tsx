import type { Metadata } from "next";
import { getProject, getProjectPackages, getProjectComments } from "@/lib/api-client";
import { DiscourseComments } from "@/components/DiscourseComments";
import { ReadmeDisplay } from "@/components/ReadmeDisplay";
import { CopyButton } from "@/components/CopyButton";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

interface ProjectPageProps {
  params: Promise<{ owner: string; name: string }>;
}

export async function generateMetadata({ params }: ProjectPageProps): Promise<Metadata> {
  const { owner, name } = await params;
  try {
    const project = await getProject(owner, name);
    const ogTitle = `[${project.id}] - ${project.owner}/${project.name}`;
    return {
      title: `${project.owner}/${project.name} - COPRHub`,
      openGraph: { title: ogTitle },
    };
  } catch {
    return { title: "Project not found - COPRHub" };
  }
}

export default async function ProjectPage({ params }: ProjectPageProps) {
  const { owner, name } = await params;

  let project;
  try {
    project = await getProject(owner, name);
  } catch {
    notFound();
  }

  const [{ data: packages }, commentsData] = await Promise.all([
    getProjectPackages(owner, name),
    getProjectComments(owner, name),
  ]);
  const enableCommand = `sudo dnf copr enable ${owner}/${name}`;

  return (
    <div className="project-detail">
      <div className="project-header">
        <h1>{project.name}</h1>
        <span className="owner">by {project.owner}</span>
        {project.upstreamStars > 0 && (
          <span className="stars-badge">
            &#9733; {project.upstreamStars.toLocaleString()}
          </span>
        )}
        {project.coprVotes > 0 && (
          <a
            href={`https://copr.fedorainfracloud.org/coprs/${owner}/${name}/`}
            target="_blank"
            rel="noopener"
            className="votes-badge"
            title="Vote on COPR"
          >
            &#128077; {project.coprVotes}
          </a>
        )}
        {project.popularityScore > 0 && (
          <span className="popularity-badge" title="Popularity score">
            &#x1f525; {project.popularityScore.toLocaleString()}
          </span>
        )}
      </div>

      {project.description && (
        <section>
          <p>{project.description}</p>
        </section>
      )}

      <section className="install-section">
        <h2>Install</h2>
        <div className="code-block">
          <code>{enableCommand}</code>
          <CopyButton text={enableCommand} />
        </div>
        {project.instructions && (
          <div className="instructions">{project.instructions}</div>
        )}
      </section>

      {project.chroots && project.chroots.length > 0 && (
        <section>
          <h2>Supported Releases</h2>
          <div className="badge-list">
            {project.chroots.map((chroot) => (
              <span key={chroot} className="badge">
                {chroot}
              </span>
            ))}
          </div>
        </section>
      )}

      {project.upstreamUrl && (
        <section>
          <h2>Upstream</h2>
          <a href={project.upstreamUrl} target="_blank" rel="noopener">
            {project.upstreamUrl}
          </a>
          {project.upstreamLanguage && (
            <span className="language-badge">{project.upstreamLanguage}</span>
          )}
          {project.upstreamTopics && project.upstreamTopics.length > 0 && (
            <div className="badge-list">
              {project.upstreamTopics.map((t) => (
                <span key={t} className="badge">
                  {t}
                </span>
              ))}
            </div>
          )}
        </section>
      )}

      {packages.length > 0 && (
        <section>
          <h2>Packages</h2>
          <ul className="package-list">
            {packages.map((pkg) => (
              <li key={pkg.id}>
                <strong>{pkg.name}</strong>
                {pkg.sourceType && (
                  <span className="source-type">{pkg.sourceType}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {project.upstreamReadme && (
        <section>
          <h2>README</h2>
          <ReadmeDisplay content={project.upstreamReadme} />
        </section>
      )}

      <section className="comments-section">
        <h2>Community</h2>
        <DiscourseComments
          owner={owner}
          name={name}
          comments={commentsData.data}
          topicUrl={commentsData.topicUrl}
        />
      </section>
    </div>
  );
}
