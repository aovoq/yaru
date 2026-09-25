// タブと履歴に出す画面の名前。細かいものから順に「 · 」でつなぎ、最後に yaru を置く
// 複数のワークスペースのタブを並べて開いても、どのワークスペースのどの画面かを左端の字で見分けられるようにする
// 例: "Dashboard · AsukaTravel · yaru"、"#73 地図の配色 · AsukaTravel · yaru"
export function pageTitle(...parts: (string | null | undefined)[]): string {
  return [...parts.filter((part): part is string => Boolean(part)), "yaru"].join(" · ")
}
