// 時計のアイコン。人の答えを待っている質問のある issue だけに絞る入口 (板のサイドバーの Awaiting answer) で使う
export function ClockIcon() {
  return (
    <svg class="size-3.5 shrink-0" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r="5.25" fill="none" stroke="currentColor" stroke-width="1.5" />
      <path
        d="M7 4.2V7l1.9 1.3"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}
