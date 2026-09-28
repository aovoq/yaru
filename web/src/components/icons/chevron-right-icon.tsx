// 右向きの矢じり。先へ進めることや階層の区切りを表すアイコン
export function ChevronRightIcon({ class: extra = "text-ink-tertiary" }: { class?: string }) {
  return (
    <svg class={`size-3 shrink-0 ${extra}`} viewBox="0 0 12 12" aria-hidden="true">
      <path
        d="M4.5 2.5 8 6l-3.5 3.5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}
