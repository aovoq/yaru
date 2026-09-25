import type { ComponentChildren } from "preact"

// issue 画面の属性欄の 1 行。左に項目名、右に値を置き、保存に失敗したときはその行の下に理由を出す
// 値の前のアイコンは、アイコンの無い行でも同じ幅 (16px) の枠を置き、行をまたいで値の書き出しを縦にそろえる
// 行は label で包まない。値を押すと開く選択の面 (Popover) が行の中に入るので、label で包むと面の候補を押したときに
// 押したことが行の最初のボタン (面を開くボタン) にも届き、面が閉じてすぐ開き直ってしまうため
// https://html.spec.whatwg.org/multipage/forms.html#the-label-element
// 代わりに項目名に id を付け、値のボタンや入力欄から aria-labelledby で名前として読ませる
// data-property は属性の名前。テストと画面の確認で行を探すのに使う

export function PropRow({
  property,
  label,
  labelId,
  icon,
  error,
  children,
}: {
  property: string
  label: string
  labelId: string
  icon?: ComponentChildren
  error?: string
  children?: ComponentChildren
}) {
  return (
    <div data-property={property} class="flex flex-col">
      <div class="flex min-h-8 items-start gap-2">
        <span id={labelId} class="flex h-7 w-20 shrink-0 items-center text-small text-ink-tertiary">
          {label}
        </span>
        <span class="flex min-w-0 flex-1 items-start gap-2 pl-2">
          <span class="flex h-7 w-4 shrink-0 items-center justify-center">{icon}</span>
          <span class="flex min-w-0 flex-1 items-start *:min-w-0 *:flex-1">{children}</span>
        </span>
      </div>
      {error ? (
        <p role="alert" class="mb-1 pl-30 text-small text-semantic-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}
