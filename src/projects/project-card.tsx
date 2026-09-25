import { buttonClass } from "../components/button"
import { Card } from "../components/card"
import { MetaRow } from "../components/meta-row"
import type { ProjectSummary } from "../projects"
import { AwaitingQuestionRow } from "./awaiting-question-row"

// プロジェクトの一覧の 1 件。名前と件数を上に、フォルダの場所を 1 行に切り詰めて置き、答え待ちの質問を急ぐ順に並べる
// 板 (Issues) と dashboard へは、同じ重さの 2 つのボタンで行けるようにする。どちらが主とは決まっていないため
// 答えるまでエージェントが止まっている質問 (Blocking) があれば、先に開いてほしいのでカードの左端に危険の色の帯を引く
// フォルダの場所は長いので等幅の 1 行にして切り詰め、hover で全体を読めるよう title に入れる

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
