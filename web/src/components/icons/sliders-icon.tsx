// 横に並んだつまみのアイコン。板の見せ方 (まとまり・並べ方・終わった issue) を選ぶ Display の入口で使う
export function SlidersIcon() {
  return (
    <svg class="size-3.5 shrink-0" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M2 4h10M2 10h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      <circle
        cx="5"
        cy="4"
        r="1.6"
        fill="var(--color-canvas)"
        stroke="currentColor"
        stroke-width="1.5"
      />
      <circle
        cx="9"
        cy="10"
        r="1.6"
        fill="var(--color-canvas)"
        stroke="currentColor"
        stroke-width="1.5"
      />
    </svg>
  )
}
