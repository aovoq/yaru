import { renderToString } from "preact-render-to-string"
import { expect, test } from "vitest"
import { App } from "./app"

function html(href: string, knownSlugs?: ReadonlySet<string>): string {
  return renderToString(<App href={href} knownSlugs={knownSlugs} />)
}

test("each screen path renders its placeholder and unknown paths render not found", () => {
  expect(html("http://127.0.0.1/")).toContain('data-screen="projects"')
  expect(
    html("http://127.0.0.1/inbox?workspace=app&q=1&error=e&answer=a&answered=2#q-app-1"),
  ).toContain('data-screen="inbox"')
  expect(html("http://127.0.0.1/inbox?workspace=app&q=1")).toContain('data-workspace="app"')
  expect(html("http://127.0.0.1/inbox?workspace=app&q=1")).toContain('data-question="1"')
  expect(html("http://127.0.0.1/inbox?workspace=app&q=1#q-app-1")).toContain(
    'data-fragment="q-app-1"',
  )
  expect(html("http://127.0.0.1/p/app/")).toContain('data-screen="board"')
  expect(html("http://127.0.0.1/p/app/?id=12&error=missing")).toContain('data-issue="12"')
  expect(html("http://127.0.0.1/p/app/dashboard?q=3&answered=3")).toContain(
    'data-screen="dashboard"',
  )
  expect(html("http://127.0.0.1/p/app/dashboard?q=3")).toContain('data-question="3"')
  expect(html("http://127.0.0.1/terminal")).toContain('data-screen="terminal"')
  expect(html("http://127.0.0.1/terminal")).toContain('data-csp-style="unsafe-inline"')
  expect(html("http://127.0.0.1/")).not.toContain('data-csp-style="unsafe-inline"')
  expect(html("http://127.0.0.1/missing")).toContain('data-screen="not-found"')
  expect(html("http://127.0.0.1/p/app/nope")).toContain('data-screen="not-found"')
})

test("an unregistered slug renders not found and a registered slug without a slash renders the board", () => {
  const knownSlugs = new Set(["app"])
  expect(html("http://127.0.0.1/p/missing/", knownSlugs)).toContain('data-screen="not-found"')
  expect(html("http://127.0.0.1/p/app", knownSlugs)).toContain('data-screen="board"')
  expect(html("http://127.0.0.1/p/app", knownSlugs)).toContain('data-slug="app"')
  expect(html("http://127.0.0.1/inbox#not a fragment")).not.toContain("data-fragment")
})
