// 文字をクリップボードへ写す。写せたかどうかを返し、知らせの文言を呼び出し側で選べるようにする

// Clipboard API は https か localhost でしか使えず、許可が無いと断られる
// そのときは選択した文字を copy コマンドで写す古い方法に切り替える
// https://w3c.github.io/clipboard-apis/#dom-clipboard-writetext
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {}
  }
  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.opacity = "0"
  document.body.appendChild(textarea)
  textarea.select()
  try {
    return document.execCommand("copy")
  } catch {
    return false
  } finally {
    textarea.remove()
  }
}
