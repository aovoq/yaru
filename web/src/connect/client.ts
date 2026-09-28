import { Code, ConnectError, createClient, type Transport } from "@connectrpc/connect"
import { createConnectTransport } from "@connectrpc/connect-web"
import { CommentService } from "../gen/yaru/v1/comment_pb"
import { DashboardService } from "../gen/yaru/v1/dashboard_pb"
import { InboxService } from "../gen/yaru/v1/inbox_pb"
import { IssueService } from "../gen/yaru/v1/issue_pb"
import { PageService } from "../gen/yaru/v1/page_pb"
import { ProjectService } from "../gen/yaru/v1/project_pb"
import { QuestionService } from "../gen/yaru/v1/question_pb"
import { WatchService } from "../gen/yaru/v1/watch_pb"

// Connect は全部 POST。useHttpGet を有効にしない (docs/spec/routes.md の「SPA と Connect への対応」)
// GET にすると Origin の検査が書き込みより弱くなる (docs/spec/security.md)
export function createYaruTransport(
  baseUrl: string,
  fetchImplementation?: typeof fetch,
): Transport {
  return createConnectTransport({
    baseUrl,
    useHttpGet: false,
    fetch: fetchImplementation,
  })
}

export function createYaruClients(baseUrl: string, fetchImplementation?: typeof fetch) {
  const transport = createYaruTransport(baseUrl, fetchImplementation)
  return {
    transport,
    projects: createClient(ProjectService, transport),
    inbox: createClient(InboxService, transport),
    page: createClient(PageService, transport),
    dashboard: createClient(DashboardService, transport),
    issues: createClient(IssueService, transport),
    comments: createClient(CommentService, transport),
    questions: createClient(QuestionService, transport),
    watch: createClient(WatchService, transport),
  }
}

const RETRYABLE_CODES = new Set<Code>([
  Code.Unavailable,
  Code.DeadlineExceeded,
  Code.Internal,
  Code.Unknown,
])

// 送り直してよいコードだけ。新規作成は冪等ではないので、transport は自動で送らない (docs/spec/routes.md の「画面の送り直し」)
export function shouldRetryConnectError(error: unknown): boolean {
  return error instanceof ConnectError && RETRYABLE_CODES.has(error.code)
}
