import { Card } from "../components/card"
import { MetaRow } from "../components/meta-row"
import { TextLink } from "../components/text-link"
import type { ProjectSummary } from "../projects"
import { AwaitingQuestionRow } from "./awaiting-question-row"

// プロジェクトの一覧の 1 件。名前から dashboard を、「Issues」から板を開き、答え待ちの質問を題名だけ並べる
// 期限切れの質問があれば、先に答えてほしいのでカードの枠を赤くする
// 名前のリンクは本文の大きさで、hover で primary の色に変わる。TextLink の 2 つの tone のどちらにも当たらないので直接書く

export function ProjectCard({ project }: { project: ProjectSummary }) {
  const workspacePath = `/p/${encodeURIComponent(project.slug)}`
  return (
    <Card
      as="article"
      danger={project.awaiting.some((question) => question.status === "expired")}
      data-workspace={project.slug}
      data-awaiting={String(project.awaiting.length)}
      class="flex flex-col gap-2 p-3"
    >
      <div class="flex items-baseline gap-2">
        <a
          href={`${workspacePath}/dashboard`}
          class="min-w-0 flex-1 truncate text-[15px] font-medium text-ink no-underline hover:text-primary-hover"
        >
          {project.slug}
        </a>
        <TextLink href={`${workspacePath}/`} size="xs" class="shrink-0">
          Issues
        </TextLink>
      </div>
      <MetaRow>
        <span class={project.awaiting.length > 0 ? "text-primary-hover" : ""}>
          {project.awaiting.length} awaiting answer
        </span>
        <span>{project.inProgress} in progress</span>
        <span class="truncate font-mono">{project.root}</span>
      </MetaRow>
      {project.awaiting.length > 0 ? (
        <ul class="flex flex-col gap-1">
          {project.awaiting.map((question) => (
            <AwaitingQuestionRow question={question} />
          ))}
        </ul>
      ) : null}
    </Card>
  )
}
