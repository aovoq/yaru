import { useEffect } from "preact/hooks"
import { ErrorView } from "../components/error-view"
import { pageTitle } from "../domain/page-title"

// 知っている画面 path 以外と、登録に無いワークスペース。src/ui/error-view.tsx、src/web.tsx:494-500、src/web.tsx:566-570
export function NotFoundPage({
  pathname,
  knownSlugs,
}: {
  pathname: string
  knownSlugs?: ReadonlySet<string>
}) {
  useEffect(() => {
    document.title = pageTitle("Error")
  }, [])
  return (
    <div class="contents" data-screen="not-found">
      <ErrorView message={notFoundMessage(pathname, knownSlugs)} />
    </div>
  )
}

export function notFoundMessage(pathname: string, knownSlugs?: ReadonlySet<string>): string {
  const match = /^\/p\/([^/]+)(?:\/.*)?$/.exec(pathname)
  if (match === null || knownSlugs === undefined) return "not found"
  let slug: string
  try {
    slug = decodeURIComponent(match[1]!)
  } catch {
    return "not found"
  }
  if (!knownSlugs.has(slug)) return `workspace not found: ${slug}`
  return "not found"
}
