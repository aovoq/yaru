import { Marked, type Token, type Tokens } from "marked"

// issue・コメント・質問の本文を HTML にする。サーバーの描画とブラウザの両方で同じものを使う
// 本文はエージェントが外から取ってきた文章を貼ることがあり、画面は tailnet から開けて質問に答えられるので、
// 本文の中の HTML やスクリプトが動くと、人になりすましてエージェントへ指示を送れてしまう
// そのため生の HTML は文字として出し、リンクと画像は安全なスキームだけを通す
// https://github.github.com/gfm/

const SAFE_LINK_SCHEMES = ["http:", "https:", "mailto:"]
const SAFE_IMAGE_SCHEMES = ["http:", "https:"]

export function renderMarkdown(source: string): string {
  let taskIndex = 0
  const marked = new Marked({
    gfm: true,
    // Linear と同じく、1 回の改行もそのまま改行として見せる。エージェントの本文は 1 行ずつ書かれることが多いため
    breaks: true,
    renderer: {
      html({ text }) {
        return escapeHtml(text)
      },
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens)
        const safe = safeUrl(href, SAFE_LINK_SCHEMES)
        if (safe === null) return text
        const titleAttribute = title ? ` title="${escapeHtml(title)}"` : ""
        const external = /^(https?:)?\/\//i.test(safe)
          ? ' target="_blank" rel="noopener noreferrer"'
          : ""
        return `<a href="${escapeHtml(safe)}"${titleAttribute}${external}>${text}</a>`
      },
      image({ href, title, text }) {
        const safe = safeUrl(href, SAFE_IMAGE_SCHEMES)
        if (safe === null) return escapeHtml(text)
        const titleAttribute = title ? ` title="${escapeHtml(title)}"` : ""
        return `<img src="${escapeHtml(safe)}" alt="${escapeHtml(text)}"${titleAttribute} loading="lazy">`
      },
      checkbox({ checked }) {
        const index = taskIndex++
        return `<input type="checkbox" data-task-index="${index}"${checked ? " checked" : ""}> `
      },
    },
  })
  return marked.parse(source, { async: false })
}

// 描画した n 番目のチェックボックスに当たる本文の [ ] / [x] を反転する
// 正規表現で数えるとコードブロックの中の「- [ ]」まで数えてずれるので、描画と同じ字句解析で task の項目を順に拾う
export function toggleTask(source: string, index: number): string {
  const markers = taskMarkers(source)
  const marker = markers[index]
  if (marker === undefined) {
    throw new Error(`task not found: expected an index below ${markers.length}, actual ${index}`)
  }
  if (marker === null) {
    throw new Error(`task ${index} cannot be located in the source`)
  }
  const current = source[marker]
  const next = current === " " ? "x" : " "
  return source.slice(0, marker) + next + source.slice(marker + 1)
}

// task の項目ごとに、[ ] の中の 1 文字の位置を返す。本文の中で見つけられない項目 (引用の中など) は null にして番号をそろえる
function taskMarkers(source: string): (number | null)[] {
  const markers: (number | null)[] = []
  const walk = (tokens: Token[], start: number, searchable: boolean) => {
    let cursor = start
    for (const token of tokens) {
      const position = searchable ? source.indexOf(token.raw, cursor) : -1
      if (token.type === "list") {
        let itemCursor = position >= 0 ? position : cursor
        for (const item of (token as Tokens.List).items) {
          const itemPosition = position >= 0 ? source.indexOf(item.raw, itemCursor) : -1
          if (item.task) {
            const match =
              itemPosition >= 0 ? item.raw.match(/^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]/) : null
            markers.push(match ? itemPosition + match[0].length - 2 : null)
          }
          walk(item.tokens, itemPosition >= 0 ? itemPosition : itemCursor, itemPosition >= 0)
          if (itemPosition >= 0) itemCursor = itemPosition + item.raw.length
        }
      } else if ("tokens" in token && Array.isArray(token.tokens) && token.type === "blockquote") {
        // 引用の中の raw は > を外した文字列なので、本文の中では見つけられない
        walk(token.tokens, cursor, false)
      }
      if (position >= 0) cursor = position + token.raw.length
    }
  }
  walk(new Marked({ gfm: true }).lexer(source), 0, true)
  return markers
}

// ブラウザは URL のスキームの中のタブ・改行・制御文字を読み飛ばすので、それらを除いてからスキームを確かめる
// https://url.spec.whatwg.org/#concept-basic-url-parser
function safeUrl(href: string, schemes: string[]): string | null {
  const trimmed = href.trim()
  const scheme = trimmed.replace(/[\u0000-\u0020\u007f]/g, "").match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/)
  if (!scheme) return trimmed
  return schemes.includes(`${scheme[1]!.toLowerCase()}:`) ? trimmed : null
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}
