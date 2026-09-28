import { TextLink } from "../components/text-link"

// 知っている画面 path 以外。戻りは / (src/ui/error-view.tsx:7、docs/spec/routes.md の 404)
export function NotFoundPage() {
  return (
    <main data-screen="not-found">
      <h1 class="text-title">Not found</h1>
      <TextLink href="/">Projects</TextLink>
    </main>
  )
}
