// クリップボードへ書く。navigator.clipboard は HTTPS か localhost でしか使えないので、
// それ以外は execCommand に切り替える。タップの中から同期的に呼ぶ
// ~/workspace/resident-app/web/src/copy.ts

export async function copyText(text: string): Promise<boolean> {
  if (window.isSecureContext && window.navigator.clipboard) {
    try {
      await window.navigator.clipboard.writeText(text)
      return true
    } catch {
      // 失敗したら下の execCommand へ落とす
    }
  }
  const area = window.document.createElement("textarea")
  area.value = text
  area.setAttribute("readonly", "")
  area.style.cssText = "position:fixed;top:0;left:0;opacity:0;font-size:16px"
  window.document.body.appendChild(area)
  area.select()
  area.setSelectionRange(0, text.length)
  let copied = false
  try {
    copied = window.document.execCommand("copy")
  } catch {
    copied = false
  }
  area.remove()
  return copied
}
