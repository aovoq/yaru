// 板の並べ方・まとめ方・終わった issue の見せ方。既定は src/issue-order.ts と同じ
// 並べ替え自体は GetPage が行う (docs/spec/routes.md の GetPage)

export const ISSUE_SORTS = ["priority", "updated", "created", "due"] as const
export type IssueSort = (typeof ISSUE_SORTS)[number]

export const ISSUE_GROUPS = ["status", "priority", "label", "none"] as const
export type IssueGroup = (typeof ISSUE_GROUPS)[number]

export const COMPLETED_VISIBILITIES = ["hide", "recent", "all"] as const
export type CompletedVisibility = (typeof COMPLETED_VISIBILITIES)[number]

export type IssueDisplay = {
  sort: IssueSort
  group: IssueGroup
  completed: CompletedVisibility
}

export const DEFAULT_ISSUE_DISPLAY: IssueDisplay = {
  sort: "priority",
  group: "status",
  completed: "recent",
}
