// ラベルや担当者の名前から色を 1 つ選ぶ。名前ごとに色を覚えておかなくても見分けられるようにする
// ブラウザでも動くので、node の機能には頼らない

// 期限切れ (danger の赤)・優先度 (橙・黄・灰)・状態 (primary の藍・黄)・完了 (success の緑) と同じ色相を避けた 10 色
// ラベルが警告や状態に見えないよう、空いている色相 (黄緑・青緑・水色・青・紫・桃) と、彩度を落とした砂色で埋める
// 隣り合う番号は色相を大きく離し、名前の順に割り当てたときに並んだラベルが似た色にならないようにする
export const LABEL_PALETTE: readonly string[] = [
  "#3b9ef5",
  "#a6d45b",
  "#c77dea",
  "#26b3bd",
  "#f7a8d4",
  "#b8906a",
  "#4fd1a5",
  "#e05fc0",
  "#8fd8f0",
  "#c5b3fb",
]

// 名前の hash で選ぶ。ワークスペースのラベルの一覧が手元に無いとき (担当者の丸など) に使う
export function tint(text: string): string {
  let hash = 0
  for (const character of text) hash = (hash * 776 + character.codePointAt(0)!) >>> 0
  return LABEL_PALETTE[hash % LABEL_PALETTE.length]!
}

// ワークスペースのラベルの一覧から、ラベルごとの色を決める
// hash だと 10 色あっても数個のラベルで色がぶつかるので、名前の順に palette を先頭から割り当て、10 個までは必ず別の色にする
// 並べる順は code point で決める。localeCompare は Bun とブラウザで照合順が違うことがあり、サーバーとブラウザで色が食い違うため
export function labelColors(labels: Iterable<string>): Map<string, string> {
  const names = [...new Set(labels)].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  )
  return new Map(names.map((name, index) => [name, LABEL_PALETTE[index % LABEL_PALETTE.length]!]))
}
