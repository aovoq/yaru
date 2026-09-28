// 検索欄の左端に重ねて置く検索のアイコン
export function SearchIcon() {
  return (
    <svg
      class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-ink-tertiary"
      viewBox="0 0 14 14"
      aria-hidden="true"
    >
      <circle cx="6.2" cy="6.2" r="4" fill="none" stroke="currentColor" stroke-width="1.5" />
      <path d="M9.2 9.2L12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    </svg>
  )
}
