import { Breadcrumb, type BreadcrumbItem } from "./breadcrumb"
import { Button } from "./button"
import { HeaderBar } from "./header-bar"
import { HIT_AREA_ICON_TOUCH } from "./hit-area"
import { IconButton } from "./icon-button"
import { LogoMark } from "./icons/logo-mark"
import { SidebarIcon } from "./icons/sidebar-icon"
import { LogoLink } from "./logo-link"

// 画面の見出しの帯。道筋と、更新があったときに中身を取り直すボタンを並べる。src/ui/page-header.tsx
// 読み直すボタン (#page-refresh) は最初は隠し、新しい質問が来たときに「N new — Show」にして見せる
// https://www.w3.org/TR/wai-aria-1.2/#status

export type PageRefresh = {
  hidden: boolean
  label: string
  onShow: () => void
}

export function PageHeader({
  breadcrumb,
  home = false,
  sidebarToggle = false,
  refresh,
  onOpenSidebar,
}: {
  breadcrumb: BreadcrumbItem[]
  home?: boolean
  sidebarToggle?: boolean
  refresh?: PageRefresh
  onOpenSidebar?: () => void
}) {
  return (
    <HeaderBar gap={3}>
      {home ? <LogoMark /> : <LogoLink class={sidebarToggle ? "md:hidden" : ""} />}
      {sidebarToggle ? (
        <IconButton
          id="sidebar-open"
          label="Open sidebar"
          aria-controls="sidebar"
          aria-expanded="false"
          class="hidden"
          onClick={onOpenSidebar}
        >
          <SidebarIcon />
        </IconButton>
      ) : null}
      <Breadcrumb items={breadcrumb} />
      {refresh ? (
        <div role="status" aria-live="polite" class="ml-auto shrink-0">
          <Button
            id="page-refresh"
            variant="primary"
            size="sm"
            class={HIT_AREA_ICON_TOUCH}
            hidden={refresh.hidden}
            onClick={refresh.onShow}
          >
            {refresh.label}
          </Button>
        </div>
      ) : null}
    </HeaderBar>
  )
}
