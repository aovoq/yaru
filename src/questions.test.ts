import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  acknowledgeQuestion,
  answerQuestion,
  cancelQuestion,
  compareQuestions,
  getQuestion,
  groupAwaitingQuestions,
  listQuestions,
  markExpiringNotified,
  questionsAboutToExpire,
  saveQuestion,
  undoAnswer,
  undoAnswerDeadline,
  QUESTION_ANSWER_MARKER,
  QuestionConflictError,
  UNDO_ANSWER_MILLISECONDS,
} from "./questions"
import { init, listComments, saveIssue } from "./store"

const dirs: string[] = []

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "yaru-questions-"))
  dirs.push(root)
  return init(root)
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const NOW = new Date("2026-09-25T09:00:00.000Z")

describe("questions", () => {
  test("create stores the question as markdown and reads it back as open", () => {
    const store = workspace()
    saveIssue(store, { title: "topic" })
    const created = saveQuestion(
      store,
      {
        title: "本番 DB の称号を消すか",
        issue: "1",
        priority: "high",
        defaultAction: "消さずに残す",
        answerBy: "2h",
        body: "背景の説明",
      },
      NOW,
    )
    expect(created).toMatchObject({
      id: "1",
      title: "本番 DB の称号を消すか",
      status: "open",
      issue: "1",
      priority: "high",
      defaultAction: "消さずに残す",
      answerBy: "2026-09-25T11:00:00.000Z",
      answer: null,
      answeredBy: null,
      answeredAt: null,
      canceledAt: null,
      createdAt: NOW.toISOString(),
      body: "背景の説明",
    })
    expect(created.author).toBeTruthy()
    const text = readFileSync(join(store.dir, "questions", "1.md"), "utf8")
    expect(text).toContain("title: 本番 DB の称号を消すか\n")
    expect(text).toContain("defaultAction: 消さずに残す\n")
    expect(text.split("\n").filter((line) => /\s$/.test(line))).toEqual([])
    expect(getQuestion(store, "1", NOW)).toEqual(created)
  })

  test("answerBy accepts minutes, hours, days, and an ISO datetime", () => {
    const store = workspace()
    expect(saveQuestion(store, { title: "a", answerBy: "30m" }, NOW).answerBy).toBe(
      "2026-09-25T09:30:00.000Z",
    )
    expect(saveQuestion(store, { title: "b", answerBy: "1d" }, NOW).answerBy).toBe(
      "2026-09-26T09:00:00.000Z",
    )
    expect(
      saveQuestion(store, { title: "c", answerBy: "2026-09-30T18:00:00+09:00" }, NOW).answerBy,
    ).toBe("2026-09-30T09:00:00.000Z")
    expect(() => saveQuestion(store, { title: "d", answerBy: "tomorrow" }, NOW)).toThrow(
      "invalid answerBy: expected a duration like 30m, 2h, 1d or an ISO 8601 datetime, actual tomorrow",
    )
  })

  test("an open question past answerBy reads as expired", () => {
    const store = workspace()
    saveQuestion(store, { title: "q", answerBy: "1h", defaultAction: "進める" }, NOW)
    const later = new Date("2026-09-25T10:00:00.000Z")
    expect(getQuestion(store, "1", later).status).toBe("expired")
    expect(listQuestions(store, { status: "expired" }, later).map((row) => row.id)).toEqual(["1"])
    expect(listQuestions(store, { status: "open" }, later)).toEqual([])
  })

  test("answer records the answer, who answered, and when, and survives reading back", () => {
    const store = workspace()
    saveQuestion(store, { title: "q", body: "context" }, NOW)
    const answeredAt = new Date("2026-09-25T09:05:00.000Z")
    const answered = answerQuestion(store, "1", { body: "残す\n\n理由は後で" }, answeredAt)
    expect(answered).toMatchObject({
      status: "answered",
      answer: "残す\n\n理由は後で",
      answeredAt: answeredAt.toISOString(),
      body: "context",
    })
    expect(answered.answeredBy).toBeTruthy()
    expect(getQuestion(store, "1", answeredAt)).toEqual(answered)
    const text = readFileSync(join(store.dir, "questions", "1.md"), "utf8")
    expect(text).toContain(QUESTION_ANSWER_MARKER)
  })

  test("an answered question past answerBy stays answered", () => {
    const store = workspace()
    saveQuestion(store, { title: "q", answerBy: "1h" }, NOW)
    answerQuestion(store, "1", { body: "yes" }, NOW)
    expect(getQuestion(store, "1", new Date("2026-09-26T00:00:00.000Z")).status).toBe("answered")
  })

  test("a late answer to an expired question is accepted", () => {
    const store = workspace()
    saveQuestion(store, { title: "q", answerBy: "1h" }, NOW)
    const later = new Date("2026-09-25T12:00:00.000Z")
    expect(answerQuestion(store, "1", { body: "yes" }, later).status).toBe("answered")
  })

  test("cancel withdraws a question and blocks answering it", () => {
    const store = workspace()
    saveQuestion(store, { title: "q" }, NOW)
    const canceled = saveQuestion(store, { id: "1", status: "canceled" }, NOW)
    expect(canceled.status).toBe("canceled")
    expect(canceled.canceledAt).toBe(NOW.toISOString())
    expect(() => answerQuestion(store, "1", { body: "yes" }, NOW)).toThrow(
      "cannot answer question 1: expected status open or expired, actual canceled",
    )
    const reopened = saveQuestion(store, { id: "1", status: "open" }, NOW)
    expect(reopened.status).toBe("open")
    expect(reopened.canceledAt).toBeNull()
  })

  test("update changes only the given fields and none clears optional ones", () => {
    const store = workspace()
    saveIssue(store, { title: "topic" })
    saveQuestion(
      store,
      { title: "q", issue: "1", priority: "low", defaultAction: "x", answerBy: "1h" },
      NOW,
    )
    const updated = saveQuestion(
      store,
      { id: "1", priority: "urgent", defaultAction: "none", answerBy: "none" },
      NOW,
    )
    expect(updated).toMatchObject({
      title: "q",
      issue: "1",
      priority: "urgent",
      defaultAction: null,
      answerBy: null,
    })
  })

  test("list filters by status and issue and puts questions awaiting an answer first", () => {
    const store = workspace()
    saveIssue(store, { title: "topic" })
    saveQuestion(store, { title: "first", issue: "1" }, NOW)
    saveQuestion(store, { title: "second" }, new Date("2026-09-25T09:01:00.000Z"))
    saveQuestion(store, { title: "third", issue: "1" }, new Date("2026-09-25T09:02:00.000Z"))
    answerQuestion(store, "3", { body: "done" }, NOW)
    expect(listQuestions(store, {}, NOW).map((row) => row.id)).toEqual(["1", "2", "3"])
    expect(listQuestions(store, { issue: "1" }, NOW).map((row) => row.id)).toEqual(["1", "3"])
    expect(listQuestions(store, { status: "answered" }, NOW).map((row) => row.id)).toEqual(["3"])
    expect(() => listQuestions(store, { status: "pending" }, NOW)).toThrow(
      "invalid status: expected open, expired, answered, or canceled, actual pending",
    )
  })

  test("awaiting questions order blocking, then by deadline, then no deadline, then proceeded", () => {
    const store = workspace()
    const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000)
    // 1: 既定の行動が無いので、答えるまでエージェントが止まっている
    saveQuestion(store, { title: "blocking old" }, at(0))
    // 2: 期限が遠い
    saveQuestion(store, { title: "due later", defaultAction: "x", answerBy: "3h" }, at(1))
    // 3: 期限が近い
    saveQuestion(store, { title: "due soon", defaultAction: "x", answerBy: "1h" }, at(2))
    // 4: 期限が無く既定の行動がある
    saveQuestion(store, { title: "no deadline", defaultAction: "x" }, at(3))
    // 5: 期限が過ぎて既定の行動で進んだ
    saveQuestion(store, { title: "proceeded", defaultAction: "x", answerBy: "10m" }, at(4))
    // 6: 後から来た止まっている質問
    saveQuestion(store, { title: "blocking new" }, at(5))
    const now = at(30)
    expect(listQuestions(store, {}, now).map((row) => row.id)).toEqual([
      "1",
      "6",
      "3",
      "2",
      "4",
      "5",
    ])
    const groups = groupAwaitingQuestions(listQuestions(store, {}, now))
    expect(groups.blocking.map((row) => row.id)).toEqual(["1", "6"])
    expect(groups.dueSoon.map((row) => row.id)).toEqual(["3", "2"])
    expect(groups.noDeadline.map((row) => row.id)).toEqual(["4"])
    expect(groups.proceeded.map((row) => row.id)).toEqual(["5"])
  })

  test("grouping keeps any wrapper item so questions from several workspaces can be merged", () => {
    const store = workspace()
    saveQuestion(store, { title: "blocking" }, NOW)
    saveQuestion(store, { title: "timed", defaultAction: "x", answerBy: "1h" }, NOW)
    answerQuestion(store, "2", { body: "done" }, NOW)
    const items = listQuestions(store, {}, NOW).map((question) => ({ workspace: "a", question }))
    const groups = groupAwaitingQuestions(items, (item) => item.question)
    expect(groups.blocking).toEqual([items[0]!])
    expect(groups.dueSoon).toEqual([])
    expect(
      [...items]
        .sort((a, b) => compareQuestions(a.question, b.question))
        .map((item) => item.question.id),
    ).toEqual(["1", "2"])
  })

  test("create records where the agent asked from, and update keeps it", () => {
    const store = workspace()
    const provenance = {
      session: "session-1",
      worktree: "/work/linked",
      branch: "feat/add-thing",
    }
    const created = saveQuestion(store, { title: "q", provenance }, NOW)
    expect(created).toMatchObject(provenance)
    expect(readFileSync(join(store.dir, "questions", "1.md"), "utf8")).toContain(
      "worktree: /work/linked\n",
    )
    const updated = saveQuestion(
      store,
      { id: "1", priority: "high", provenance: { session: "other", worktree: null, branch: null } },
      NOW,
    )
    expect(updated).toMatchObject(provenance)
    expect(saveQuestion(store, { title: "without" }, NOW)).toMatchObject({
      session: null,
      worktree: null,
      branch: null,
    })
  })

  test("options are stored as a list that survives commas and can be replaced or cleared", () => {
    const store = workspace()
    const created = saveQuestion(
      store,
      { title: "q", options: ["残す", "消す, ただし本番だけ", " 後で決める "] },
      NOW,
    )
    expect(created.options).toEqual(["残す", "消す, ただし本番だけ", "後で決める"])
    expect(getQuestion(store, "1", NOW).options).toEqual(created.options)
    expect(saveQuestion(store, { id: "1", options: ["a"] }, NOW).options).toEqual(["a"])
    expect(saveQuestion(store, { id: "1", priority: "low" }, NOW).options).toEqual(["a"])
    expect(saveQuestion(store, { id: "1", options: [] }, NOW).options).toEqual([])
    expect(saveQuestion(store, { title: "none" }, NOW).options).toEqual([])
    expect(() => saveQuestion(store, { title: "blank", options: ["a", " "] }, NOW)).toThrow(
      'invalid option: expected a non-empty string, actual " "',
    )
    expect(() => saveQuestion(store, { title: "twice", options: ["a", "a"] }, NOW)).toThrow(
      'invalid option: expected each option once, actual "a" twice',
    )
  })

  test("asking the same open question again is refused unless forced", () => {
    const store = workspace()
    saveIssue(store, { title: "topic" })
    saveQuestion(store, { title: "消すか", issue: "1" }, NOW)
    expect(() => saveQuestion(store, { title: " 消すか ", issue: "1" }, NOW)).toThrow(
      'duplicate question: expected no open question titled "消すか" on issue 1, actual question 1 is open; force to ask again',
    )
    expect(saveQuestion(store, { title: "消すか" }, NOW).id).toBe("2")
    expect(() => saveQuestion(store, { title: "消すか" }, NOW)).toThrow(
      'duplicate question: expected no open question titled "消すか" without an issue, actual question 2 is open; force to ask again',
    )
    expect(saveQuestion(store, { title: "消すか", issue: "1", force: true }, NOW).id).toBe("3")
    answerQuestion(store, "1", { body: "yes" }, NOW)
    saveQuestion(store, { id: "3", status: "canceled" }, NOW)
    expect(saveQuestion(store, { title: "消すか", issue: "1" }, NOW).id).toBe("4")
  })

  test("answering an answered question is a conflict unless forced or editing that answer", () => {
    const store = workspace()
    saveQuestion(store, { title: "q" }, NOW)
    answerQuestion(store, "1", { body: "first" }, NOW)
    let conflict: unknown
    try {
      answerQuestion(store, "1", { body: "stale tab", expectedStatus: "open" }, NOW)
    } catch (err) {
      conflict = err
    }
    expect(conflict).toBeInstanceOf(QuestionConflictError)
    expect((conflict as Error).message).toContain(
      "cannot answer question 1: expected status open or expired, actual answered",
    )
    expect(() => answerQuestion(store, "1", { body: "no expectation" }, NOW)).toThrow(
      QuestionConflictError,
    )
    expect(getQuestion(store, "1", NOW).answer).toBe("first")
    const later = new Date("2026-09-25T09:10:00.000Z")
    expect(
      answerQuestion(store, "1", { body: "edited", expectedStatus: "answered" }, later),
    ).toMatchObject({ answer: "edited", answeredAt: later.toISOString() })
    expect(answerQuestion(store, "1", { body: "forced", force: true }, later).answer).toBe("forced")
    expect(() => answerQuestion(store, "1", { body: "x", expectedStatus: "done" }, NOW)).toThrow(
      "invalid expectedStatus: expected open, expired, answered, or canceled, actual done",
    )
  })

  test("a tab that saw the question open can still answer after it expired", () => {
    const store = workspace()
    saveQuestion(store, { title: "q", defaultAction: "x", answerBy: "1h" }, NOW)
    const later = new Date("2026-09-25T12:00:00.000Z")
    expect(answerQuestion(store, "1", { body: "yes", expectedStatus: "open" }, later).status).toBe(
      "answered",
    )
  })

  test("answering a canceled question is a conflict even when forced", () => {
    const store = workspace()
    saveQuestion(store, { title: "q" }, NOW)
    cancelQuestion(store, "1", NOW)
    expect(() => answerQuestion(store, "1", { body: "yes", force: true }, NOW)).toThrow(
      QuestionConflictError,
    )
  })

  test("cancel withdraws an awaiting question, keeps a canceled one, and refuses an answered one", () => {
    const store = workspace()
    saveQuestion(store, { title: "a" }, NOW)
    saveQuestion(store, { title: "b" }, NOW)
    const canceled = cancelQuestion(store, "1", NOW)
    expect(canceled).toMatchObject({ status: "canceled", canceledAt: NOW.toISOString() })
    expect(cancelQuestion(store, "1", new Date("2026-09-25T10:00:00.000Z")).canceledAt).toBe(
      NOW.toISOString(),
    )
    answerQuestion(store, "2", { body: "yes" }, NOW)
    expect(() => cancelQuestion(store, "2", NOW)).toThrow(
      "cannot cancel question 2: expected status open or expired, actual answered",
    )
    expect(() => cancelQuestion(store, "2", NOW)).toThrow(QuestionConflictError)
  })

  test("a late answer to an expired question linked to an issue is mirrored as an issue comment", () => {
    const store = workspace()
    saveIssue(store, { title: "topic" })
    saveQuestion(store, { title: "消すか", issue: "1", defaultAction: "残す", answerBy: "1h" }, NOW)
    saveQuestion(store, { title: "in time", issue: "1", answerBy: "1h" }, NOW)
    const later = new Date("2026-09-25T12:00:00.000Z")
    answerQuestion(store, "1", { body: "消してよい\n\n理由は後で" }, later)
    answerQuestion(store, "2", { body: "on time" }, NOW)
    answerQuestion(store, "1", { body: "やはり残す", force: true }, later)
    expect(listComments(store, { issue: "1" }).map((comment) => comment.body)).toEqual([
      "Late answer to Q1 (消すか), after the agent proceeded with the default:\n\n消してよい\n\n理由は後で",
    ])
  })

  test("a late answer to an expired question without a default does not claim the agent proceeded", () => {
    const store = workspace()
    saveIssue(store, { title: "topic" })
    saveQuestion(store, { title: "どうするか", issue: "1", answerBy: "1h" }, NOW)
    answerQuestion(store, "1", { body: "こうする" }, new Date("2026-09-25T12:00:00.000Z"))
    expect(listComments(store, { issue: "1" }).map((comment) => comment.body)).toEqual([
      "Late answer to Q1 (どうするか), after answerBy passed:\n\nこうする",
    ])
  })

  test("acknowledging records the first pickup of an answer without touching updatedAt", () => {
    const store = workspace()
    saveQuestion(store, { title: "q" }, NOW)
    expect(acknowledgeQuestion(store, "1", NOW).acknowledgedAt).toBeNull()
    answerQuestion(store, "1", { body: "yes" }, NOW)
    const first = new Date("2026-09-25T09:30:00.000Z")
    const acknowledged = acknowledgeQuestion(store, "1", first)
    expect(acknowledged.acknowledgedAt).toBe(first.toISOString())
    expect(acknowledged.updatedAt).toBe(NOW.toISOString())
    expect(
      acknowledgeQuestion(store, "1", new Date("2026-09-25T10:00:00.000Z")).acknowledgedAt,
    ).toBe(first.toISOString())
    // 答えを直したら、エージェントがまだ読んでいない新しい答えになる
    expect(answerQuestion(store, "1", { body: "no", force: true }, first).acknowledgedAt).toBeNull()
  })

  test("the expiring notice is recorded once without touching updatedAt", () => {
    const store = workspace()
    saveQuestion(store, { title: "q", answerBy: "1h" }, NOW)
    expect(getQuestion(store, "1", NOW).notifiedExpiringAt).toBeNull()
    const noticed = new Date("2026-09-25T09:50:00.000Z")
    const marked = markExpiringNotified(store, "1", noticed)
    expect(marked.notifiedExpiringAt).toBe(noticed.toISOString())
    expect(marked.updatedAt).toBe(NOW.toISOString())
  })

  test("questions about to expire are the open ones due within the window that were not noticed", () => {
    const store = workspace()
    // 1: 15 分以内に期限が来る
    saveQuestion(store, { title: "soon", answerBy: "1h" }, NOW)
    // 2: まだ先
    saveQuestion(store, { title: "later", answerBy: "3h" }, NOW)
    // 3: 最初から期限が短く、作った知らせと続けて届いてしまう
    saveQuestion(store, { title: "short", answerBy: "10m" }, new Date("2026-09-25T09:45:00.000Z"))
    // 4: もう答えた
    saveQuestion(store, { title: "answered", answerBy: "1h" }, NOW)
    answerQuestion(store, "4", { body: "yes" }, NOW)
    // 5: もう知らせた
    saveQuestion(store, { title: "noticed", answerBy: "1h" }, NOW)
    markExpiringNotified(store, "5", NOW)
    const now = new Date("2026-09-25T09:50:00.000Z")
    expect(questionsAboutToExpire(listQuestions(store, {}, now), now).map((row) => row.id)).toEqual(
      ["1"],
    )
  })

  test("validation errors show the expected and the actual value", () => {
    const store = workspace()
    expect(() => saveQuestion(store, {}, NOW)).toThrow("title is required when creating a question")
    expect(() => saveQuestion(store, { title: "q", issue: "9" }, NOW)).toThrow("issue not found: 9")
    expect(() => saveQuestion(store, { title: "q", priority: "now" }, NOW)).toThrow(
      "invalid priority: expected urgent, high, medium, or low, actual now",
    )
    expect(() =>
      saveQuestion(store, { title: "q", body: `a\n${QUESTION_ANSWER_MARKER}\nb` }, NOW),
    ).toThrow(`invalid body: must not contain ${QUESTION_ANSWER_MARKER}`)
    expect(() => saveQuestion(store, { id: "9", title: "q" }, NOW)).toThrow("question not found: 9")
    expect(() => saveQuestion(store, { id: "1", status: "answered" }, NOW)).toThrow(
      "invalid status: expected open or canceled, actual answered",
    )
    saveQuestion(store, { title: "q" }, NOW)
    expect(() => answerQuestion(store, "1", { body: " " }, NOW)).toThrow(
      'invalid answer: expected a non-empty string, actual " "',
    )
  })

  test("newlines in single-line fields collapse to spaces", () => {
    const store = workspace()
    const created = saveQuestion(store, { title: "a\nb", defaultAction: "c\nd" }, NOW)
    expect(created.title).toBe("a b")
    expect(created.defaultAction).toBe("c d")
  })

  test("the questions folder ignores itself in git so live questions are never committed", () => {
    const store = workspace()
    Bun.spawnSync(["git", "init", "-q"], { cwd: store.root })
    saveQuestion(store, { title: "q" }, NOW)
    expect(readFileSync(join(store.dir, "questions", ".gitignore"), "utf8")).toBe("*\n")
    const status = Bun.spawnSync(["git", "status", "--porcelain", "--untracked-files=all"], {
      cwd: store.root,
      stdout: "pipe",
    })
    expect(status.stdout.toString()).not.toContain("questions")
    expect(listQuestions(store, {}, NOW).map((row) => row.id)).toEqual(["1"])
  })

  describe("undoAnswer", () => {
    const answeredAt = NOW
    const within = new Date(NOW.getTime() + UNDO_ANSWER_MILLISECONDS - 1000)

    test("within the window the answer is cleared and the question awaits an answer again", () => {
      const store = workspace()
      saveQuestion(store, { title: "q", answerBy: "2h" }, NOW)
      answerQuestion(store, "1", { body: "消してよい" }, answeredAt)
      const undone = undoAnswer(store, "1", { answeredAt: answeredAt.toISOString() }, within)
      expect(undone).toMatchObject({
        status: "open",
        answer: null,
        answeredBy: null,
        answeredAt: null,
        acknowledgedAt: null,
        updatedAt: within.toISOString(),
      })
      expect(getQuestion(store, "1", within).status).toBe("open")
    })

    test("after the window the answer stays, since the agent may already be acting on it", () => {
      const store = workspace()
      saveQuestion(store, { title: "q" }, NOW)
      answerQuestion(store, "1", { body: "yes" }, answeredAt)
      const late = new Date(NOW.getTime() + UNDO_ANSWER_MILLISECONDS + 1000)
      expect(() => undoAnswer(store, "1", { answeredAt: answeredAt.toISOString() }, late)).toThrow(
        "cannot undo the answer to question 1: expected within 30s of answering, actual 31s",
      )
      expect(getQuestion(store, "1").answer).toBe("yes")
    })

    test("an answer the agent has picked up cannot be undone", () => {
      const store = workspace()
      saveQuestion(store, { title: "q" }, NOW)
      answerQuestion(store, "1", { body: "yes" }, answeredAt)
      acknowledgeQuestion(store, "1", new Date(NOW.getTime() + 1000))
      expect(() =>
        undoAnswer(store, "1", { answeredAt: answeredAt.toISOString() }, within),
      ).toThrow(QuestionConflictError)
      expect(() =>
        undoAnswer(store, "1", { answeredAt: answeredAt.toISOString() }, within),
      ).toThrow(
        `cannot undo the answer to question 1: expected the agent not to have picked it up, actual picked up at ${new Date(NOW.getTime() + 1000).toISOString()}`,
      )
    })

    test("an answer replaced after the one being undone is kept", () => {
      const store = workspace()
      saveQuestion(store, { title: "q" }, NOW)
      answerQuestion(store, "1", { body: "first" }, answeredAt)
      const replacedAt = new Date(NOW.getTime() + 5000)
      answerQuestion(store, "1", { body: "second", force: true }, replacedAt)
      expect(() =>
        undoAnswer(store, "1", { answeredAt: answeredAt.toISOString() }, within),
      ).toThrow(
        `cannot undo the answer to question 1: expected answeredAt ${answeredAt.toISOString()}, actual ${replacedAt.toISOString()}`,
      )
      expect(getQuestion(store, "1").answer).toBe("second")
    })

    test("a question without an answer has nothing to undo", () => {
      const store = workspace()
      saveQuestion(store, { title: "q" }, NOW)
      expect(() => undoAnswer(store, "1", {}, within)).toThrow(
        "cannot undo the answer to question 1: expected status answered, actual open",
      )
      expect(() => undoAnswer(store, "9", {}, within)).toThrow("question not found: 9")
    })

    test("a late answer already written to the issue as a comment cannot be undone", () => {
      const store = workspace()
      saveIssue(store, { title: "topic" })
      saveQuestion(
        store,
        { title: "q", issue: "1", defaultAction: "x", answerBy: "2026-09-25T08:00:00.000Z" },
        new Date("2026-09-25T07:00:00.000Z"),
      )
      answerQuestion(store, "1", { body: "late" }, answeredAt)
      expect(() =>
        undoAnswer(store, "1", { answeredAt: answeredAt.toISOString() }, within),
      ).toThrow(
        "cannot undo the answer to question 1: expected an answer before answerBy, actual a late answer already added to issue 1 as a comment",
      )
      expect(getQuestion(store, "1", within).answer).toBe("late")
    })
  })

  // 画面は取り消しのボタンをいつまで出すかをこれで決める。断られると分かっているボタンは出さない
  test("undoAnswerDeadline is when the undo window closes, or null when undo would be refused", () => {
    const store = workspace()
    saveIssue(store, { title: "topic" })
    saveQuestion(store, { title: "a" }, NOW)
    const answered = answerQuestion(store, "1", { body: "yes" }, NOW)
    expect(undoAnswerDeadline(answered)?.toISOString()).toBe(
      new Date(NOW.getTime() + UNDO_ANSWER_MILLISECONDS).toISOString(),
    )
    expect(undoAnswerDeadline({ ...answered, acknowledgedAt: NOW.toISOString() })).toBeNull()
    expect(undoAnswerDeadline(getQuestion(store, "1", NOW))).not.toBeNull()
    saveQuestion(store, { title: "b" }, NOW)
    expect(undoAnswerDeadline(getQuestion(store, "2", NOW))).toBeNull()
    saveQuestion(
      store,
      { title: "c", issue: "1", answerBy: "2026-09-25T08:30:00.000Z" },
      new Date("2026-09-25T08:00:00.000Z"),
    )
    expect(undoAnswerDeadline(answerQuestion(store, "3", { body: "late" }, NOW))).toBeNull()
  })
})
