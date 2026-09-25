import { expect, test } from "bun:test"
import { renderMarkdown, toggleTask } from "./markdown"

test("renders GitHub flavored markdown with single newlines as line breaks", () => {
  const html = renderMarkdown(
    "## 背景\n1 行目\n2 行目\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n`code`",
  )
  expect(html).toContain("<h2>背景</h2>")
  expect(html).toContain("1 行目<br>2 行目")
  expect(html).toContain("<table>")
  expect(html).toContain("<code>code</code>")
})

test("raw HTML is shown as text instead of running", () => {
  const html = renderMarkdown(
    '<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\ntext <b onclick="x">b</b>',
  )
  expect(html).not.toContain("<script")
  expect(html).not.toContain("<img")
  expect(html).not.toContain("<b ")
  expect(html).toContain("&lt;script&gt;")
})

test("links only keep safe schemes and external ones open in a new tab", () => {
  const html = renderMarkdown(
    "[a](javascript:alert(1)) [b](https://example.com) [c](/p/app/?id=1) [d](mailto:x@example.com) [e](data:text/html,x)",
  )
  expect(html).not.toContain("javascript:")
  expect(html).not.toContain("data:text")
  expect(html).toContain(
    '<a href="https://example.com" target="_blank" rel="noopener noreferrer">b</a>',
  )
  expect(html).toContain('<a href="/p/app/?id=1">c</a>')
  expect(html).toContain('href="mailto:x@example.com"')
})

test("a scheme split by control characters is still treated as unsafe", () => {
  const html = renderMarkdown("[a](<jav\tascript:alert(1)>) [b](<\u0001javascript:alert(1)>)")
  expect(html).not.toContain("<a ")
  // 文字参照は href の中で展開されず、ただの相対パスの文字として残る
  expect(renderMarkdown("[c](jav&#x09;ascript:alert(1))")).toContain(
    'href="jav&amp;#x09;ascript:alert(1)"',
  )
})

test("images from unsafe schemes are dropped", () => {
  const html = renderMarkdown("![x](javascript:alert(1)) ![y](https://example.com/a.png)")
  expect(html).not.toContain("javascript:")
  expect(html).toContain('src="https://example.com/a.png"')
})

test("task list items render as checkboxes numbered in source order", () => {
  const html = renderMarkdown("- [ ] first\n- [x] second")
  expect(html).toContain('data-task-index="0"')
  expect(html).toMatch(/data-task-index="1"[^>]*checked|checked[^>]*data-task-index="1"/)
})

test("toggling a task flips only that item and ignores look-alikes inside code fences", () => {
  const source = "```\n- [ ] not a task\n```\n- [ ] first\n  - [x] nested\n- [ ] third"
  expect(toggleTask(source, 0)).toBe(
    "```\n- [ ] not a task\n```\n- [x] first\n  - [x] nested\n- [ ] third",
  )
  expect(toggleTask(source, 1)).toBe(
    "```\n- [ ] not a task\n```\n- [ ] first\n  - [ ] nested\n- [ ] third",
  )
  expect(toggleTask(source, 2)).toBe(
    "```\n- [ ] not a task\n```\n- [ ] first\n  - [x] nested\n- [x] third",
  )
  expect(() => toggleTask(source, 3)).toThrow("task not found: expected an index below 3, actual 3")
})
