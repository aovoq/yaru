import { EmptyState } from "./components/empty-state"
import { HeaderBar } from "./components/header-bar"
import { LogoMark } from "./components/icons/logo-mark"
import { ProjectCard } from "./projects/project-card"
import type { Question } from "./questions"

// 1 つの yaru serve で配っている全ワークスペースの一覧。スマホで最初に開く画面
// どのプロジェクトで人の答えを待っているかを一目で分かるようにする
// ここが一覧 (/) そのものなので、見出しのロゴは LogoLink にせず、押せないロゴを置く

export type ProjectSummary = {
  slug: string
  root: string
  awaiting: Question[]
  inProgress: number
}

export function ProjectsPage({ projects }: { projects: ProjectSummary[] }) {
  const awaitingTotal = projects.reduce((total, project) => total + project.awaiting.length, 0)
  return (
    <div class="h-screen overflow-y-auto">
      <HeaderBar sticky>
        <LogoMark />
        <h1 class="text-[13px] font-medium text-ink">Projects</h1>
        <span class="ml-auto text-[11px] text-ink-tertiary">{awaitingTotal} awaiting answer</span>
      </HeaderBar>
      <main class="mx-auto flex max-w-2xl flex-col gap-3 px-4 pt-4 pb-16">
        {projects.length === 0 ? (
          <EmptyState>No workspaces yet. Run yaru in a workspace to add it here.</EmptyState>
        ) : (
          projects.map((project) => <ProjectCard project={project} />)
        )}
      </main>
    </div>
  )
}

// 答え待ちの質問が出たら一覧も更新する。全ワークスペースを見張るのは重いので、しばらくおきに読み直す
export const PROJECTS_AUTO_RELOAD = `setTimeout(()=>location.reload(),30000)`
