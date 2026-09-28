// タブと履歴に出す画面の名前。src/ui/page-title.ts
export function pageTitle(...parts: (string | null | undefined)[]): string {
  return [...parts.filter((part): part is string => Boolean(part)), "yaru"].join(" · ")
}
