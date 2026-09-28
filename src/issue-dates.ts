import { currentTime } from "./time"

// issue の期日の扱い。期限切れかどうかと、画面に出す日付の書き方を決める
// store.ts は node:fs を読み込むので、ブラウザでも動く部品 (DueStamp など) からはここを使う

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

// 終わった (done) か取りやめた (canceled) issue は、期日を過ぎていても期限切れとして扱わない
// もう手を付けない issue を危険の色で示すと、本当に遅れている issue が埋もれるため
const FINISHED_STATUSES = ["done", "canceled"]

export function isIssueOverdue(
  issue: { dueDate: string | null; status: string },
  now = currentTime(),
): boolean {
  if (issue.dueDate === null) return false
  if (FINISHED_STATUSES.includes(issue.status)) return false
  return issue.dueDate < calendarDate(now)
}

// 期日を「Oct 20」のように短く出す。今年でなければ「Oct 20, 2027」と年を添える
// 期日は時刻を持たない暦の日付なので、Date に通さず文字列のまま読む。Date.parse は UTC の 0 時として読み、地域によって前の日にずれるため
export function formatDueDate(dueDate: string, now = currentTime()): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueDate)
  if (!match) return dueDate
  const [, year, month, day] = match
  const monthName = MONTHS[Number(month) - 1]
  if (!monthName) return dueDate
  const short = `${monthName} ${Number(day)}`
  return Number(year) === now.getFullYear() ? short : `${short}, ${year}`
}

function calendarDate(now: Date): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const day = String(now.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}
