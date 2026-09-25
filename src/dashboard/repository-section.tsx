import { EmptyState } from "../components/empty-state"
import { ListBox } from "../components/list-box"
import { Pill } from "../components/pill"
import type { RepositoryState } from "../repository"
import { CommitRow } from "./commit-row"

// dashboard のコミットのまとまり。ブランチ、まだ送っていないコミット、書きかけのファイルを見出しの行にまとめて出す
// components/section.tsx の Section は使わず、専用の見出しを持つ
// Section の見出し (h2) は題名と件数しか入らず折り返さない。右端の aside も h2 の外に ml-auto で離して置くため、
// 状態の札を題名に続けて h2 の中で折り返して並べられない

export function RepositorySection({ repository, now }: { repository: RepositoryState; now: Date }) {
  return (
    <section class="flex flex-col gap-3">
      <h2 class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-medium text-ink">
        Commits
        <span class="font-mono text-[11px] font-normal text-ink-subtle">
          {repository.branch ?? "detached HEAD"}
        </span>
        {repository.upstream === null ? (
          <span class="text-[11px] font-normal text-ink-tertiary">no upstream</span>
        ) : repository.ahead ? (
          <Pill tone="primary" class="font-normal">
            {repository.ahead} not pushed
          </Pill>
        ) : null}
        {repository.behind ? (
          <span class="text-[11px] font-normal text-ink-tertiary">{repository.behind} behind</span>
        ) : null}
        {repository.uncommittedFiles > 0 ? (
          <span class="text-[11px] font-normal text-ink-tertiary">
            {repository.uncommittedFiles} uncommitted files
          </span>
        ) : null}
      </h2>
      {repository.commits.length === 0 ? (
        <EmptyState>No commits yet</EmptyState>
      ) : (
        <ListBox>
          {repository.commits.map((commit) => (
            <CommitRow commit={commit} now={now} />
          ))}
        </ListBox>
      )}
    </section>
  )
}
