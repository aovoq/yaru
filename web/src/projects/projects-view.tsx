import { EmptyState } from "../components/empty-state"
import { PageHeader } from "../components/page-header"
import { PageShell } from "../components/page-shell"
import { InboxLink } from "./inbox-link"
import { ProjectCard, type ProjectSummary } from "./project-card"

// 配っているワークスペースの一覧。src/projects.tsx

export function ProjectsView({ projects, now }: { projects: ProjectSummary[]; now: Date }) {
  const awaitingTotal = projects.reduce((total, project) => total + project.awaiting.length, 0)
  return (
    <PageShell header={<PageHeader home breadcrumb={[{ label: "Projects" }]} />} mainClass="gap-3">
      {projects.length === 0 ? (
        <EmptyState>No workspaces yet. Run yaru in a workspace to add it here.</EmptyState>
      ) : (
        <>
          <InboxLink awaiting={awaitingTotal} />
          {projects.map((project) => (
            <ProjectCard key={project.slug} project={project} now={now} />
          ))}
        </>
      )}
    </PageShell>
  )
}
