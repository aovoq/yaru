import { createContext } from "preact"
import { useContext } from "preact/hooks"
import type { PropertyField } from "../issue-menu"
import type { ReturnedDrafts } from "../state"

// 板の組み立て役 (app.tsx) が持つ issue の操作を、板の行や issue 画面の部品へ props を何段も通さずに渡す
// 右クリックの無いスマホでも、行や見出しの「…」のボタンから同じメニューを開けるようにする (openIssueMenuAt)
// 属性の選択の面 (s / p / a / l / d と同じもの) も、押したボタンの下に開ける (openPropertyPicker)

export type IssueActions = {
  // issue のメニューを anchor (押したボタンや行) の左下に開く。閉じたら anchor へ focus を戻す
  openIssueMenuAt: (issueId: string, anchor: HTMLElement) => void
  // issue の属性の選択の面を anchor の下に開く。複数の id を渡すと、選んだ値を全ての issue に当てる
  openPropertyPicker: (issueIds: string[], field: PropertyField, anchor: HTMLElement) => void
  // ⌘K のコマンドパレットを開く。キーボードの無いスマホで、見出しのボタンから開くのに使う
  // 部品のテストは使う口だけを組むので、使わない部品のために省けるようにする
  openCommandPalette?: () => void
  // x と Shift+クリックでまとめて選んでいる issue の id
  bulkSelection: string[]
  toggleBulkSelection: (issueId: string) => void
  // 自動保存に失敗して残っている変更を保存し直す。issue 画面の見出しの Retry から呼ぶ
  retrySave: () => Promise<void>
  // フォームの失敗で戻されたときの書きかけのコメントと回答。issue 画面の欄に入れ直す
  returnedDrafts: ReturnedDrafts
}

// 組み立て役の外 (部品だけのテストやサーバーの描画) では何もしない
const NO_ACTIONS: IssueActions = {
  openIssueMenuAt: () => {},
  openPropertyPicker: () => {},
  openCommandPalette: () => {},
  bulkSelection: [],
  toggleBulkSelection: () => {},
  retrySave: async () => {},
  returnedDrafts: {},
}

export const IssueActionsContext = createContext<IssueActions>(NO_ACTIONS)

export function useIssueActions(): IssueActions {
  return useContext(IssueActionsContext)
}
