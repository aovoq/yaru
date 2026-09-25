import { ANSWER_SHORTCUT_SCRIPT } from "../components/question-answer"
import { relativeTime } from "../time"

// スクリプトで描き直さない画面 (dashboard と /inbox) を、開いたままでも古くならず、書きかけの答えも失わないようにする inline script
// 板のクライアント (app.js) を読まずに、サーバーで描いた HTML のまま次のことをする
//
// - 書きかけの答えを sessionStorage に残し、読み直しても回答欄に戻す。答えを送ったらその質問の書きかけは消す
//   鍵はカードのフォームの id (question-answer.ts) にする。並び順で覚えると、質問が増えたときに別の質問へ移るため
// - 新しい質問が来たら、入力中でなければそのまま読み直し、入力中なら「N new — Show」のボタン (#page-refresh) を出して押すまで待つ
//   dashboard はサーバーからの更新の知らせ (SSE) を受け、/inbox は全ワークスペースを見張れないのでしばらくおきに API を読む
// - 相対時刻 (time[data-relative]) を毎分書き換え、期限を過ぎた答え待ちの質問 ([data-answer-by]) があれば読み直しを促す
// - 答えた直後の知らせ (#answer-toast) の読み上げの文を読み込んだ後に入れ、取り消せる時間が過ぎたら消す
// - fragment で飛んだ先が閉じた details (既定で進んだ質問) の中なら開く
// - 左のサイドバーの畳む・開く・幅を変える操作と、ワークスペースの切り替えを効かせる。板と違い preact が動かないので onClick が付かないため
// - 回答欄の Cmd+Enter で答えを送る (ANSWER_SHORTCUT_SCRIPT)
//
// 関数の本体を文字列にして埋め込むので、livePage の中から外の変数や import を参照しないこと (相対時刻は引数で渡す)
// https://html.spec.whatwg.org/multipage/server-sent-events.html

export type LivePageWatch =
  // dashboard: SSE の知らせを受けたら、答え待ちの質問を API (Question[]) で読み直して数える
  | { type: "events"; eventsUrl: string; questionsUrl: string }
  // /inbox: しばらくおきに API (Inbox) を読み、答え待ちの質問の顔ぶれが変わったら数える
  | { type: "poll"; inboxUrl: string; intervalMilliseconds: number }

export type LivePageConfig = {
  watch: LivePageWatch
  // 書きかけの答えを残す sessionStorage の鍵。画面ごとに分ける
  draftStorageKey: string
}

// 戻ってきたときの一度きりの知らせ (失敗の理由・書きかけ・答えた質問) の query。読み直しで何度も出ないよう、読み込んだら URL から外す
const RETURN_PARAMETERS = ["error", "q", "answer", "workspace", "answered"]

const SIDEBAR_MIN = 160
const SIDEBAR_MAX = 280

export function livePageScript(config: LivePageConfig): string {
  const settings = {
    ...config,
    returnParameters: RETURN_PARAMETERS,
    sidebarMin: SIDEBAR_MIN,
    sidebarMax: SIDEBAR_MAX,
  }
  return `(${livePage.toString()})(${JSON.stringify(settings)},${relativeTime.toString()});${ANSWER_SHORTCUT_SCRIPT}`
}

type LivePageSettings = LivePageConfig & {
  returnParameters: string[]
  sidebarMin: number
  sidebarMax: number
}

type InboxResponse = {
  groups: Record<string, { anchor: string }[]>
}

type QuestionResponse = { id: string; status: string }

// 返す関数は見張り (SSE と setInterval) を止める。画面では止めることは無く、テストが後始末に使う
export function livePage(
  settings: LivePageSettings,
  relative: (iso: string, now: Date) => string,
): () => void {
  const timers: ReturnType<typeof setInterval>[] = []
  let source: EventSource | undefined
  const answerBoxes = () => [
    ...document.querySelectorAll<HTMLTextAreaElement>("textarea[data-answer-shortcut][form]"),
  ]

  const readDrafts = (): Record<string, string> => {
    try {
      const parsed: unknown = JSON.parse(sessionStorage.getItem(settings.draftStorageKey) ?? "{}")
      return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {}
    } catch {
      return {}
    }
  }
  const writeDrafts = (drafts: Record<string, string>) => {
    try {
      sessionStorage.setItem(settings.draftStorageKey, JSON.stringify(drafts))
    } catch {}
  }
  const saveDrafts = () => {
    const drafts: Record<string, string> = {}
    for (const box of answerBoxes()) {
      if (box.value.trim() !== "") drafts[box.getAttribute("form")!] = box.value
    }
    writeDrafts(drafts)
  }

  // 読み込んだら書きかけを戻す。サーバーが返した書きかけ (?answer=) がある欄はそちらを優先する
  // 答え待ちから外れた質問の書きかけは、戻す先が無いので捨てる
  const restoreDrafts = () => {
    const drafts = readDrafts()
    for (const box of answerBoxes()) {
      const draft = drafts[box.getAttribute("form")!]
      if (draft !== undefined && box.value === "") box.value = draft
    }
    saveDrafts()
  }

  // 選択肢のフォーム (…-option) と取り下げのフォーム (cancel-question-…) も、同じ質問の回答欄の書きかけを消す
  const answerFormIdOf = (formId: string) =>
    formId.replace(/^cancel-question-/, "answer-question-").replace(/-option$/, "")

  document.addEventListener("input", (event) => {
    if (
      event.target instanceof HTMLTextAreaElement &&
      event.target.hasAttribute("data-answer-shortcut")
    ) {
      saveDrafts()
    }
  })
  document.addEventListener(
    "submit",
    (event) => {
      if (!(event.target instanceof HTMLFormElement) || !event.target.id) return
      const drafts = readDrafts()
      delete drafts[answerFormIdOf(event.target.id)]
      writeDrafts(drafts)
    },
    true,
  )

  const cleanReturnParameters = () => {
    const url = new URL(location.href)
    let changed = false
    for (const name of settings.returnParameters) {
      if (url.searchParams.has(name)) {
        url.searchParams.delete(name)
        changed = true
      }
    }
    if (changed) history.replaceState(history.state, "", url.toString())
  }

  // 取り消しを押せる間も、書きかけと同じく読み直しを待つ。答えた直後は回答欄が無いので、すぐ読み直すと取り消しの知らせが消えるため
  const editing = () =>
    document.querySelector("#answer-toast [data-undo-until]") !== null ||
    answerBoxes().some((box) => box.value.trim() !== "" || box === document.activeElement)

  const refreshButton = () => document.getElementById("page-refresh")
  const reload = () => {
    saveDrafts()
    location.reload()
  }
  // 入力中でなければすぐ読み直し、入力中なら押すまで待つボタンを出す
  const announceChange = (text: string) => {
    if (!editing()) {
      reload()
      return
    }
    const button = refreshButton()
    if (!button) return
    button.textContent = text
    button.hidden = false
  }
  refreshButton()?.addEventListener("click", reload)

  const renderedAnchors = () =>
    new Set(
      (document.querySelector<HTMLElement>("[data-awaiting-ids]")?.dataset.awaitingIds ?? "")
        .split(" ")
        .filter(Boolean),
    )
  const describeChange = (anchors: string[]) => {
    const rendered = renderedAnchors()
    const added = anchors.filter((anchor) => !rendered.has(anchor)).length
    return added > 0 ? `${added} new — Show` : "Updated — Show"
  }

  const watch = settings.watch
  if (watch.type === "events") {
    source = new EventSource(watch.eventsUrl)
    source.onmessage = async () => {
      try {
        const response = await fetch(watch.questionsUrl)
        const questions = (await response.json()) as { questions: QuestionResponse[] }
        const anchors = questions.questions
          .filter((question) => question.status === "open" || question.status === "expired")
          .map((question) => `q-${question.id}`)
        announceChange(describeChange(anchors))
      } catch {
        announceChange("Updated — Show")
      }
    }
  } else {
    const same = (first: Set<string>, second: string[]) =>
      first.size === second.length && second.every((anchor) => first.has(anchor))
    const poll = setInterval(async () => {
      try {
        const response = await fetch(watch.inboxUrl)
        const inbox = (await response.json()) as InboxResponse
        const anchors = Object.values(inbox.groups).flatMap((items) =>
          items.map((item) => item.anchor),
        )
        if (!same(renderedAnchors(), anchors)) announceChange(describeChange(anchors))
      } catch {}
    }, watch.intervalMilliseconds)
    timers.push(poll)
  }

  // 毎分、相対時刻を書き換える。期限を過ぎた答え待ちの質問があれば、既定で進んだまとまりへ移すために読み直しを促す
  const tick = () => {
    const now = new Date()
    for (const time of document.querySelectorAll<HTMLTimeElement>("time[data-relative]")) {
      time.textContent = `${time.dataset.prefix ?? ""}${relative(time.dateTime, now)}`
    }
    const passed = [...document.querySelectorAll<HTMLElement>("[data-answer-by]")].some(
      (card) => Date.parse(card.dataset.answerBy ?? "") <= now.getTime(),
    )
    if (passed) announceChange("Deadline passed — Show")
  }
  timers.push(setInterval(tick, 60_000))

  // 答えた直後の知らせ。読み込んでから文を入れると、読み上げが live region の変化として読む
  const toast = document.getElementById("answer-toast")
  if (toast) {
    const announce = toast.querySelector<HTMLElement>("[data-announce]")
    setTimeout(() => {
      if (announce) announce.textContent = announce.dataset.announce ?? ""
    }, 100)
    const undo = toast.querySelector<HTMLElement>("[data-undo-until]")
    if (undo) {
      setTimeout(
        () => undo.remove(),
        Math.max(0, Date.parse(undo.dataset.undoUntil ?? "") - Date.now()),
      )
    }
    setTimeout(
      () => toast.remove(),
      Math.max(0, Date.parse(toast.dataset.toastExpiresAt ?? "") - Date.now()),
    )
  }

  // fragment の先が閉じた details の中なら開き、開いてからもう一度その位置へ流す
  const revealTarget = () => {
    const id = decodeURIComponent(location.hash.slice(1))
    const target = id ? document.getElementById(id) : null
    if (!target) return
    let opened = false
    for (let element = target.parentElement; element; element = element.parentElement) {
      if (element instanceof HTMLDetailsElement && !element.open) {
        element.open = true
        opened = true
      }
    }
    if (opened) target.scrollIntoView({ block: "start" })
  }
  window.addEventListener("hashchange", revealTarget)

  // 左のサイドバーの開閉と幅。板 (use-sidebar-preference.ts) と同じ localStorage の鍵と html の属性を使い、画面をまたいで揃える
  const root = document.documentElement
  const setSidebarOpen = (open: boolean) => {
    if (open) root.removeAttribute("data-sidebar")
    else root.setAttribute("data-sidebar", "closed")
    try {
      localStorage.setItem("yaru.sidebar.open", open ? "1" : "0")
    } catch {}
  }
  // サイドバーのワークスペースの切り替えは板では一覧を開くが、ここでは preact が動かず開けないので、全ワークスペースの一覧 (/) へ移る
  document
    .getElementById("workspace-switcher")
    ?.addEventListener("click", () => location.assign("/"))
  document.getElementById("sidebar-toggle")?.addEventListener("click", () => setSidebarOpen(false))
  document.getElementById("sidebar-open")?.addEventListener("click", () => setSidebarOpen(true))
  document.getElementById("sidebar-resizer")?.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return
    event.preventDefault()
    root.setAttribute("data-resizing", "")
    const onMove = (move: PointerEvent) => {
      if (move.clientX < settings.sidebarMin) {
        setSidebarOpen(false)
        return
      }
      setSidebarOpen(true)
      const width = Math.min(
        settings.sidebarMax,
        Math.max(settings.sidebarMin, Math.round(move.clientX)),
      )
      root.style.setProperty("--sidebar-width", `${width}px`)
      try {
        localStorage.setItem("yaru.sidebar.width", String(width))
      } catch {}
    }
    const onUp = () => {
      root.removeAttribute("data-resizing")
      document.removeEventListener("pointermove", onMove)
      document.removeEventListener("pointerup", onUp)
    }
    document.addEventListener("pointermove", onMove)
    document.addEventListener("pointerup", onUp)
  })

  restoreDrafts()
  cleanReturnParameters()
  revealTarget()
  return () => {
    for (const timer of timers) clearInterval(timer)
    source?.close()
  }
}
