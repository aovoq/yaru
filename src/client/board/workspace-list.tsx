import { FOCUS_RING } from "../../components/focus-ring"
import type { InboxWorkspace } from "../../inbox"

// ワークスペースの切り替え (workspace-switcher.tsx) の面の中身。各ワークスペースと、答えを待っている質問の数を並べる
// 今のワークスペースは aria-current で示す。読み込み中と読み込めなかったときは、その旨を 1 行で出す
// 開閉と分けておき、CSS の見本 (css.tsx) で開いた姿をそのまま描けるようにする

export type WorkspaceListState =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "loaded"; workspaces: InboxWorkspace[] }
  | { state: "failed" }

export function WorkspaceList({
  basePath,
  workspaces,
}: {
  basePath: string
  workspaces: WorkspaceListState
}) {
  return (
    <>
      <div class="text-micro px-2 pt-1 pb-1.5 font-medium text-ink-tertiary">Workspaces</div>
      {workspaces.state === "loaded" ? (
        workspaces.workspaces.map((workspace) => (
          <a
            data-workspace={workspace.slug}
            href={`${workspace.basePath}/`}
            aria-label={`${workspace.slug}, ${workspace.awaiting} awaiting answer`}
            aria-current={workspace.basePath === basePath ? "page" : undefined}
            class={`flex h-8 items-center gap-2 rounded-md px-2 text-ink-subtle no-underline hover:bg-surface-4 hover:text-ink aria-[current=page]:text-ink ${FOCUS_RING}`}
          >
            <span class="text-body min-w-0 flex-1 truncate">{workspace.slug}</span>
            <span
              class={`text-micro tabular-nums ${workspace.awaiting > 0 ? "text-primary-hover" : "text-ink-tertiary"}`}
            >
              {workspace.awaiting}
            </span>
          </a>
        ))
      ) : (
        <div role="status" class="text-small px-2 py-1.5 text-ink-tertiary">
          {workspaces.state === "failed" ? "Could not load workspaces" : "Loading…"}
        </div>
      )}
    </>
  )
}
