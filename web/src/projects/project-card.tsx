import { buttonClass } from "../components/button"
import { Card } from "../components/card"
import { MetaRow } from "../components/meta-row"
import type { Question } from "../domain/question"
import { AwaitingQuestionRow } from "./awaiting-question-row"

// プロジェクトの一覧の 1 件。src/projects/project-card.tsx

export type ProjectSummary = {
  slug: string
  root: string
  awaiting: Question[]
  inProgress: number
}

export function ProjectCard({ project, now }: { project: ProjectSummary; now: Date }) {
  const workspacePath = `/p/${encodeURIComponent(project.slug)}`
  const blocking = project.awaiting.some(
    (question) => question.status === "open" && question.defaultAction === null,
  )
  return (
    <Card
      as="article"
      danger={blocking}
      data-workspace={project.slug}
      data-awaiting={String(project.awaiting.length)}
      class="flex flex-col gap-2 p-3"
    >
      <div class="flex min-w-0 flex-col gap-0.5">
        <div class="flex items-baseline gap-2">
          <h2 class="text-title min-w-0 flex-1 truncate font-medium text-ink">{project.slug}</h2>
          <MetaRow class="shrink-0">
            <span class={project.awaiting.length > 0 ? "text-primary-hover" : ""}>
              {project.awaiting.length} awaiting
            </span>
            <span>{project.inProgress} in progress</span>
          </MetaRow>
        </div>
        <p title={project.root} class="text-micro truncate font-mono text-ink-tertiary">
          {project.root}
        </p>
      </div>
      {project.awaiting.length > 0 ? (
        <ul class="flex flex-col">
          {project.awaiting.map((question) => (
            <AwaitingQuestionRow
              key={question.id}
              question={question}
              href={`${workspacePath}/dashboard#q-${encodeURIComponent(question.id)}`}
              now={now}
            />
          ))}
        </ul>
      ) : null}
      <div class="grid grid-cols-2 gap-2">
        <a href={`${workspacePath}/`} class={buttonClass("secondary", "md")}>
          Issues
        </a>
        <a href={`${workspacePath}/dashboard`} class={buttonClass("secondary", "md")}>
          Dashboard
        </a>
      </div>
    </Card>
  )
}
