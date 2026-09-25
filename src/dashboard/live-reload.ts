// dashboard を開いたままでも新しい質問や進み具合が見えるよう、サーバーから更新の知らせ (SSE) を受けたら読み直す
// 答えを書きかけているときにリロードで消さないよう、入力中は再読み込みせず #dashboard-stale の知らせだけ出す
// https://html.spec.whatwg.org/multipage/server-sent-events.html

export function dashboardLiveReload(basePath: string): string {
  return `(()=>{const source=new EventSource(${JSON.stringify(`${basePath}/events`)});source.onmessage=()=>{const editing=[...document.querySelectorAll("textarea")].some((element)=>element.value.trim()!==""||element===document.activeElement);if(editing){document.getElementById("dashboard-stale")?.removeAttribute("hidden");return}location.reload()}})()`
}
