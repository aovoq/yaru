import type { Comment, Issue } from "../../store"

// issue 画面の活動欄に並べる項目を作る。状態が変わった出来事とコメントを、時刻順の 1 本の流れにする
// 時刻が同じときは作成 → 開始 → 完了 → コメントの順に並べる

export type ActivityEntry =
  | { kind: "event"; at: string; order: number; text: string; status: string }
  | { kind: "comment"; at: string; order: number; comment: Comment }

export function activityEntries(issue: Issue, comments: Comment[]): ActivityEntry[] {
  const entries: ActivityEntry[] = []
  if (issue.createdAt) {
    entries.push({
      kind: "event",
      at: issue.createdAt,
      order: 0,
      text: "created the issue",
      status: "todo",
    })
  }
  if (issue.startedAt) {
    entries.push({
      kind: "event",
      at: issue.startedAt,
      order: 1,
      text: "started working",
      status: "in_progress",
    })
  }
  if (issue.completedAt) {
    entries.push({
      kind: "event",
      at: issue.completedAt,
      order: 2,
      text: "completed the issue",
      status: "done",
    })
  }
  if (issue.canceledAt) {
    entries.push({
      kind: "event",
      at: issue.canceledAt,
      order: 2,
      text: "canceled the issue",
      status: "canceled",
    })
  }
  for (const comment of comments) {
    entries.push({ kind: "comment", at: comment.createdAt, order: 3, comment })
  }
  entries.sort((a, b) => a.at.localeCompare(b.at) || a.order - b.order)
  return entries
}
