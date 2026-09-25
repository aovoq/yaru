// キーボードで focus したときだけ出す枠。リンク・アイコンのボタン・札など、Button 以外の押せる部品でそろえて使う
// Button は枠を 1px 離すので別に持つ (button.tsx の BASE)
export const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary-focus/50"
