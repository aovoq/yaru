import { Pill } from "../../components/pill"

// 進行中のまま長く更新の無い issue (Issue.stale) に付ける札。エージェントが落ちたか、返事を待ったまま忘れられたかを人に気づかせる
// 危険 (期限切れ) ほどは急がないが見落としたくないので、優先度の high と同じ橙にする
// どれだけ経てば止まっているとみなすかは .yaru/config.yml の staleAfter で決まる (issue-stale.ts)

export function StaleMarker() {
  return (
    <Pill
      tone={null}
      data-stale=""
      title="In progress with no update for a while"
      class="shrink-0 border-priority-high/40 text-priority-high"
    >
      Stale
    </Pill>
  )
}
