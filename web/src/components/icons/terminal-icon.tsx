// 端末の印。サイドバーから herdr の端末 (/terminal) を開く項目に使う
export function TerminalIcon() {
  return (
    <svg class="size-3.5 shrink-0" viewBox="0 0 14 14" aria-hidden="true">
      <rect
        x="1"
        y="2"
        width="12"
        height="10"
        rx="2"
        fill="none"
        stroke="currentColor"
        stroke-width="1.3"
      />
      <path
        d="M4 5.5 6 7 4 8.5M7.5 9h2.5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}
