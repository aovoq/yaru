// 画面の部品が読む issue の形。ファイルの読み書きは Go 側。型は src/store.ts:17-44 と同じ

export const PRIORITIES = ["urgent", "high", "medium", "low"] as const
export type Priority = (typeof PRIORITIES)[number]

export const STATUSES = ["backlog", "todo", "in_progress", "done", "canceled"] as const

export type Issue = {
  id: string
  title: string
  status: string
  assignee: string | null
  labels: string[]
  dueDate: string | null
  priority: Priority | null
  parent: string | null
  blocks: string[]
  blockedBy: string[]
  children: string[]
  startedAt: string | null
  completedAt: string | null
  canceledAt: string | null
  createdAt: string
  updatedAt: string
  session: string | null
  worktree: string | null
  branch: string | null
  stale: boolean
  body: string
}
