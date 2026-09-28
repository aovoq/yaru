// 書きかけの答え。鍵は回答フォームの id。src/ui/live-page.ts:71-100
// dashboard は yaru.drafts:<basePath>/dashboard、受信箱は yaru.drafts:/inbox (src/web.tsx:455、src/web.tsx:547)

export function dashboardDraftKey(basePath: string): string {
  return `yaru.drafts:${basePath}/dashboard`
}

export const INBOX_DRAFT_KEY = "yaru.drafts:/inbox"

export function readAnswerDrafts(storageKey: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? "{}")
    if (parsed === null || typeof parsed !== "object") return {}
    const drafts: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") drafts[key] = value
    }
    return drafts
  } catch {
    return {}
  }
}

export function writeAnswerDrafts(storageKey: string, drafts: Record<string, string>): void {
  try {
    const stored: Record<string, string> = {}
    for (const [key, value] of Object.entries(drafts)) {
      if (value.trim() !== "") stored[key] = value
    }
    sessionStorage.setItem(storageKey, JSON.stringify(stored))
  } catch {
    // sessionStorage が書けないときは、この画面を開いている間だけ書きかけを持つ
  }
}

export function answerFormIdOf(formId: string): string {
  return formId.replace(/^cancel-question-/, "answer-question-").replace(/-option$/, "")
}

export function draftText(
  drafts: Readonly<Record<string, string>> | undefined,
  formId: string,
  returnedAnswer: string | undefined,
): string | undefined {
  if (drafts !== undefined && Object.prototype.hasOwnProperty.call(drafts, formId)) {
    return drafts[formId]
  }
  if (returnedAnswer) return returnedAnswer
  return undefined
}
