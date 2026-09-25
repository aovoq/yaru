import { h, type ComponentChildren, type JSX } from "preact"

// 枠と面の色だけを持つカード。質問のカード・コメント・プロジェクトの一覧の 1 件などで使う
// 中の余白と並べ方は置く場所ごとに違うので class で渡す
// danger は期限切れの質問のように目を引きたいカードに付け、枠は細い線のまま左端に 2px の危険の色の帯を引く
// 枠全体を赤くすると、並んだカードがどれも警告に見えて、本当に急ぐものが埋もれるため
// 帯は内側の影で描く。枠の太さを変えないので中身の位置がずれない

export function Card({
  as: Tag = "div",
  danger = false,
  class: extra = "",
  children,
  ...rest
}: {
  as?: "article" | "div" | "li" | "section"
  danger?: boolean
  class?: string
  children?: ComponentChildren
} & Omit<JSX.HTMLAttributes<HTMLElement>, "class" | "children">) {
  // 要素の種類を props で選ぶので、JSX ではなく h で作る。JSX の <Tag> は 4 種の要素の属性の型を全て満たすことを求めてしまうため
  return h(
    Tag,
    {
      ...rest,
      "data-danger": danger ? "" : undefined,
      class: [
        "rounded-lg border border-hairline bg-surface-1",
        danger ? "shadow-[inset_2px_0_0_var(--color-semantic-danger)]" : "",
        extra,
      ]
        .filter(Boolean)
        .join(" "),
    },
    children,
  )
}
