// dashboard のサイドバーから板へ飛ぶリンク。src/client/view-model.ts:26-47 のうち、dashboard が渡す絞り込みだけ

export function boardHref(
  basePath: string,
  filters: { status?: string; assignee?: string; label?: string; awaiting?: boolean } = {},
): string {
  const parameters = new URLSearchParams()
  if (filters.status) parameters.set("status", filters.status)
  if (filters.assignee) parameters.set("assignee", filters.assignee)
  if (filters.label) parameters.set("label", filters.label)
  if (filters.awaiting) parameters.set("awaiting", "1")
  const query = parameters.toString()
  return query ? `${basePath}/?${query}` : `${basePath}/`
}

export function workspaceName(basePath: string | undefined): string {
  const match = /^\/p\/([^/]+)$/.exec(basePath ?? "")
  return match ? decodeURIComponent(match[1]!) : "yaru"
}

export function statusLabel(status: string): string {
  return status.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase())
}
