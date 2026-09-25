import { Section } from "../components/section"
import { EmptyState } from "../components/empty-state"
import { ListBox } from "../components/list-box"
import { Pill } from "../components/pill"
import type { RepositoryState } from "../repository"
import { CommitRow } from "./commit-row"

// dashboard のコミットのまとまり。ブランチ、まだ送っていないコミット、書きかけのファイルを見出しの行にまとめて出す
// components/section.tsx の Section は使わず、専用の見出しを持つ

export function RepositorySection({ repository, now }: { repository: RepositoryState; now: Date }) {
  return (
    <Section
      title="Commits"
      meta={
        <>
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
            <span class="text-[11px] font-normal text-ink-tertiary">
              {repository.behind} behind
            </span>
          ) : null}
          {repository.uncommittedFiles > 0 ? (
            <span class="text-[11px] font-normal text-ink-tertiary">
              {repository.uncommittedFiles} uncommitted files
            </span>
          ) : null}
        </>
      }
    >
      {repository.commits.length === 0 ? (
        <EmptyState>No commits yet</EmptyState>
      ) : (
        <ListBox>
          {repository.commits.map((commit) => (
            <CommitRow commit={commit} now={now} />
          ))}
        </ListBox>
      )}
    </Section>
  )
}
