// dashboard の git。型は src/repository.ts:4-20 と同じ

export type RepositoryCommit = {
  hash: string
  subject: string
  author: string
  committedAt: string
  pushed: boolean | null
}

export type RepositoryState = {
  branch: string | null
  upstream: string | null
  ahead: number | null
  behind: number | null
  uncommittedFiles: number
  commits: RepositoryCommit[]
}
