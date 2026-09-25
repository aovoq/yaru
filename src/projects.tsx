import type { Question } from "./questions"

// 1 つの yaru serve で配っている全ワークスペースの一覧。スマホで最初に開く画面
// どのプロジェクトで人の答えを待っているかを一目で分かるようにする

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
      <header class="sticky top-0 z-10 flex h-12 items-center gap-2 border-b border-hairline bg-canvas/90 px-4 backdrop-blur">
        <span class="grid size-5 shrink-0 place-items-center rounded-[5px] bg-primary text-[11px] font-semibold text-on-primary">
          y
        </span>
        <h1 class="text-[13px] font-medium text-ink">Projects</h1>
        <span class="ml-auto text-[11px] text-ink-tertiary">{awaitingTotal} awaiting answer</span>
      </header>
      <main class="mx-auto flex max-w-2xl flex-col gap-3 px-4 pt-4 pb-16">
        {projects.length === 0 ? (
          <p class="rounded-lg border border-dashed border-hairline px-3 py-4 text-center text-[13px] text-ink-tertiary">
            No workspaces yet. Run yaru in a workspace to add it here.
          </p>
        ) : (
          projects.map((project) => (
            <article
              data-workspace={project.slug}
              data-awaiting={String(project.awaiting.length)}
              class={`flex flex-col gap-2 rounded-lg border bg-surface-1 p-3 ${
                project.awaiting.some((question) => question.status === "expired")
                  ? "border-semantic-danger/40"
                  : "border-hairline"
              }`}
            >
              <div class="flex items-baseline gap-2">
                <a
                  href={`/p/${encodeURIComponent(project.slug)}/dashboard`}
                  class="min-w-0 flex-1 truncate text-[15px] font-medium text-ink no-underline hover:text-primary-hover"
                >
                  {project.slug}
                </a>
                <a
                  href={`/p/${encodeURIComponent(project.slug)}/`}
                  class="shrink-0 text-xs text-ink-subtle no-underline hover:text-ink"
                >
                  Issues
                </a>
              </div>
              <div class="flex flex-wrap gap-x-3 text-[11px] text-ink-tertiary">
                <span class={project.awaiting.length > 0 ? "text-primary-hover" : ""}>
                  {project.awaiting.length} awaiting answer
                </span>
                <span>{project.inProgress} in progress</span>
                <span class="truncate font-mono">{project.root}</span>
              </div>
              {project.awaiting.length > 0 ? (
                <ul class="flex flex-col gap-1">
                  {project.awaiting.map((question) => (
                    <li class="flex items-baseline gap-2 text-[13px]">
                      <span
                        class={`shrink-0 text-[11px] ${
                          question.status === "expired"
                            ? "text-semantic-danger"
                            : "text-ink-tertiary"
                        }`}
                      >
                        {question.status === "expired" ? "expired" : "open"}
                      </span>
                      <span class="min-w-0 flex-1 text-ink-muted">{question.title}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          ))
        )}
      </main>
    </div>
  )
}

// 答え待ちの質問が出たら一覧も更新する。全ワークスペースを見張るのは重いので、しばらくおきに読み直す
export const PROJECTS_AUTO_RELOAD = `setTimeout(()=>location.reload(),30000)`
