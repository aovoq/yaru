import type { createYaruClients } from "../connect/client"
import type { IssueClients } from "./use-issue-controller"

// 板が作った Connect の client を、issue 画面が使う口に合わせる
export function bindIssueClients(clients: ReturnType<typeof createYaruClients>): IssueClients {
  return {
    page: { getPage: (request) => clients.page.getPage(request) },
    issues: { saveIssue: (request) => clients.issues.saveIssue(request) },
    comments: { saveComment: (request) => clients.comments.saveComment(request) },
    questions: {
      answerQuestion: (request) => clients.questions.answerQuestion(request),
      undoAnswer: (request) => clients.questions.undoAnswer(request),
      cancelQuestion: (request) => clients.questions.cancelQuestion(request),
    },
    transport: clients.transport,
  }
}
