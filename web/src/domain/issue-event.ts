// issue の属性の変更の記録。板の詳細と issue の画面の活動に出す

// 変更の前後。文字列、文字列の配列、または null
export type IssueEventValue = string | string[] | null

export type IssueEvent = {
  field: string
  from: IssueEventValue
  to: IssueEventValue
  by: string
  session: string | null
  at: string
}
