import { currentTime } from "./time"

// issue の期日。src/issue-dates.ts:12-30 と同じ。Date.parse は使わず、暦の日付の文字列で比べる

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const FINISHED_STATUSES = ["done", "canceled"]

export function isIssueOverdue(
  issue: { dueDate: string | null; status: string },
  now = currentTime(),
): boolean {
  if (issue.dueDate === null) return false
  if (FINISHED_STATUSES.includes(issue.status)) return false
  return issue.dueDate < calendarDate(now)
}

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
