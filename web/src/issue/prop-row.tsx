import type { ComponentChildren } from "preact"

// 属性欄の 1 行。左に項目名、右に値を置き、保存に失敗したときはその行の下に理由を出す
// 行は label で包まない。選択の面が行の中に入るので、label で包むと候補を押したときに面が開き直る
// https://html.spec.whatwg.org/multipage/forms.html#the-label-element

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
