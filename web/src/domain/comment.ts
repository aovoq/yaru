// issue のコメント。板の詳細と issue の画面が読む形

export type Comment = {
  id: string
  issue: string
  parent: string | null
  author: string
  createdAt: string
  updatedAt: string
  body: string
}
