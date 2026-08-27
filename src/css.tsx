import { compile } from "tailwindcss"
import tw from "tailwindcss/index.css" with { type: "text" }
import { BLANK, BoardPage, Document, ErrorView } from "./ui"

const INPUT = `@import "tailwindcss";
@theme {
  --color-ink: #1c1917;
  --color-muted: #78716c;
  --color-line: #e7e0d6;
  --color-paper: #f6f1e8;
  --color-card: #fffdf8;
  --color-accent: #b42318;
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
  const issue = { ...BLANK, id: "YAR-1", title: "x", labels: ["a"], assignee: "me", body: "b" }
  const node = (
    <Document css="">
      <BoardPage issues={[issue]} query="q" current={issue} />
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
