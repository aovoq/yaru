import { h, type ComponentChildren, type JSX } from "preact"

// 枠と面の色だけを持つカード。質問のカード・コメント・プロジェクトの一覧の 1 件などで使う
// 中の余白と並べ方は置く場所ごとに違うので class で渡す
// danger は期限切れの質問のように目を引きたいカードに付け、枠全体を薄い危険の色 (30%) にする
// 片側だけに引く飾りの帯は使わない。濃い赤の枠にすると並んだカードがどれも警告に見えるので、薄くして言葉 (Expired など) と合わせて示す

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
        "rounded-lg border bg-surface-1",
        danger ? "border-semantic-danger/30" : "border-hairline",
        extra,
      ]
        .filter(Boolean)
        .join(" "),
    },
    children,
  )
}
