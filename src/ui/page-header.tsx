import { Breadcrumb, type BreadcrumbItem } from "../components/breadcrumb"
import { Button } from "../components/button"
import { HeaderBar } from "../components/header-bar"
import { HIT_AREA_ICON_TOUCH } from "../components/hit-area"
import { IconButton } from "../components/icon-button"
import { LogoMark } from "../components/icons/logo-mark"
import { SidebarIcon } from "../components/icons/sidebar-icon"
import { LogoLink } from "../components/logo-link"

// サーバーで描く画面の見出しの帯。いまの画面までの道筋 (Breadcrumb) と、更新があったときに読み直すボタンを並べる
// スマホ幅ではサイドバーが無いので、ロゴから一覧 (/) へ戻れるようにする。一覧 (/) そのもの (home) では押せないロゴを置く
// サイドバーを持つ画面 (dashboard) は、畳んだサイドバーを開き直すボタンも置く。最初は hidden で隠し、
// css.tsx の html[data-sidebar="closed"] #sidebar-open が md 以上の幅で見せる。押したときの動きは live-page.ts が付ける
// 読み直すボタン (#page-refresh) は最初は隠し、新しい質問が来たときに live-page.ts が「N new — Show」にして見せる
// 指で押す端末では 28px の高さでは小さいので、押せる範囲だけを 44px に広げる (hit-area.ts)
// 見せたことを読み上げでも伝えるよう、ボタンを live region で包む https://www.w3.org/TR/wai-aria-1.2/#status

export function PageHeader({
  breadcrumb,
  home = false,
  sidebarToggle = false,
  refresh = false,
}: {
  breadcrumb: BreadcrumbItem[]
  home?: boolean
  sidebarToggle?: boolean
  refresh?: boolean
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
        >
          <SidebarIcon />
        </IconButton>
      ) : null}
      <Breadcrumb items={breadcrumb} />
      {refresh ? (
        <div role="status" aria-live="polite" class="ml-auto shrink-0">
          <Button id="page-refresh" variant="primary" size="sm" class={HIT_AREA_ICON_TOUCH} hidden>
            Updated — Show
          </Button>
        </div>
      ) : null}
    </HeaderBar>
  )
}
