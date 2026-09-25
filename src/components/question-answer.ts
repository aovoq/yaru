import type { Question } from "../questions"

// 質問に画面から答えられるかどうかと、回答の入力欄・ボタンとフォームを結ぶ id を決める
// questions.ts は node:fs を読み込むので、ブラウザでも動く質問のカードからはここを使う

export function isAwaitingAnswer(question: Question): boolean {
  return question.status === "open" || question.status === "expired"
}

// 回答欄の文字を送るフォーム
export function answerFormId(question: Question): string {
  return `answer-question-${question.id}`
}

// 選択肢のボタンを送るフォーム。回答欄と同じフォームで送ると、ボタンの body と回答欄の body (空) が 2 つ並び、
// 受け取る側がどちらを読むか決まらないので、選択肢は回答欄を持たない別のフォームで送る
export function optionFormId(question: Question): string {
  return `answer-question-${question.id}-option`
}

// 期限切れの質問を取り下げる (Dismiss) フォーム
export function cancelFormId(question: Question): string {
  return `cancel-question-${question.id}`
}

// 回答欄で Cmd+Enter (macOS) か Ctrl+Enter を押したら、その回答欄のフォームを送る
// 板 (use-keyboard-shortcuts.ts) は document で Cmd+Enter を受けて issue のフォームを送るので、ここで止めて届かせない
// 回答欄はフォームの外にあり form 属性で結ぶので、form が引けないときは属性の id から探す
// https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#attr-fae-form
export function submitAnswerOnModifierEnter(event: KeyboardEvent): void {
  if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey) || event.isComposing) return
  const textarea = event.currentTarget
  if (!(textarea instanceof HTMLTextAreaElement)) return
  const formId = textarea.getAttribute("form")
  const form = textarea.form ?? (formId ? document.getElementById(formId) : null)
  if (!(form instanceof HTMLFormElement)) return
  event.preventDefault()
  event.stopPropagation()
  form.requestSubmit()
}

// スクリプトで描き直さない画面 (dashboard) で、回答欄の Cmd+Enter を効かせる inline script
// 板と issue 画面では、回答欄の onKeyDown (submitAnswerOnModifierEnter) が同じことをする
export const ANSWER_SHORTCUT_SCRIPT = `document.addEventListener("keydown",function(e){if(e.key!=="Enter"||!(e.metaKey||e.ctrlKey)||e.isComposing)return;var t=e.target;if(!(t instanceof HTMLTextAreaElement)||!t.hasAttribute("data-answer-shortcut"))return;var f=t.form||document.getElementById(t.getAttribute("form")||"");if(!(f instanceof HTMLFormElement))return;e.preventDefault();f.requestSubmit()})`
