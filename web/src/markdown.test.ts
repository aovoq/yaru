import { describe, expect, test } from "vitest"
import { renderMarkdown, toggleTask } from "./markdown"

// src/markdown.test.ts をそのまま通す。期待する HTML は緩めない (docs/spec/security.md の「テスト」)
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

describe("issue references", () => {
  const issueHref = (id: string) => `/p/app/?id=${id}`

  test("#N outside code links to the issue on the same origin", () => {
    expect(renderMarkdown("#3 と (#12) を見る", { issueHref })).toBe(
      '<p><a href="/p/app/?id=3" data-issue="3">#3</a> と (<a href="/p/app/?id=12" data-issue="12">#12</a>) を見る</p>\n',
    )
    expect(renderMarkdown("- 親は #4", { issueHref })).toContain(
      '<a href="/p/app/?id=4" data-issue="4">#4</a>',
    )
  })

  test("#N inside code, links, and URLs is left alone", () => {
    for (const source of [
      "`#3`",
      "```\n#3\n```",
      "    #3 indented code",
      "[see #3](https://example.com)",
      "https://example.com/#3",
      "<https://example.com/#3>",
    ]) {
      expect(renderMarkdown(source, { issueHref })).toBe(renderMarkdown(source))
    }
    expect(renderMarkdown("[see #3](https://example.com)", { issueHref })).not.toContain(
      "data-issue",
    )
  })

  test("#N glued to a word, a longer word, or an entity is not a reference", () => {
    for (const source of ["abc#3", "#3abc", "&#35;3", "\\#3", "C#3", "#", "#abc"]) {
      expect(renderMarkdown(source, { issueHref })).not.toContain("data-issue")
    }
    expect(renderMarkdown("# 3", { issueHref })).toBe("<h1>3</h1>\n")
  })

  test("without a resolver the output is unchanged", () => {
    expect(renderMarkdown("#3 を見る")).toBe("<p>#3 を見る</p>\n")
  })

  test("a resolver that leaves the origin is not trusted", () => {
    for (const href of [
      "https://evil.example/",
      "//evil.example/",
      "/\\evil.example",
      "javascript:alert(1)",
    ]) {
      expect(renderMarkdown("#3", { issueHref: () => href })).toBe("<p>#3</p>\n")
    }
    expect(renderMarkdown("#3", { issueHref: () => '?id=3"x' })).toBe(
      '<p><a href="?id=3&quot;x" data-issue="3">#3</a></p>\n',
    )
  })
})

// docs/spec/security.md の決定 (2026-09-28): スキームの無い //host は拒否する。
// 許可スキームのとき、検査で読み飛ばした制御文字は href から除く。
describe("protocol-relative urls and skipped controls", () => {
  test("a scheme-less //host link is not a link", () => {
    expect(renderMarkdown("[ext](//evil.example/phish)")).toBe("<p>ext</p>\n")
    expect(renderMarkdown("[ext](//evil.example/phish)")).not.toContain("<a ")
  })

  test("a scheme-less //host image is dropped", () => {
    expect(renderMarkdown("![img](//evil.example/a.png)")).toBe("<p>img</p>\n")
    expect(renderMarkdown("![img](//evil.example/a.png)")).not.toContain("<img")
  })

  test("a leading control character does not hide a protocol-relative url", () => {
    expect(renderMarkdown("[ext](<\u0001//evil.example/phish>)")).toBe("<p>ext</p>\n")
  })

  test("control characters skipped while checking an allowed scheme are removed from the href", () => {
    expect(renderMarkdown("[tab](<ht\ttps://example.com/a>)")).toBe(
      '<p><a href="https://example.com/a" target="_blank" rel="noopener noreferrer">tab</a></p>\n',
    )
    expect(renderMarkdown("[ctl](<https://exa\u0001mple.com/>)")).toBe(
      '<p><a href="https://example.com/" target="_blank" rel="noopener noreferrer">ctl</a></p>\n',
    )
    expect(renderMarkdown("[gap](<https://example.com/a b>)")).toBe(
      '<p><a href="https://example.com/ab" target="_blank" rel="noopener noreferrer">gap</a></p>\n',
    )
  })

  test("a relative url is left unchanged when it has no scheme", () => {
    expect(renderMarkdown("[rel](/p/app/?id=1)")).toBe('<p><a href="/p/app/?id=1">rel</a></p>\n')
  })

  test("a slash mixed with a backslash does not leave the origin", () => {
    // WHATWG は /\ \/ \\ を // と読む。制御文字を飛ばしたあとも同じ。
    // https://url.spec.whatwg.org/#special-authority-slashes-state
    for (const source of [
      "[ext](/\\evil.com)",
      "[ext](<\\\\/host>)",
      "[ext](<\u0001/\\evil.com>)",
      "[ext](<\u0001\\\\/host>)",
    ]) {
      expect(renderMarkdown(source)).toBe("<p>ext</p>\n")
      expect(renderMarkdown(source)).not.toContain("evil.com")
      expect(renderMarkdown(source)).not.toContain("host")
    }
    expect(renderMarkdown("![img](/\\evil.com/a.png)")).toBe("<p>img</p>\n")
    expect(renderMarkdown("![img](/\\evil.com/a.png)")).not.toContain("<img")
    for (const href of ["\\/host", "\\\\evil.example", "/\\evil.example"]) {
      expect(renderMarkdown("#3", { issueHref: () => href })).toBe("<p>#3</p>\n")
    }
  })
})

// 決定で変えていない入力は、TS 版 (ts-final のタグの src/markdown.ts) と同じ HTML になる。右は TS 版が出した HTML
test("unchanged markdown matches the TypeScript renderer", () => {
  const cases: [string, string][] = [
    [
      "## 背景\n1 行目\n2 行目\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n`code`",
      "<h2>背景</h2>\n<p>1 行目<br>2 行目</p>\n<table>\n<thead>\n<tr>\n<th>a</th>\n<th>b</th>\n</tr>\n</thead>\n<tbody><tr>\n<td>1</td>\n<td>2</td>\n</tr>\n</tbody></table>\n<p><code>code</code></p>\n",
    ],
    [
      '<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\ntext <b onclick="x">b</b>',
      "&lt;script&gt;alert(1)&lt;/script&gt;&lt;img src=x onerror=&quot;alert(1)&quot;&gt;<p>text &lt;b onclick=&quot;x&quot;&gt;b&lt;/b&gt;</p>\n",
    ],
    [
      "[a](javascript:alert(1)) [b](https://example.com) [c](/p/app/?id=1) [d](mailto:x@example.com) [e](data:text/html,x)",
      '<p>a <a href="https://example.com" target="_blank" rel="noopener noreferrer">b</a> <a href="/p/app/?id=1">c</a> <a href="mailto:x@example.com">d</a> e</p>\n',
    ],
    ["[a](<jav\tascript:alert(1)>) [b](<\u0001javascript:alert(1)>)", "<p>a b</p>\n"],
    ["[c](jav&#x09;ascript:alert(1))", '<p><a href="jav&amp;#x09;ascript:alert(1)">c</a></p>\n'],
    [
      "![x](javascript:alert(1)) ![y](https://example.com/a.png)",
      '<p>x <img src="https://example.com/a.png" alt="y" loading="lazy"></p>\n',
    ],
    [
      "- [ ] first\n- [x] second",
      '<ul>\n<li><input type="checkbox" data-task-index="0"> first</li>\n<li><input type="checkbox" data-task-index="1" checked> second</li>\n</ul>\n',
    ],
    ["[rel](/p/app/?id=1)", '<p><a href="/p/app/?id=1">rel</a></p>\n'],
    ["[mail](mailto:x@example.com)", '<p><a href="mailto:x@example.com">mail</a></p>\n'],
    ["#3 を見る", "<p>#3 を見る</p>\n"],
  ]
  for (const [source, html] of cases) {
    expect(renderMarkdown(source)).toBe(html)
  }
})
