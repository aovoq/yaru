import { LogoLink } from "../components/logo-link"

// プロジェクト一覧の仮画面。中身は次の担当が ListProjects で描く (docs/spec/routes.md の SPA の /)
export function ProjectsPage() {
  return (
    <main data-screen="projects" class="flex h-full flex-col">
      <header class="flex items-center px-4 pt-safe">
        <LogoLink />
      </header>
      <h1 class="px-4 text-title">Projects</h1>
    </main>
  )
}
