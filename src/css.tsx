import { compile } from "tailwindcss"
import tw from "tailwindcss/index.css" with { type: "text" }
import { BLANK, BoardPage, Document, ErrorView } from "./ui"

const INPUT = `@import "tailwindcss";
@theme {
  --color-ink: #f7f8f8;
  --color-ink-muted: #d0d6e0;
  --color-ink-subtle: #8a8f98;
  --color-ink-tertiary: #62666d;
  --color-canvas: #010102;
  --color-surface-1: #0f1011;
  --color-surface-2: #141516;
  --color-surface-3: #18191a;
  --color-surface-4: #191a1b;
  --color-hairline: #23252a;
  --color-hairline-strong: #34343a;
  --color-primary: #5e6ad2;
  --color-primary-hover: #828fff;
  --color-primary-focus: #5e69d1;
  --color-on-primary: #ffffff;
  --color-semantic-success: #27a644;
  --font-sans: Inter, "SF Pro Display", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, monospace;
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
}
`

let cached: Promise<string> | undefined

export function styles(): Promise<string> {
  cached ??= build()
  return cached
}

async function build(): Promise<string> {
  const compiler = await compile(INPUT, {
    loadStylesheet: async (id, base) => {
      if (id === "tailwindcss") return { path: id, base, content: tw }
      throw new Error(`unknown stylesheet: ${id}`)
    },
  })
  const sample = await sampleHtml()
  return compiler.build(candidates(sample))
}

async function sampleHtml(): Promise<string> {
  const issue = { ...BLANK, id: "1", title: "x", labels: ["a"], assignee: "me", body: "b" }
  const node = (
    <Document css="">
      <BoardPage
        issues={[issue]}
        query="q"
        current={issue}
        status="todo"
        assignee="me"
        label="a"
        error="title is required"
      />
      <BoardPage issues={[issue]} query="q" current={null} view="list" />
      <ErrorView message="x" />
    </Document>
  )
  return String(await node)
}

function candidates(source: string): string[] {
  const out = new Set<string>()
  for (const m of source.matchAll(/class="([^"]*)"/g)) {
    for (const token of m[1].split(/\s+/)) {
      if (token) out.add(token)
    }
  }
  return [...out]
}
