import { IssueId } from "../../components/issue-id"
import { LabelChip } from "../../components/label-chip"
import { RelativeTime } from "../../components/relative-time"
import { labelColors } from "../../components/tint"
import type { Issue } from "../../store"
import type { DraftField } from "../state"
import type { PageFilters } from "../view-model"
import { ParentValue } from "./parent-value"
import { PropRow } from "./prop-row"
import { PropertyPicker } from "./property-picker"
import { PropertyValueButton } from "./property-value-button"
import { issueOptions, labelOptions } from "./property-options"
import type { FieldErrors } from "./use-field-commit"

// issue 画面の属性のうち、よく変える 4 つ (key-properties.tsx) の残り。ラベル・親・止めている issue・止められている issue と、
// エージェントがどこで作業したか (ブランチ・作業ツリー・セッション)、作った時刻と更新した時刻
// スマホ幅では説明の下に、広い画面では右の欄のよく変える 4 つの下に置く
// 止められている issue (blocked by) は相手の issue の blocks なので、相手の issue を保存する (onPatchBlocks)

export function MoreProperties({
  issue,
  all,
  filters,
  now,
  errors,
  onCommit,
  onPatchBlocks,
}: {
  issue: Issue
  all: Issue[]
  filters: PageFilters
  now: Date
  errors: FieldErrors
  onCommit: (field: DraftField, value: string) => void
  // 相手の issue (issueId) の blocks を blocks に変える。渡されなければ止められている issue は見せるだけにする
  onPatchBlocks?: (issueId: string, blocks: string[]) => void
}) {
  const colors = labelColors(all.flatMap((row) => row.labels))
  const others = issueOptions(all, new Set([issue.id]))
  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
  const toggleBlockedBy = (otherId: string) => {
    const other = all.find((row) => row.id === otherId)
    if (!other || !onPatchBlocks) return
    onPatchBlocks(otherId, toggle(other.blocks, issue.id))
  }
  return (
    <div class="flex flex-col gap-0.5">
      <PropRow
        property="labels"
        label="Labels"
        labelId="issue-property-labels"
        error={errors.labels}
      >
        <PropertyPicker
          label="Labels"
          multiple
          placeholder="Add labels…"
          options={labelOptions(all, issue)}
          selected={issue.labels}
          onSelect={(label) => onCommit("labels", toggle(issue.labels, label).join(", "))}
          onCreate={(label) => onCommit("labels", [...issue.labels, label].join(", "))}
          createLabel={(label) => `Create label "${label}"`}
          trigger={(trigger) => (
            <PropertyValueButton
              trigger={trigger}
              labelledBy="issue-property-labels"
              empty={issue.labels.length === 0}
            >
              {issue.labels.length === 0 ? (
                "Add labels"
              ) : (
                <span class="flex flex-wrap gap-1">
                  {issue.labels.map((label) => (
                    <LabelChip key={label} label={label} color={colors.get(label)} />
                  ))}
                </span>
              )}
            </PropertyValueButton>
          )}
        />
      </PropRow>
      <PropRow
        property="parent"
        label="Parent"
        labelId="issue-property-parent"
        error={errors.parent}
      >
        <ParentValue
          issue={issue}
          all={all}
          filters={filters}
          labelledBy="issue-property-parent"
          onCommit={(value) => onCommit("parent", value)}
        />
      </PropRow>
      <PropRow
        property="blocks"
        label="Blocks"
        labelId="issue-property-blocks"
        error={errors.blocks}
      >
        <PropertyPicker
          label="Blocks"
          multiple
          placeholder="Search issues…"
          options={others}
          selected={issue.blocks}
          align="end"
          onSelect={(id) => onCommit("blocks", toggle(issue.blocks, id).join(", "))}
          trigger={(trigger) => (
            <PropertyValueButton
              trigger={trigger}
              labelledBy="issue-property-blocks"
              empty={issue.blocks.length === 0}
            >
              <IssueIds ids={issue.blocks} emptyText="Add blocked issues" />
            </PropertyValueButton>
          )}
        />
      </PropRow>
      {issue.id ? (
        <PropRow
          property="blockedBy"
          label="Blocked by"
          labelId="issue-property-blocked-by"
          error={errors.blockedBy}
        >
          {onPatchBlocks ? (
            <PropertyPicker
              label="Blocked by"
              multiple
              placeholder="Search issues…"
              options={others}
              selected={issue.blockedBy}
              align="end"
              onSelect={toggleBlockedBy}
              trigger={(trigger) => (
                <PropertyValueButton
                  trigger={trigger}
                  labelledBy="issue-property-blocked-by"
                  empty={issue.blockedBy.length === 0}
                >
                  <IssueIds ids={issue.blockedBy} emptyText="Add blocking issues" />
                </PropertyValueButton>
              )}
            />
          ) : (
            <span class="flex h-7 items-center px-2 text-body">
              <IssueIds ids={issue.blockedBy} emptyText="None" />
            </span>
          )}
        </PropRow>
      ) : null}
      {issue.branch ? (
        <PropRow property="branch" label="Branch" labelId="issue-property-branch">
          <span
            title={issue.branch}
            class="block h-7 truncate px-2 font-mono text-small leading-7 text-ink-muted"
          >
            {issue.branch}
          </span>
        </PropRow>
      ) : null}
      {issue.worktree ? (
        <PropRow property="worktree" label="Worktree" labelId="issue-property-worktree">
          <span
            title={issue.worktree}
            class="block h-7 truncate px-2 font-mono text-small leading-7 text-ink-muted"
          >
            {lastPathSegment(issue.worktree)}
          </span>
        </PropRow>
      ) : null}
      {issue.session ? (
        <PropRow property="session" label="Session" labelId="issue-property-session">
          <span
            title={issue.session}
            class="block h-7 truncate px-2 font-mono text-small leading-7 text-ink-muted"
          >
            {issue.session.slice(0, 8)}
          </span>
        </PropRow>
      ) : null}
      {issue.createdAt ? (
        <div class="mt-3 flex flex-col gap-1 border-t border-hairline pt-3 text-micro text-ink-tertiary">
          <RelativeTime at={issue.createdAt} now={now} prefix="Created " />
          {issue.updatedAt ? (
            <RelativeTime at={issue.updatedAt} now={now} prefix="Updated " />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

// 作業ツリーはフォルダの名前だけで見分けがつくので、最後の 1 段だけを出す。全体は title で読める
function lastPathSegment(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path
}

// 関係の issue の番号を並べる。無ければ emptyText を出す
function IssueIds({ ids, emptyText }: { ids: string[]; emptyText: string }) {
  if (ids.length === 0) return <>{emptyText}</>
  return (
    <span class="flex flex-wrap gap-x-1.5">
      {ids.map((id) => (
        <IssueId key={id} id={id} />
      ))}
    </span>
  )
}
