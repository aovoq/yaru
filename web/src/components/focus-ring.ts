// キーボードで focus したときだけ出す枠。リンク・アイコンのボタン・札など、Button 以外の押せる部品でそろえて使う
// Button は枠を 1px 離すので別に持つ (button.tsx の BASE)
// 枠の色は primary-hover を不透明のまま使う。地 (canvas から surface-4) に対して 6:1 以上あり、
// WCAG 2.2 の "at least 3:1 against adjacent colors" を満たす https://www.w3.org/TR/WCAG22/#non-text-contrast
export const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary-hover"
