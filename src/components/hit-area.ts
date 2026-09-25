// 見た目と並びは変えずに、押せる範囲だけを周りへ広げる。字だけのボタンやリンク、小さいアイコンのボタンに付ける
// 透明な ::after を部品の外へはみ出させる。WCAG 2.2 の "The size of the target for pointer inputs is at least 24 by 24 CSS pixels"
// https://www.w3.org/TR/WCAG22/#target-size-minimum
// 指で触る端末 (pointer: coarse) ではさらに広げる https://drafts.csswg.org/mediaqueries-4/#pointer
// 部品が自分に overflow-hidden (truncate) を持つと ::after も切り取られて広がらないので、字を切り詰めるときは中の span に付けること

// 16px 前後の高さの字だけのボタンとリンク。上下左右に 4px 広げて 24px、指では 8px 広げて 32px にする
export const HIT_AREA = "relative after:absolute after:-inset-1 pointer-coarse:after:-inset-2"

// 20px のアイコン (板の列の + とロゴ)。2px 広げて 24px、指では 12px 広げて 44px にする
export const HIT_AREA_ICON =
  "relative after:absolute after:-inset-0.5 pointer-coarse:after:-inset-3"

// 28px のアイコンのボタン。マウスではそのままで足り、指では 8px 広げて 44px にする
export const HIT_AREA_ICON_TOUCH = "relative after:absolute pointer-coarse:after:-inset-2"
