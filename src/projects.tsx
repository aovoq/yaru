import { EmptyState } from "./components/empty-state"
import { currentTime } from "./time"
import { InboxLink } from "./projects/inbox-link"
import { ProjectCard } from "./projects/project-card"
import type { Question } from "./questions"
import { PageHeader } from "./ui/page-header"
import { PageShell } from "./ui/page-shell"

// 1 つの yaru serve で配っている全ワークスペースの一覧。スマホで最初に開く画面
// どのプロジェクトで人の答えを待っているかを一目で分かるようにし、全てを 1 か所で答えられる受信箱 (/inbox) へ先に誘う

export type ProjectSummary = {
  slug: string
  root: string
  // 答えを待っている質問。人が先に見るべき順 (questions.ts の compareQuestions) に並べておく
  awaiting: Question[]
  inProgress: number
}

export function ProjectsPage({
  projects,
  now = currentTime(),
}: {
  projects: ProjectSummary[]
  now?: Date
}) {
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

// 答え待ちの質問が出たら一覧も更新する。全ワークスペースを見張るのは重いので、しばらくおきに読み直す
// 一覧には書きかけにする欄が無いので、読み直しても失うものは無い
export const PROJECTS_AUTO_RELOAD = `setTimeout(()=>location.reload(),30000)`
