import { useCallback, useState } from "preact/hooks"
import { buttonClass } from "../components/button"
import { ChevronIcon } from "../components/icons/chevron-icon"
import { Popover } from "../components/popover"
import { useBoardApi } from "./board-api"
import { workspaceName } from "./view-model"
import { WorkspaceList, type WorkspaceListState } from "./workspace-list"

// サイドバーの上端のワークスペースの名前。押すと他のワークスペースの一覧を開き、答えを待っている質問の数を並べる
// 別のプロジェクトのエージェントが返事を待っていることに、今の板を開いたまま気づけるようにするため
// 一覧は開いたときに GetInbox から読む。描くたびに読むと、開かないときにも問い合わせてしまうため (docs/spec/routes.md の GetInbox)
// 面の中身は workspace-list.tsx が持つ
// 面をサイドバーの外へはみ出して開くため、枠で overflow を切って名前を詰めることができない。そこでボタンの幅の上限を、
// サイドバーの幅 (--sidebar-width) からロゴと畳むボタンと余白の分 (5.5rem) を引いた長さにして、長い名前を truncate で切る
// 1 つだけ配っているとき (basePath が空) は切り替える先が無く /api/inbox も無いので、名前だけを出す

export function WorkspaceSwitcher({ basePath }: { basePath: string }) {
  const name = workspaceName(basePath)
  const api = useBoardApi()
  const [open, setOpen] = useState(false)
  const [workspaces, setWorkspaces] = useState<WorkspaceListState>({ state: "idle" })
  const close = useCallback(() => setOpen(false), [])

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (!next) return
    setWorkspaces({ state: "loading" })
    void api.loadWorkspaces().then(
      (loaded) => setWorkspaces({ state: "loaded", workspaces: loaded }),
      () => setWorkspaces({ state: "failed" }),
    )
  }

  if (!basePath) {
    return <span class="text-body min-w-0 flex-1 truncate font-medium text-ink">{name}</span>
  }
  return (
    <span class="min-w-0 flex-1">
      <Popover
        open={open}
        onClose={close}
        trigger={
          <button
            id="workspace-switcher"
            type="button"
            aria-haspopup="dialog"
            aria-expanded={open ? "true" : "false"}
            onClick={toggle}
            class={buttonClass(
              "ghost",
              "sm",
              "max-w-[calc(var(--sidebar-width,14rem)-5.5rem)] min-w-0",
              { align: "start" },
            )}
          >
            <span class="truncate">{name}</span>
            <ChevronIcon />
          </button>
        }
      >
        <WorkspaceList basePath={basePath} workspaces={workspaces} />
      </Popover>
    </span>
  )
}
