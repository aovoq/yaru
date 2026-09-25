// 終わった数の割合を細い棒で見せる。issue 画面の子 issue の見出しの右で使う
// 幅は置く場所で決めるので class で渡す。渡さなければ 64px
// 読み上げには何の進み具合か (label) と「2 of 5」の言い方 (aria-valuetext) を伝える。数だけでは割合の意味が分からないため
// https://www.w3.org/TR/wai-aria-1.2/#progressbar

export function ProgressBar({
  value,
  max,
  label = "Progress",
  class: extra = "w-16",
}: {
  value: number
  max: number
  label?: string
  class?: string
}) {
  const percent = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={`${value} of ${max}`}
      class={["h-1 overflow-hidden rounded-full bg-surface-3", extra].filter(Boolean).join(" ")}
    >
      <span class="block h-full rounded-full bg-primary" style={`width: ${percent}%`} />
    </span>
  )
}
