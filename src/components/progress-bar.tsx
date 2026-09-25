// 終わった数の割合を細い棒で見せる。issue 画面の子 issue の見出しの右で使う
// 幅は置く場所で決めるので class で渡す。渡さなければ 64px

export function ProgressBar({
  value,
  max,
  class: extra = "w-16",
}: {
  value: number
  max: number
  class?: string
}) {
  const percent = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <span
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      class={["h-1 overflow-hidden rounded-full bg-surface-3", extra].filter(Boolean).join(" ")}
    >
      <span class="block h-full rounded-full bg-primary" style={`width: ${percent}%`} />
    </span>
  )
}
