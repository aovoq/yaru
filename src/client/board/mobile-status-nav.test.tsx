import { expect, test } from "bun:test"
import { renderToString } from "preact-render-to-string"
import { MobileStatusNav } from "./mobile-status-nav"

function nav(filters: Parameters<typeof MobileStatusNav>[0]["filters"]) {
  return renderToString(
    <MobileStatusNav filters={filters} labelColors={new Map([["ui", "#123456"]])} />,
  )
}

test("phones see the active filters as removable chips", () => {
  const html = nav({ basePath: "/p/app", label: "ui", awaiting: true, query: "bug" })
  expect(html).toContain('href="/p/app/?query=bug&amp;awaiting=1"')
  expect(html).toContain('href="/p/app/?label=ui&amp;awaiting=1"')
  expect(html).toContain('href="/p/app/?query=bug&amp;label=ui"')
  expect(html).toContain("background: #123456")
})

test("without filters there is no chip row", () => {
  expect(nav({ basePath: "/p/app" })).not.toContain("data-filter-chips")
})

test("the chosen status chip is marked as the current page", () => {
  const html = nav({ basePath: "/p/app", status: "todo" })
  expect(html).toContain('href="/p/app/" class')
  expect(html).toMatch(/aria-current="page"[^>]*>[\s\S]{0,300}Todo/)
})
