// ラベルや担当者の名前から、いつも同じ色を 1 つ選ぶ。名前ごとに色を覚えておかなくても見分けられるようにする

const PALETTE = [
  "#4ea7fc",
  "#4cb782",
  "#f2c94c",
  "#f2994a",
  "#eb5757",
  "#de5d9c",
  "#a385e0",
  "#4cc3c9",
  "#95a2b3",
  "#6771c5",
]

export function tint(text: string): string {
  let hash = 0
  for (const character of text) hash = (hash * 776 + character.codePointAt(0)!) >>> 0
  return PALETTE[hash % PALETTE.length]!
}
